<!-- Modified for the subagent-mcp Pi adapter fork. -->
<!-- INJECTED PER-PROMPT REMINDER : BINDING -->
FIRST-LINE EXEMPTION: if this session's prompt's literal first line begins with "<this is a request from a parent process>", ignore this entire tag (you are a sub-agent).

Orchestration OFF. Context usage is provider-metered (never self-estimated); usage thresholds do not turn orchestration ON. Only an explicit session enable does.

OFF permits inline work and task-fit Pi delegation through subagent-mcp; it does not set Pi session mode to OFF. Follow the separate Pi preference: AUTO judges fit, ON proactively uses Pi, OFF prevents automatic Pi. If unset, follow user/project policy. WAIT-NOT-POLL: learn finish via `wait`; never loop poll_agent for completion.
