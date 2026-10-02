import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { PiRpcDriver } from "../dist/pi-driver.js";
import { terminalTurnFailure } from "../dist/stream-helpers.js";
import { pendingPermissionManager } from "../dist/pending-permissions.js";

function fixture(handler = () => false, overrides = {}) {
  const child = new EventEmitter();
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, killed: false });
  const frames = [], events = [];
  const state = { isStreaming: false, isCompacting: false, pendingMessageCount: 0 };
  const emit = (frame) => {
    if (frame.type === "agent_start") state.isStreaming = true;
    if (frame.type === "agent_settled") state.isStreaming = false;
    child.stdout.write(JSON.stringify(frame) + "\n");
  };
  const respond = (command, data, success = true, error) => emit({
    type: "response", id: command.id, command: command.type, success, data, error,
  });
  child.stdin = new Writable({ write(chunk, _encoding, done) {
    const command = JSON.parse(chunk.toString());
    frames.push(command);
    if (!handler(command, { emit, respond, state, child })) {
      if (command.type === "get_state") respond(command, { ...state });
      else if (command.type === "prompt") respond(command, { disposition: state.isStreaming ? "queued" : "started" });
      else if (command.type !== "extension_ui_response") respond(command, {});
    }
    done();
  }});
  child.kill = () => { child.killed = true; return true; };
  const driver = new PiRpcDriver(child, {
    provider: "pi", command: "pi", args: [], cwd: process.cwd(), env: process.env,
    model: "pi-balanced", effort: "max", ...overrides,
  });
  let buffer = "";
  driver.process.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n"); buffer = lines.pop();
    for (const line of lines) if (line) events.push(JSON.parse(line));
  });
  const message = (text, stopReason = "stop", errorMessage) => emit({
    type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason, errorMessage },
  });
  return { driver, child, frames, events, emit, message, respond, state, results: () => events.filter((e) => e.type === "result") };
}

test("only agent_settled completes a run, once", async () => {
  const f = fixture();
  try {
    await f.driver.start("first");
    f.message("answer"); f.emit({ type: "agent_end" });
    assert.equal(f.results().length, 0);
    f.emit({ type: "agent_settled" }); f.emit({ type: "agent_settled" });
    assert.equal(f.results().length, 1); assert.equal(f.results()[0].result, "answer");
  } finally { f.driver.kill(); }
});

test("send uses atomic prompt followUp during a run and after agent_end", async () => {
  const f = fixture();
  try {
    await f.driver.start("first"); f.emit({ type: "agent_start" });
    f.emit({ type: "agent_end" });
    await Promise.all([f.driver.send("second"), f.driver.send("third")]);
    const inputs = f.frames.filter((frame) => frame.type === "prompt");
    assert.equal(inputs.length, 3);
    assert.ok(inputs.slice(1).every((frame) => frame.streamingBehavior === "followUp"));
    assert.equal(new Set(f.frames.map((frame) => frame.id)).size, f.frames.length);
    assert.equal(f.results().length, 0);
    f.message("queued answer"); f.emit({ type: "agent_settled" });
    assert.equal(f.results().length, 1);
  } finally { f.driver.kill(); }
});

test("a handled input completes without waiting for an absent settled event", async () => {
  const f = fixture((command, { respond }) => {
    if (command.type === "prompt") { respond(command, { disposition: "handled" }); return true; }
  });
  try { await f.driver.start("/command"); assert.equal(f.results().length, 1); }
  finally { f.driver.kill(); }
});

test("handled input does not complete independently active work", async () => {
  const f = fixture((command, { respond, state }) => {
    if (command.type === "prompt") { state.isStreaming = true; respond(command, { disposition: "handled" }); return true; }
  });
  try {
    await f.driver.start("/command"); assert.equal(f.results().length, 0);
    f.message("independent work"); f.emit({ type: "agent_settled" });
    assert.equal(f.results().length, 1);
  } finally { f.driver.kill(); }
});

