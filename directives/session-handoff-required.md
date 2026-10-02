<!-- Modified for the subagent-mcp Pi adapter fork. -->
Handoff lifecycle: `session_handoff_required` - a generation-scoped duty that fires for exactly one turn.

Call `handoff-read` for MCP-managed work now. Do not resume that MCP handoff until the read completes. Codex native subagent work is independent of this MCP lifecycle step.

After a successful `handoff-read`, confirm intent with EXACTLY 4 structured confirmation questions in a single structured-question call before acting on the saved handoff. Then resume the handoff's stated work.
