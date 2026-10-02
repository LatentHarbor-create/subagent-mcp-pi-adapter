// Modified for the subagent-mcp Pi adapter fork.
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import * as os from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { registerInitRun, deregisterInitRun } from "./init-registry.js";
import { ensureNativeAgentSuppression } from "./native-suppression.js";

export type InitStatus = "created" | "added" | "updated" | "ok" | "removed" | "absent";

export interface InitResult {
  file: string;
  status: InitStatus;
  changed: boolean;
  target?: string;
  ignored?: boolean;
}

const MIGRATE_RE = /<!-- subagent-mcp:(?:managed:)?begin\b[^>]*-->[\s\S]*?<!-- subagent-mcp:(?:managed:)?end -->/;
const OWNER_CAP = 8;

export const INIT_BLOCK = [
  "<!-- subagent-mcp:managed:begin schema=5 -->",
  "## subagent-mcp invariant — managed block, do not edit between markers",
  "",
  "Upserted by `subagent-mcp init` at user request; re-running init keeps it in sync.",
  "",
  "SUB-AGENT EXEMPTION: if this session's prompt's literal FIRST LINE begins with \"<this is a request from a parent process>\", SKIP this entire block EXCEPT the SUB-AGENT WORKTREE CARVE-OUT and the SUB-ORCHESTRATOR CARVE-OUT below, which still apply. Leading blank lines do not count — the marker must be physically line 1. Codex native subagents follow Codex's own lifecycle and are outside this MCP orchestration block.",
  "",
  "SUB-AGENT WORKTREE CARVE-OUT: you are a delegated sub-agent (env SUBAGENT_MCP_SUBAGENT=1), already placed in your target working tree by the orchestrator. Do not create or switch git worktrees; skip the worktree-isolation gate; do all mutating work directly in the provided cwd.",
  "",
  "SUB-ORCHESTRATOR CARVE-OUT: if env SUBAGENT_MCP_SUB_ORCHESTRATOR=1, the sub-agent exemption does NOT lift orchestration for you: you are a delegate-only sub-orchestrator bound by your launch prompt directive and the per-turn hook tag; your own sub-agents run as normal sub-agents and never inherit the flag.",
  "",
  "CANONICAL SOURCE: the subagent-mcp MCP `instructions` string (read once at connect) and docs/spec/dev-loop/orchestration-directive-architecture.md. This block mirrors that operating model inline so the session stays governed even if the MCP `instructions` are momentarily stale; where the two disagree, the MCP `instructions` win because they are read fresh each connect.",
  "",
  "HARNESS-HOOK STATE: a harness-hook context carrying a <subagent-mcp state=\"...\"> tag reports subagent-mcp orchestration ON/OFF. It does not control Codex native subagents. A token counts as such a tag only when it is a real tag with a `state` attribute; a bare mention of \"subagent-mcp\" in prose is not a tag. A user request can switch MCP orchestration ON or OFF; the current state comes from the tag. No tag present means the MCP state is UNKNOWN (see NO-HOOK below).",
  "",
  "PRECEDENCE (jointly binding top tier): <subagent-mcp> hook tags and repo/system safety-scope rules are both binding at the same priority — neither is read as outranking the other. If they genuinely conflict, stop and escalate to the user via the structured-question tool rather than picking one side or averaging them silently; this is intentionally not the agent's call to make alone. Hook tags otherwise take precedence over ordinary user requests, because they reflect harness-verified state rather than a request that could be mistaken or out of date.",
  "",
  "CHANNEL BOUNDARY — BOTH ORCHESTRATION STATES: subagent-mcp `launch_agent` governs only agents launched through this MCP service. Codex native subagents are an independent channel: their availability, selection, launch, permissions, waiting, and outputs follow Codex, user, and project rules. No subagent-mcp option, hook state, Pi preference, Smart route, worktree rule, or service outage disables, redirects, or gates the Codex native channel. Pi may be preferred for suitable work, but Pi being forbidden, unavailable, or unsuitable never blocks Codex native subagents. Claude and Gemini native-agent restrictions remain host-specific.",
  "",
  "DELEGATION CHOICE — MCP orchestration ON requires delegation for MCP-managed work; OFF or UNKNOWN removes that requirement and permits inline work. OFF or UNKNOWN does not disable `launch_agent` or automatic task-fit Pi delegation. Pi session mode is a separate choice: AUTO selects suitable bounded tasks, ON proactively uses Pi for them, and OFF prevents automatic Pi launches. If Pi mode is unset, follow explicit user and project Pi policy. Never infer Pi OFF from an OFF hook tag, a missing hook tag, or missing context usage. Explicit Pi requests still follow project, model, permission, and worktree rules. Codex native subagents remain independent.",
  "",
  "ORCHESTRATION ON — you are the ORCHESTRATOR for MCP-managed work. MCP orchestration tools are the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex), subagent-mcp, and /workflows. Codex native subagent tools remain independently available in ON and OFF; using them follows Codex's own rules, not this MCP tool allowlist. There is no inline-by-right for MCP-managed steps. Applicable skill instructions may be read directly only within that skill's folder; action steps remain delegated. If an MCP-managed atomic step truly cannot be delegated, ask the user via the structured-question tool for a one-time exception for that step.",
  "",
  "TASK TRACKING: track multi-step work with the harness-native task tracking tool (if one exists), keeping statuses current as work progresses.",
  "WAIT-ON-AGENTS: use the subagent-mcp wait tool for MCP-launched agents. Codex native agents use Codex-native waiting and results; this MCP rule does not apply to them.",
  "",
  "ORCHESTRATOR WORKTREE SETUP: before mutating work through subagent-mcp, place MCP-launched agents in a compliant linked worktree/work branch. This MCP worktree gate does not apply to Codex native subagents, which follow Codex and project rules. Serialize any agents that write the same files.",
  "",
  "READ-ESCALATION LADDER FOR MCP-LAUNCHED AGENTS: (1) subagent-mcp `poll_agent` TAIL; (2) if insufficient, dispatch ONE MCP sub-agent to return a <=100-line summary; (3) anything larger: the USER reads it. Do not busy-loop poll_agent; learn completion via `wait`. MCP agents may exchange large data through scratch-file paths. Codex native subagent output and coordination follow Codex's own channel and are not limited by this MCP read ladder.",
  "",
  "ORCHESTRATION OFF BY DEFAULT -- each new session starts with MCP orchestration OFF. A hook meters real provider-reported context usage. At 15% utilization, MCP planning coaching may run only if orchestration was explicitly enabled; the threshold does not turn it ON. At 20% utilization MCP handoff tools unlock. At 80% utilization a fresh MCP handoff-write is mandatory for MCP-managed work; keep working after a successful write. After verified auto-compaction, one MCP handoff-read turn resumes the prepared handoff. If context size cannot be measured, MCP orchestration remains OFF unless explicitly enabled. These thresholds do not gate Codex native subagents. Only the hook tag reports MCP orchestration state.",
  "",
  "MODEL SELECTION: subagent-mcp launches default to smart/automatic; provider/model/effort selectors require its user-approved override window. This MCP setting never selects or restricts Codex native subagent models.",
  "",
  "SWARM WORKFLOW: when a work objective is projected to span multiple sessions, offer the agentic-swarm workflow and drive it with the swarm MCP tool - swarm() starts it, each swarm(N) reports stage N done and returns the next stage's coaching, swarm(0) abandons. Stage state lives in the server, in memory only - never self-assert a stage. The launch_agent sub-orchestrator: true flag exists ONLY for the swarm dispatch stage; never set it elsewhere.",
  "",
  "DROPOUT WHILE ON: if subagent-mcp stops responding while MCP orchestration is ON, halt only MCP-managed steps and resolve the state of any running MCP agent before rerouting its work. Codex native subagents remain available under Codex and project rules; MCP failure does not disable them or require waiting for MCP recovery. Do not silently duplicate an in-flight MCP mutation.",
  "",
  "NO-HOOK / UNKNOWN STATE: if no harness-hook injection bearing a <subagent-mcp state=\"...\"> tag is present this session (e.g. hooks are unsupported, unconfigured, or untrusted), the state is UNKNOWN — represented by the absence of any tag, never by a tag value. Emit this notice to the user: \"subagent-mcp: no hook injection detected — orchestration state unknown; defaulting to OFF.\" Without a fresh, verified ON signal, do not impose ON's delegate-only rule; inline work is allowed. The separate Pi preference still governs whether suitable work may be delegated through `launch_agent`. Do not infer ON from the absence of a tag or from self-reported prose. The sub-agent first-line exemption still prevents child-session recursion.",
  "",
  "DISABLE: never change MCP orchestration on your own initiative. Only explicit user approval may set enabled:false; user-approved enabled:true may re-enable mid-session. The setting is session-keyed, and each new session starts OFF. It has no effect on Codex native subagent availability or use.",
  "<!-- subagent-mcp:managed:end -->",
].join("\n");