test("fast completion before the command response remains idle", async () => {
  const f = fixture((command, { emit, respond }) => {
    if (command.type === "prompt") {
      emit({ type: "agent_start" }); emit({ type: "agent_settled" });
      respond(command, { disposition: "started" }); return true;
    }
  });
  try {
    await f.driver.start("fast"); assert.equal(f.results().length, 1);
    await f.driver.send("again"); assert.equal(f.results().length, 2);
    f.driver.kill(); assert.equal(f.results().length, 2);
  } finally { f.driver.kill(); }
});

test("final message is authoritative and a user message cannot replace it", async () => {
  const f = fixture();
  try {
    await f.driver.start("go");
    f.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "partial wrong" } });
    f.message("authoritative");
    f.emit({ type: "message_end", message: { role: "user", content: "user text" } });
    f.emit({ type: "agent_settled" });
    assert.equal(f.results()[0].result, "authoritative");
  } finally { f.driver.kill(); }
});

test("retry failure stays provisional until a successful final message", async () => {
  const f = fixture();
  try {
    await f.driver.start("retry"); f.message("", "error", "429 overloaded");
    f.emit({ type: "agent_end", willRetry: true });
    f.emit({ type: "auto_retry_start", errorMessage: "429 overloaded" });
    assert.equal(f.results().length, 0);
    f.emit({ type: "agent_start" }); f.message("recovered"); f.emit({ type: "agent_settled" });
    assert.equal(f.results()[0].is_error, false); assert.equal(f.results()[0].result, "recovered");
  } finally { f.driver.kill(); }
});

for (const reason of ["error", "aborted"]) test(`final ${reason} cannot be reported as success`, async () => {
  const f = fixture();
  try {
    await f.driver.start("go"); f.message("partial", reason, `provider ${reason}`);
    f.emit({ type: "agent_end" }); assert.equal(f.results().length, 0);
    f.emit({ type: "agent_settled" });
    const result = f.results()[0]; assert.equal(result.is_error, true); assert.equal(result.pi_status, reason);
    assert.equal(terminalTurnFailure("pi", JSON.stringify(result)), `provider ${reason}`);
  } finally { f.driver.kill(); }
});

test("exhausted retry reports its final error", async () => {
  const f = fixture();
  try {
    await f.driver.start("go"); f.emit({ type: "auto_retry_end", success: false, finalError: "still unavailable" });
    f.emit({ type: "agent_settled" }); assert.equal(f.results()[0].error, "still unavailable");
  } finally { f.driver.kill(); }
});

test("abort clears the queue first and prevents concurrent new inputs", async () => {
  const f = fixture((command, { emit, respond }) => {
    if (command.type === "abort") { emit({ type: "agent_settled" }); respond(command, {}); return true; }
  });
  try {
    await f.driver.start("go");
    const abort = f.driver.abort();
    await assert.rejects(f.driver.send("new input"), /aborting/); await abort;
    assert.deepEqual(f.frames.slice(-2).map((frame) => frame.type), ["clear_queue", "abort"]);
    assert.equal(f.results()[0].pi_status, "aborted");
    await f.driver.send("resume"); f.message("fresh"); f.emit({ type: "agent_settled" });
    assert.equal(f.results().at(-1).is_error, false);
  } finally { f.driver.kill(); }
});

test("unexpected clean process exit during work is an error", async () => {
  const f = fixture();
  await f.driver.start("go"); f.child.exitCode = 0; f.child.emit("close", 0, null);
  assert.equal(f.results()[0].is_error, true); assert.equal(f.driver.process.exitCode, 1);
  assert.equal(f.driver.closed, true);
});

