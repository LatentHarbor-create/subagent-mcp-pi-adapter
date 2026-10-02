// Modified for the subagent-mcp Pi adapter fork.
/**
 * PiRpcDriver — Pi harness as a ProviderDriver backend.
 *
 * Transport: persistent RPC (`pi --mode rpc`), newline-delimited JSON frames
 * (see pi-protocol.ts). The child is spawned by createProviderDriver with the
 * baseline args from buildCommand plus the shipped ask-permission extension.
 *
 * Permission bridge: extension ui requests carrying the structured payload go
 * through the shared permission engine (verdict -> ceiling -> park on ask via
 * requestPendingPermission). Unstructured requests are low-confidence and
 * fail closed to the park path (or deny under yolo — never granted on prose).
 *
 * Visible stream: normalized Claude-shape JSONL ({type:"assistant"...} /
 * {type:"result"...}) so the shared stream parsers and final-output extraction
 * work unchanged. Raw Pi frames are never dumped to the visible stream.
 */

import type { ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import {
  isTransientFailureText,
  killProviderChildProcess,
  writeLine,
  LogicalProcess,
  ProviderTransientError,
  type DriverLaunchOptions,
  type DriverProcess,
  type ProviderDriver,
} from "./drivers.js";
import {
  applyPermissionCeiling,
  verdict,
  type PermissionOp,
  type PermissionSnapshot,
  type PermissionVerdict,
} from "./permission-engine.js";
import { pendingPermissionManager, requestPendingPermission } from "./pending-permissions.js";
import {
  isPiAgentEnd,
  isPiAgentSettled,
  isPiResponse,
  isPiUiRequest,
  parsePiFrame,
  piPromptRequest,
  piStateRequest,
  piStructuredPermissionPayload,
  piTextDelta,
  piUiRequestOf,
  piUiResponseConfirmed,
  piUiResponseDenied,
  type PiFrame,
  type PiUiRequest,
} from "./pi-protocol.js";

type DriverPermissionSnapshot = PermissionSnapshot & {
  strictReadParity?: "warn" | "off";
};

interface PendingPiRequest {
  id: string;
  resolve: (frame: PiFrame) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface PendingPiUi {
  uiId: string;
  timer: NodeJS.Timeout;
}

const PI_UI_TIMEOUT_MS = 5 * 60 * 1000;

export class PiRpcDriver implements ProviderDriver {
  readonly process: DriverProcess;
  private _definitelyStartedResolve!: () => void;
  private _definitelyStartedReject!: (e: Error) => void;
  readonly definitelyStarted: Promise<void> = new Promise((res, rej) => {
    this._definitelyStartedResolve = res;
    this._definitelyStartedReject = rej;
  });
  private readonly pendingRequests = new Map<string, PendingPiRequest>();
  private readonly pendingUi = new Map<string, PendingPiUi>();
  private readonly permissionSnapshot: PermissionSnapshot;
  private stdoutBuf = "";
  private turnText = "";
  private lastResult: string | null = null;
  private started = false;
  private killedFlag = false;
  private failedFlag = false;
  private aborting = false;
  private requestSequence = 0;
  private lifecycleSequence = 0;
  private inputChain: Promise<void> = Promise.resolve();
  private readonly decoder = new StringDecoder("utf8");
  private outcome: { status: "error" | "aborted"; error: string } | null = null;
  /** Only agent_settled means all automatic work, including queued input, ended. */
  private idle = true;

  constructor(private readonly child: ChildProcess, private readonly options: DriverLaunchOptions) {
    this.permissionSnapshot = options.permissionSnapshot ?? {
      ceiling: "auto",
      escalation: "irreversible-only",
      rules: {},
      additionalDirectories: [],
    };
    this.process = new LogicalProcess(child.pid);
    // start() also reports rejection; retain the independently awaitable signal.
    void this.definitelyStarted.catch(() => {});
    child.once("spawn", () => this.process.emit("spawn"));
    child.once("error", (err: Error) => this.fail(err));
    child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
      this.onStdout(this.decoder.end());
      const error = new Error(`pi rpc process exited (code=${code ?? signal})`);
      const interrupted = !this.idle;
      if (interrupted) this.finishRun("error", `${error.message} before agent_settled`);
      this.failedFlag = true;
      this._definitelyStartedReject(error);
      this.clearUi();
      if (!this.process.killed) (this.process as LogicalProcess).close(interrupted ? 1 : code, signal);
      this.rejectAllPending(error);
    });
    child.stdout?.on("data", (chunk: Buffer) => this.onStdout(this.decoder.write(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => this.process.stderr.write(chunk));
    // Swallow stdin pipe errors (EPIPE writing to an exited child); the
    // writeLine callback already surfaces the failure.
    child.stdin?.on("error", () => {});
  }

  get closed(): boolean {
    return this.failedFlag || this.killedFlag || this.child.killed || this.child.exitCode !== null;
  }

  async start(message: string): Promise<void> {
    if (this.started) throw new Error("pi rpc driver already started");
    this.started = true;
    try {
      await this.getState();
      await this.submit(message, false);
      this._definitelyStartedResolve();
    } catch (error) {
      this._definitelyStartedReject(error as Error);
      throw error;
    }
  }

  async send(message: string): Promise<void> {
    const operation = this.inputChain.then(() => this.submit(message, true));
    this.inputChain = operation.catch(() => {});
    await operation;
  }

  async getState(): Promise<PiFrame> {
    const response = await this.request(piStateRequest(), PI_UI_TIMEOUT_MS);
    return response.data && typeof response.data === "object" ? response.data as PiFrame : {};
  }

  /** Cancel queued input before aborting, so abort cannot start its follow-ups. */
  async abort(): Promise<void> {
    if (this.closed) throw new Error("provider driver is closed");
    if (this.aborting) throw new Error("pi rpc abort already pending");
    this.aborting = true;
    this.clearUi();
    try {
      await this.request({ type: "clear_queue" }, PI_UI_TIMEOUT_MS);
      await this.request({ type: "abort" }, PI_UI_TIMEOUT_MS);
      if (!this.idle) this.finishRun("aborted", "pi run aborted");
    } finally {
      this.aborting = false;
    }
  }

  private async submit(message: string, queueIfBusy: boolean): Promise<void> {
    if (this.closed || this.aborting) throw new Error("pi rpc driver is closed or aborting");
    const wasIdle = this.idle;
    const sequence = this.lifecycleSequence;
    if (wasIdle) {
      this.turnText = "";
      this.lastResult = null;
      this.outcome = null;
    }
    this.idle = false;
    try {
      // Pi chooses started/queued atomically; a standalone follow_up can sit idle.
      const frame = { ...piPromptRequest(message), ...(queueIfBusy ? { streamingBehavior: "followUp" } : {}) };
      const response = await this.request(frame, PI_UI_TIMEOUT_MS);
      const data = response.data as PiFrame | undefined;
      if (data?.disposition === "handled") {
        // A handler may independently start work. Probe instead of assuming idle.
        const state = await this.getState();
        if (typeof state.isStreaming !== "boolean" || typeof state.isCompacting !== "boolean" || typeof state.pendingMessageCount !== "number") {
          const error = new Error("pi handled input returned an incomplete session state");
          this.fail(error);
          throw error;
        }
        if (!this.idle && !this.aborting && !state.isStreaming && !state.isCompacting && state.pendingMessageCount === 0) {
          this.finishRun(undefined, undefined, "Pi handled input without starting a model run.");
        }
      }
      // started/queued (or an older response without disposition) is acceptance,
      // never completion. Fast agent_settled events must not be overwritten here.
    } catch (error) {
      if (!this.closed && sequence === this.lifecycleSequence) this.idle = wasIdle;
      throw error;
    }
  }

  kill(): void {
    if (this.killedFlag) return;
    if (!this.idle) this.finishRun("aborted", "pi rpc driver was killed");
    this.killedFlag = true;
    this._definitelyStartedReject(new Error("pi rpc driver was killed"));
    this.clearUi();
    this.child.stdin?.destroy();
    killProviderChildProcess(this.child, "SIGKILL");
    (this.process as LogicalProcess).kill("SIGKILL");
    this.rejectAllPending(new Error("pi rpc driver was killed"));
  }

  private request(frame: PiFrame, timeoutMs: number): Promise<PiFrame> {
    if (this.closed) return Promise.reject(new Error("provider driver is closed"));
    const id = `pi-rpc-${++this.requestSequence}`;
    frame = { ...frame, id };
    return new Promise<PiFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        const error = new Error(`pi rpc request timed out: ${frame.type}`);
        reject(error);
        this.fail(error);
      }, timeoutMs);
      timer.unref();
      this.pendingRequests.set(id, { id, resolve, reject, timer });
      void writeLine(this.child.stdin, frame).catch((err: Error) => {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
        this.fail(err);
      });
    });
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk;
    const lines = this.stdoutBuf.split("\n");
    this.stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      this.handleFrame(line);
    }
  }

  private handleFrame(line: string): void {
    if (this.killedFlag || this.failedFlag) return;
    const frame = parsePiFrame(line);
    if (!frame) return;

    if (isPiResponse(frame)) {
      const pending = this.pendingRequests.get(frame.id as string);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(frame.id as string);
        if (frame.success !== true) {
          // Rejected request (e.g. missing auth): fail the caller fast with
          // the sanitized reason; transient text maps to ProviderTransientError
          // so the launch attempt loop can fail over.
          const reason = typeof frame.error === "string" ? frame.error : "pi request failed";
          pending.reject(
            isTransientFailureText(reason) ? new ProviderTransientError(reason) : new Error(reason)
          );
        } else {
          pending.resolve(frame);
        }
      }
      return;
    }

    if (isPiUiRequest(frame)) {
      if (frame.method === "confirm") {
        void this.handleUiRequest(frame).catch(() => {
          const ui = piUiRequestOf(frame);
          if (ui) void this.replyUi(ui, "deny").catch(() => {});
        });
      } else if (["select", "input", "editor"].includes(String(frame.method))) {
        void writeLine(this.child.stdin, { type: "extension_ui_response", id: frame.id, cancelled: true }).catch(() => {});
      }
      return;
    }

    if (frame.type === "agent_start") {
      if (this.idle) {
        this.turnText = "";
        this.lastResult = null;
        this.outcome = null;
      }
      this.lifecycleSequence++;
      this.idle = false;
      return;
    }

    const delta = piTextDelta(frame);
    if (delta !== null) {
      this.turnText += delta;
      this._definitelyStartedResolve();
      return;
    }

    if (frame.type === "message_end") {
      const message = frame.message as PiFrame | undefined;
      if (message && message.role !== "assistant") return;
      if (message) {
        this.turnText = Array.isArray(message.content) ? message.content
          .filter((block: PiFrame) => block.type === "text" && typeof block.text === "string")
          .map((block: PiFrame) => block.text).join("") : "";
        if (message.stopReason === "error" || message.stopReason === "aborted") {
          this.outcome = {
            status: message.stopReason === "aborted" ? "aborted" : "error",
            error: typeof message.errorMessage === "string" ? message.errorMessage : `pi run ${message.stopReason}`,
          };
        } else {
          this.outcome = null;
          this.lastResult = null;
        }
      }
      this.flushTurnText();
      return;
    }

    if (frame.type === "auto_retry_end" && frame.success === false) {
      this.outcome = { status: "error", error: String(frame.finalError ?? "pi retries exhausted") };
      return;
    }
    if (frame.type === "compaction_end" && frame.errorMessage && frame.willRetry !== true) {
      this.outcome = { status: "error", error: String(frame.errorMessage) };
      return;
    }
    if (isPiAgentEnd(frame)) {
      this.flushTurnText();
      return;
    }
    if (isPiAgentSettled(frame)) {
      if (!this.idle) this.finishRun(this.aborting ? "aborted" : undefined, this.aborting ? "pi run aborted" : undefined);
      return;
    }
  }

  private finishRun(status?: "error" | "aborted", error?: string, fallback = ""): void {
    this.flushTurnText();
    const outcome = status ? { status, error: error ?? `pi run ${status}` } : this.outcome;
    this.emitNormalized({
      type: "result",
      result: this.lastResult ?? fallback,
      ...(outcome ? { is_error: true, subtype: "error_during_execution", error: outcome.error, pi_status: outcome.status } : { is_error: false }),
    });
    this.idle = true;
    this.lifecycleSequence++;
    this.outcome = null;
  }

  private flushTurnText(): void {
    const text = this.turnText.trim();
    this.turnText = "";
    if (!text) return;
    this.lastResult = text;
    this.emitNormalized({
      type: "assistant",
      message: { content: [{ type: "text", text }] },
    });
  }

  private emitNormalized(evt: Record<string, unknown>): void {
    this.process.stdout.write(`${JSON.stringify(evt)}\n`);
  }

  private async handleUiRequest(frame: PiFrame): Promise<void> {
    const ui = piUiRequestOf(frame);
    if (!ui) return;
    const timer = setTimeout(() => {
      this.pendingUi.delete(ui.uiId);
      // Park-timeout is handled upstream; here a stale ui request is cancelled
      // so the Pi extension never blocks forever.
      void writeLine(this.child.stdin, { type: "extension_ui_response", id: ui.uiId, cancelled: true }).catch(() => {});
    }, PI_UI_TIMEOUT_MS);
    timer.unref();
    this.pendingUi.set(ui.uiId, { uiId: ui.uiId, timer });

    const payload = piStructuredPermissionPayload(ui);
    const op: PermissionOp = payload
      ? {
          tool: payload.tool ?? "unknown",
          ...(payload.command ? { command: payload.command } : {}),
          ...(payload.paths && payload.paths.length > 0 ? { paths: payload.paths } : {}),
          cwd: this.options.cwd,
          ...(this.permissionSnapshot.additionalDirectories
            ? { additionalDirectories: this.permissionSnapshot.additionalDirectories }
            : {}),
          ...(payload.irreversible ? { irreversible: true } : {}),
        }
      : {
          tool: "unknown",
          command: `${ui.title} ${ui.message}`.trim(),
          cwd: this.options.cwd,
          ...(this.permissionSnapshot.additionalDirectories
            ? { additionalDirectories: this.permissionSnapshot.additionalDirectories }
            : {}),
        };

    const engineResult = payload
      ? verdict(op, this.permissionSnapshot.rules)
      : {
          verdict: "ask" as PermissionVerdict,
          classification: "neutral" as const,
          irreversible: Boolean(op.irreversible),
          reason: "pi ui request carried no structured permission payload",
        };
    const decision = applyPermissionCeiling(engineResult.verdict, this.permissionSnapshot.ceiling);
    if (decision !== "ask") {
      await this.replyUi(ui, decision);
      return;
    }

    const pendingDecision = await requestPendingPermission({
      agentId: this.options.agentId,
      harnessChannel: "pi-rpc",
      toolNameOrMethod: op.tool,
      action: payload ?? { method: ui.method, title: ui.title, message: ui.message },
      permissionCeiling: this.permissionSnapshot.ceiling,
      escalation: this.permissionSnapshot.escalation,
      irreversible: engineResult.irreversible,
      reason: engineResult.reason,
      suggestions: [],
      correlationId: ui.uiId,
    });
    await this.replyUi(ui, pendingDecision.verdict);
  }

  private async replyUi(ui: PiUiRequest, decision: PermissionVerdict): Promise<void> {
    const pending = this.pendingUi.get(ui.uiId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingUi.delete(ui.uiId);
    const frame =
      decision === "allow"
        ? piUiResponseConfirmed(ui.uiId)
        : piUiResponseDenied(ui.uiId);
    await writeLine(this.child.stdin, frame).catch(() => {});
  }

  private clearUi(): void {
    for (const [, pending] of this.pendingUi) {
      clearTimeout(pending.timer);
      void writeLine(this.child.stdin, { type: "extension_ui_response", id: pending.uiId, cancelled: true }).catch(() => {});
    }
    this.pendingUi.clear();
    if (this.options.agentId) void pendingPermissionManager.closeAgent(this.options.agentId, "pi rpc operation closed").catch(() => {});
  }

  private fail(error: Error): void {
    if (this.closed) return;
    if (!this.idle) this.finishRun("error", error.message);
    this.failedFlag = true;
    this.clearUi();
    killProviderChildProcess(this.child, "SIGKILL");
    const transient = isTransientFailureText(error.message);
    this._definitelyStartedReject(transient ? new ProviderTransientError(error.message) : error);
    if (!this.process.killed) (this.process as LogicalProcess).fail(error);
    this.rejectAllPending(error);
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }}
