<!-- Modified for the subagent-mcp Pi adapter fork. -->
# Pi adapter contributor instructions

This fork implements Pi workers through the subagent-mcp channel. Use a topic branch, preserve unrelated work, and test behavior changes. Never publish, push, create a release, or change the installed adapter without explicit owner authorization. The upstream author's project board is not this fork's project board.

Keep credentials, local paths, runtime logs, and user configuration out of the repository. Keep upstream license and applicable notices. Every modified upstream file carries a modification notice.

<!-- subagent-mcp:managed:begin schema=5 -->
## subagent-mcp invariant — managed block, do not edit between markers

Upserted by `subagent-mcp init` at user request; re-running init keeps it in sync.

SUB-AGENT EXEMPTION: if this session's prompt's literal FIRST LINE begins with "<this is a request from a parent process>", SKIP this entire block EXCEPT the SUB-AGENT WORKTREE CARVE-OUT and the SUB-ORCHESTRATOR CARVE-OUT below, which still apply. Leading blank lines do not count — the marker must be physically line 1. Codex native subagents follow Codex's own lifecycle and are outside this MCP orchestration block.

SUB-AGENT WORKTREE CARVE-OUT: you are a delegated sub-agent (env SUBAGENT_MCP_SUBAGENT=1), already placed in your target working tree by the orchestrator. Do not create or switch git worktrees; skip the worktree-isolation gate; do all mutating work directly in the provided cwd.

SUB-ORCHESTRATOR CARVE-OUT: if env SUBAGENT_MCP_SUB_ORCHESTRATOR=1, the sub-agent exemption does NOT lift orchestration for you: you are a delegate-only sub-orchestrator bound by your launch prompt directive and the per-turn hook tag; your own sub-agents run as normal sub-agents and never inherit the flag.

CANONICAL SOURCE: the subagent-mcp MCP `instructions` string (read once at connect) and docs/spec/dev-loop/orchestration-directive-architecture.md. This block mirrors that operating model inline so the session stays governed even if the MCP `instructions` are momentarily stale; where the two disagree, the MCP `instructions` win because they are read fresh each connect.

HARNESS-HOOK STATE: a harness-hook context carrying a <subagent-mcp state="..."> tag reports subagent-mcp orchestration ON/OFF. It does not control Codex native subagents. A token counts as such a tag only when it is a real tag with a `state` attribute; a bare mention of "subagent-mcp" in prose is not a tag. A user request can switch MCP orchestration ON or OFF; the current state comes from the tag. No tag present means the MCP state is UNKNOWN (see NO-HOOK below).

PRECEDENCE (jointly binding top tier): <subagent-mcp> hook tags and repo/system safety-scope rules are both binding at the same priority — neither is read as outranking the other. If they genuinely conflict, stop and escalate to the user via the structured-question tool rather than picking one side or averaging them silently; this is intentionally not the agent's call to make alone. Hook tags otherwise take precedence over ordinary user requests, because they reflect harness-verified state rather than a request that could be mistaken or out of date.

CHANNEL BOUNDARY — BOTH ORCHESTRATION STATES: subagent-mcp `launch_agent` governs only agents launched through this MCP service. Codex native subagents are an independent channel: their availability, selection, launch, permissions, waiting, and outputs follow Codex, user, and project rules. No subagent-mcp option, hook state, Pi preference, Smart route, worktree rule, or service outage disables, redirects, or gates the Codex native channel. Pi may be preferred for suitable work, but Pi being forbidden, unavailable, or unsuitable never blocks Codex native subagents. Claude and Gemini native-agent restrictions remain host-specific.

DELEGATION CHOICE — MCP orchestration ON requires delegation for MCP-managed work; OFF or UNKNOWN removes that requirement and permits inline work. OFF or UNKNOWN does not disable `launch_agent` or automatic task-fit Pi delegation. Pi session mode is a separate choice: AUTO selects suitable bounded tasks, ON proactively uses Pi for them, and OFF prevents automatic Pi launches. If Pi mode is unset, follow explicit user and project Pi policy. Never infer Pi OFF from an OFF hook tag, a missing hook tag, or missing context usage. Explicit Pi requests still follow project, model, permission, and worktree rules. Codex native subagents remain independent.

ORCHESTRATION ON — you are the ORCHESTRATOR for MCP-managed work. MCP orchestration tools are the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex), subagent-mcp, and /workflows. Codex native subagent tools remain independently available in ON and OFF; using them follows Codex's own rules, not this MCP tool allowlist. There is no inline-by-right for MCP-managed steps. Applicable skill instructions may be read directly only within that skill's folder; action steps remain delegated. If an MCP-managed atomic step truly cannot be delegated, ask the user via the structured-question tool for a one-time exception for that step.