export function managedBlockContent(block = INIT_BLOCK): string {
  const lines = block.split(/\r?\n/);
  return lines.slice(1, -1).join("\n");
}

export function managedBlockHash(block = INIT_BLOCK): string {
  return createHash("sha256").update(managedBlockContent(block), "utf8").digest("hex");
}

export function extractManagedBlock(body: string): string | null {
  const text = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
  return text.match(MIGRATE_RE)?.[0] ?? null;
}

function detectEol(s: string): "\n" | "\r\n" {
  const crlf = s.indexOf("\r\n");
  const lf = s.replace(/\r\n/g, "").indexOf("\n");
  return crlf >= 0 && (lf < 0 || crlf <= lf) ? "\r\n" : "\n";
}

function normalizeBlock(eol: "\n" | "\r\n"): string {
  return INIT_BLOCK.split("\n").join(eol);
}

function insertAfterFirstHeading(body: string, block: string, eol: string): string {
  const m = body.match(/^# .*(?:\r?\n|$)/m);
  if (!m || m.index === undefined) return `${block}${eol}${eol}${body}`;
  const end = m.index + m[0].length;
  return `${body.slice(0, end)}${eol}${block}${eol}${body.slice(end)}`;
}

function collapseBlankRuns(s: string, eol: string): string {
  return s.replace(new RegExp(`(?:${eol}){3,}`, "g"), `${eol}${eol}`);
}

function removeManagedBlock(body: string, eol: string): string {
  const match = body.match(MIGRATE_RE);
  let stripped = body;
  let removed = 0;
  while (removed <= OWNER_CAP && MIGRATE_RE.test(stripped)) {
    stripped = stripped.replace(MIGRATE_RE, "");
    removed++;
  }
  const next = collapseBlankRuns(stripped, eol);
  if (!match || match.index !== 0) return next;
  let trimmed = next;
  let trimmedCount = 0;
  while (trimmed.startsWith(eol) && trimmedCount < 2) {
    trimmed = trimmed.slice(eol.length);
    trimmedCount++;
  }
  return trimmed;
}

function backupOnce(file: string): void {
  if (!existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${file}.bak-init-${stamp}`;
  copyFileSync(file, backup);
}

function atomicWrite(file: string, data: string, force: boolean): void {
  mkdirSync(dirname(file), { recursive: true });
  if (force && existsSync(file)) chmodSync(file, 0o666);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, file);
}

export function upsertInitBlock(
  file: string,
  opts: { dryRun?: boolean; remove?: boolean; force?: boolean } = {}
): InitResult {
  const exists = existsSync(file);
  const original = exists ? readFileSync(file, "utf8") : "";
  const hadBom = original.charCodeAt(0) === 0xfeff;
  const body = hadBom ? original.slice(1) : original;
  const eol = exists ? detectEol(body) : "\n";
  const block = normalizeBlock(eol);
  let next = body;
  let status: InitStatus;

  if (opts.remove) {
    if (!exists || !MIGRATE_RE.test(body)) {
      status = "absent";
    } else {
      next = removeManagedBlock(body, eol);
      status = "removed";
    }
  } else if (!exists) {
    next = `${block}${eol}`;
    status = "created";
  } else if (MIGRATE_RE.test(body)) {
    const matches = body.match(new RegExp(MIGRATE_RE.source, "g"));
    if (matches && matches.length > 1) {
      const firstIdx = body.search(MIGRATE_RE);
      const replaced = body.replace(MIGRATE_RE, block);
      const afterPos = firstIdx + block.length;
      const head = replaced.slice(0, afterPos);
      let tail = replaced.slice(afterPos);
      let removed = 0;
      while (removed < OWNER_CAP && MIGRATE_RE.test(tail)) {
        tail = tail.replace(MIGRATE_RE, "");
        removed++;
      }
      next = collapseBlankRuns(head + tail, eol);
      status = "updated";
      console.error(`collapsed ${removed} duplicate managed blocks in ${file}`);
    } else {
      const current = body.match(MIGRATE_RE)?.[0] ?? "";
      if (current === block) {
        status = "ok";
      } else {
        next = body.replace(MIGRATE_RE, block);
        status = "updated";
      }
    }
  } else {
    next = insertAfterFirstHeading(body, block, eol);
    status = "added";
  }

  const changed = !["ok", "absent"].includes(status);
  if (changed && !opts.dryRun) {
    const out = (hadBom ? "\ufeff" : "") + (next.endsWith(eol) ? next : next + eol);
    backupOnce(file);
    atomicWrite(file, out, opts.force === true);
  }
  return { file, status, changed };
}

export function parseArgs(args: string[]) {
  const parsed = {
    dryRun: false,
    remove: false,
    force: false,
    copilot: false,
    cursor: false,
    global: false,
    root: process.cwd(),
    files: null as string[] | null,
  };
  let rootProvided = false;
  const readValue = (args: string[], i: number, flag: string): string => {
    const value = args[i + 1];
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") parsed.dryRun = true;
    else if (a === "--remove" || a === "--uninstall") parsed.remove = true;
    else if (a === "--force") parsed.force = true;
    else if (a === "--copilot") parsed.copilot = true;
    else if (a === "--cursor") parsed.cursor = true;
    else if (a === "--global") parsed.global = true;
    else if (a === "--root") {
      parsed.root = readValue(args, i, a);
      rootProvided = true;
      i++;
    } else if (a === "--files") {
      parsed.files = readValue(args, i, a).split(",").filter(Boolean);
      i++;
    }
    else throw new Error(`unknown init argument: ${a}`);
  }
  if (!parsed.root) throw new Error("--root requires a directory");
  if (parsed.global && (rootProvided || parsed.files || parsed.copilot || parsed.cursor)) {
    throw new Error("--global cannot be combined with --root/--files/--copilot/--cursor");
  }
  return parsed;
}

function isSelfRepo(root: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: string };
    return pkg.name === "@heretyc/subagent-mcp";
  } catch {
    return false;
  }
}

export function globalTargetFiles(home: string = os.homedir()): string[] {
  return [
    join(home, ".claude", "CLAUDE.md"),
    join(home, ".codex", "AGENTS.md"),
    join(home, ".gemini", "GEMINI.md"),
  ];
}

export function targetFiles(root: string, opts: ReturnType<typeof parseArgs>): string[] {
  const resolveTarget = (f: string): string => {
    const target = isAbsolute(f) ? resolve(f) : resolve(root, f);
    const rel = relative(root, target);
    if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
      return target;
    }
    throw new Error(`--files target escapes --root: ${f}`);
  };
  if (opts.files) return opts.files.map(resolveTarget);
  const rel = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"];
  if (opts.copilot) rel.push(".github/copilot-instructions.md");
  if (opts.cursor) rel.push(".cursor/rules/subagent-mcp.mdc");
  return rel.map(resolveTarget);
}

export async function runInit(args = process.argv.slice(3)): Promise<number> {
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(args);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  let files: string[];
  if (opts.global) {
    files = globalTargetFiles();
  } else {
    const root = resolve(opts.root);
    if (isSelfRepo(root) && !opts.force) {
      console.error("Refusing to run init inside the subagent-mcp source repo without --force.");
      console.error("This repo keeps CLAUDE.md/GEMINI.md as thin redirects; use --root for a consumer repo.");
      return 1;
    }

    try {
      files = targetFiles(root, opts);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      return 1;
    }
  }

  const issues: string[] = [];
  const results: InitResult[] = [];
  for (const file of files) {
    try {
      const r = upsertInitBlock(file, opts);
      results.push(r);
      console.log(`${r.status.padEnd(7)} ${file}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      issues.push(`${file}: ${msg}`);
      console.error(`failed  ${file}: ${msg}`);
    }
  }
  if (opts.dryRun) console.log("(dry-run: no files written)");
  if (opts.global && !opts.remove) {
    for (const r of ensureNativeAgentSuppression(os.homedir(), ["claude", "gemini"], { dryRun: opts.dryRun })) {
      console.log(`${r.status.padEnd(7)} ${r.file} (${r.host} ${r.layer})`);
    }
  }
  if (issues.length > 0) {
    console.error("\nInit completed with issues:");
    for (const i of issues) console.error(`- ${i}`);
    return 1;
  }
  if (!opts.dryRun) {
    const root = opts.global ? os.homedir() : resolve(opts.root);
    try {
      if (opts.remove) {
        deregisterInitRun({ root, scope: opts.global ? "global" : "project", global: opts.global });
      } else {
        registerInitRun({
          root,
          files: results.map((r) => r.file),
          scope: opts.global ? "global" : "project",
          global: opts.global,
        });
      }
    } catch (e) {
      console.error(`registry warning: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return results.length > 0 ? 0 : 1;
}