test("a killed driver cancels pending permission without sending a late allow", async () => {
  const f = fixture(() => false, { agentId: "rpc-lifecycle-park" });
  await f.driver.start("go");
  f.emit({ type: "extension_ui_request", id: "park-1", method: "confirm", title: "permission_request", message: JSON.stringify({ tool: "write", paths: ["notes.txt"] }) });
  assert.equal(pendingPermissionManager.pendingCount("rpc-lifecycle-park"), 1);
  f.driver.kill(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingPermissionManager.pendingCount("rpc-lifecycle-park"), 0);
  assert.equal(f.results()[0].pi_status, "aborted");
  assert.ok(!f.frames.some((frame) => frame.type === "extension_ui_response" && frame.confirmed === true));
});

test("split UTF8 and Unicode separators preserve assistant text", async () => {
  const f = fixture();
  try {
    await f.driver.start("go");
    const text = "中文🙂\u2028end";
    const wire = Buffer.from(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } }) + "\r\n");
    const split = wire.indexOf(Buffer.from("中")) + 1;
    f.child.stdout.write(wire.subarray(0, split)); f.child.stdout.write(wire.subarray(split));
    f.emit({ type: "agent_settled" }); assert.equal(f.results()[0].result, text);
  } finally { f.driver.kill(); }
});

test("empty final output cannot reuse a previous run's result", async () => {
  const f = fixture();
  try {
    await f.driver.start("one"); f.message("old answer"); f.emit({ type: "agent_settled" });
    await f.driver.send("two"); f.message(""); f.emit({ type: "agent_settled" });
    assert.equal(f.results().at(-1).result, "");
  } finally { f.driver.kill(); }
});

test("fire-and-forget UI notices cannot create permission prompts", async () => {
  const f = fixture(() => false, { agentId: "rpc-lifecycle-notify" });
  try {
    await f.driver.start("go"); f.emit({ type: "extension_ui_request", id: "notice", method: "notify", message: "hello" });
    assert.equal(pendingPermissionManager.pendingCount("rpc-lifecycle-notify"), 0);
    assert.ok(!f.frames.some((frame) => frame.type === "extension_ui_response"));
  } finally { f.driver.kill(); }
});

test("a rejected prompt restores input state and can be retried", async () => {
  let calls = 0;
  const f = fixture((command, { respond }) => {
    if (command.type === "prompt" && calls++ === 0) { respond(command, undefined, false, "invalid input"); return true; }
  });
  try {
    await assert.rejects(f.driver.start("bad"), /invalid input/);
    await f.driver.send("valid"); f.message("ok"); f.emit({ type: "agent_settled" });
    assert.equal(f.results()[0].result, "ok");
  } finally { f.driver.kill(); }
});

test("a malformed response cannot be accepted as a successful command", async () => {
  const f = fixture((command, { emit }) => {
    if (command.type === "prompt") { emit({ type: "response", id: command.id }); return true; }
  });
  try { await assert.rejects(f.driver.start("bad"), /pi request failed/); }
  finally { f.driver.kill(); }
});

test("handled response after fast settled cannot emit a duplicate result", async () => {
  const f = fixture((command, { emit, respond }) => {
    if (command.type === "prompt") {
      emit({ type: "agent_start" }); emit({ type: "agent_settled" });
      respond(command, { disposition: "handled" }); return true;
    }
  });
  try { await f.driver.start("fast handled"); assert.equal(f.results().length, 1); }
  finally { f.driver.kill(); }
});

test("handled response with unknown state fails closed instead of inventing completion", async () => {
  const f = fixture((command, { respond }) => {
    if (command.type === "get_state") { respond(command, {}); return true; }
    if (command.type === "prompt") { respond(command, { disposition: "handled" }); return true; }
  });
  try {
    await assert.rejects(f.driver.start("unknown state"), /incomplete session state/);
    assert.equal(f.results()[0].is_error, true); assert.equal(f.driver.closed, true);
  } finally { f.driver.kill(); }
});

test("late stdout after kill cannot write to a closed normalized stream", async () => {
  const f = fixture();
  await f.driver.start("go"); f.driver.kill();
  f.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "late" } });
  f.emit({ type: "agent_settled" });
  assert.equal(f.results().length, 1); assert.equal(f.results()[0].pi_status, "aborted");
});