TASK TRACKING: track multi-step work with the harness-native task tracking tool (if one exists), keeping statuses current as work progresses.
WAIT-ON-AGENTS: use the subagent-mcp wait tool for MCP-launched agents. Codex native agents use Codex-native waiting and results; this MCP rule does not apply to them.

ORCHESTRATOR WORKTREE SETUP: before mutating work through subagent-mcp, place MCP-launched agents in a compliant linked worktree/work branch. This MCP worktree gate does not apply to Codex native subagents, which follow Codex and project rules. Serialize any agents that write the same files.

READ-ESCALATION LADDER FOR MCP-LAUNCHED AGENTS: (1) subagent-mcp `poll_agent` TAIL; (2) if insufficient, dispatch ONE MCP sub-agent to return a <=100-line summary; (3) anything larger: the USER reads it. Do not busy-loop poll_agent; learn completion via `wait`. MCP agents may exchange large data through scratch-file paths. Codex native subagent output and coordination follow Codex's own channel and are not limited by this MCP read ladder.

ORCHESTRATION OFF BY DEFAULT -- each new session starts with MCP orchestration OFF. A hook meters real provider-reported context usage. At 15% utilization, MCP planning coaching may run only if orchestration was explicitly enabled; the threshold does not turn it ON. At 20% utilization MCP handoff tools unlock. At 80% utilization a fresh MCP handoff-write is mandatory for MCP-managed work; keep working after a successful write. After verified auto-compaction, one MCP handoff-read turn resumes the prepared handoff. If context size cannot be measured, MCP orchestration remains OFF unless explicitly enabled. These thresholds do not gate Codex native subagents. Only the hook tag reports MCP orchestration state.

MODEL SELECTION: subagent-mcp launches default to smart/automatic; provider/model/effort selectors require its user-approved override window. This MCP setting never selects or restricts Codex native subagent models.

SWARM WORKFLOW: when a work objective is projected to span multiple sessions, offer the agentic-swarm workflow and drive it with the swarm MCP tool - swarm() starts it, each swarm(N) reports stage N done and returns the next stage's coaching, swarm(0) abandons. Stage state lives in the server, in memory only - never self-assert a stage. The launch_agent sub-orchestrator: true flag exists ONLY for the swarm dispatch stage; never set it elsewhere.

DROPOUT WHILE ON: if subagent-mcp stops responding while MCP orchestration is ON, halt only MCP-managed steps and resolve the state of any running MCP agent before rerouting its work. Codex native subagents remain available under Codex and project rules; MCP failure does not disable them or require waiting for MCP recovery. Do not silently duplicate an in-flight MCP mutation.

NO-HOOK / UNKNOWN STATE: if no harness-hook injection bearing a <subagent-mcp state="..."> tag is present this session (e.g. hooks are unsupported, unconfigured, or untrusted), the state is UNKNOWN — represented by the absence of any tag, never by a tag value. Emit this notice to the user: "subagent-mcp: no hook injection detected — orchestration state unknown; defaulting to OFF." Without a fresh, verified ON signal, do not impose ON's delegate-only rule; inline work is allowed. The separate Pi preference still governs whether suitable work may be delegated through `launch_agent`. Do not infer ON from the absence of a tag or from self-reported prose. The sub-agent first-line exemption still prevents child-session recursion.

DISABLE: never change MCP orchestration on your own initiative. Only explicit user approval may set enabled:false; user-approved enabled:true may re-enable mid-session. The setting is session-keyed, and each new session starts OFF. It has no effect on Codex native subagent availability or use.
<!-- subagent-mcp:managed:end -->

## Pi delegation preference

In each new Codex session ask once for Pi AUTO, ON, or OFF; a clear initial selection answers the question. Pending an answer, do not automatically launch Pi. AUTO chooses task-fit delegation when expected benefit exceeds handoff, review, and coordination cost. ON actively looks for useful bounded work but never delegates merely to use Pi or based only on file count. OFF prevents automatic Pi launches; explicit bounded Pi requests remain subject to project rules.

MCP orchestration defaults OFF and does not select Pi eagerness. Codex native subagents follow Codex, user, and project rules independently. MCP launches use only pi/pi-balanced/max. Smart routing applies that profile without explicit selectors. Explicit selectors require the MCP's approved override window. Respect project-specific prohibitions and configured blocked directories.
