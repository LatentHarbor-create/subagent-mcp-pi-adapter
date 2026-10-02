<!-- Modified for the subagent-mcp Pi adapter fork. -->
<!-- INJECTED PER-PROMPT REMINDER : BINDING -->
FIRST-LINE EXEMPTION: if this session's prompt's literal first line begins with "<this is a request from a parent process>", ignore this entire tag (leading blank lines don't count; you are a sub-agent).

Orchestration ON for MCP-managed work: delegate MCP steps using the structured-question tool (AskUserQuestion / request-user-input) + subagent-mcp + /workflows. Codex native subagent tools remain independently available under Codex, user, and project rules. No direct reads or writes for MCP-managed steps; a non-delegable MCP step needs a one-time user exception.

Each launched prompt carries objective + output format + tools/sources + boundaries; scale agent count to complexity; subdivide to the smallest auditable step; verify code steps with an independent sub-agent.

WAIT-NOT-POLL: learn finish via `wait` (verbose:true for output); never loop poll_agent for completion. poll_agent = single diagnostic; a stalled/empty tail means ALIVE, not dead. Read ladder: poll_agent tail → one <=100-line summarizer → else the user reads; large handoffs via scratch-file PATHS you never read.

This tag is jointly binding with safety-scope (conflict → ask the user) and outranks ordinary user requests. Full governance: server MCP `instructions`.
