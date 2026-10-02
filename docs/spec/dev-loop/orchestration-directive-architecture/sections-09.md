<!-- Modified for the subagent-mcp Pi adapter fork. -->
<!-- Part of orchestration-directive-architecture (split from sections-05-09.md). Retrieval map: ../orchestration-directive-architecture.md -->

## section 9 : Cross-Provider Behavior (D6 / D7 / D18)

| Host | Hook fires? | `state` source | Structured-question tool | Behavior |
|---|---|---|---|---|
| Claude Code CLI | Yes | hook tag | `AskUserQuestion` | authoritative ON/OFF |
| Codex CLI | Yes | hook tag | `request-user-input` | authoritative ON/OFF |
| Codex Desktop with trusted hooks | Yes | hook tag | `request-user-input` | authoritative ON/OFF |
| Gemini CLI | No | tag absent | n/a | UNKNOWN, notify, default OFF (section 5) |
| Hosts with unsupported, unconfigured, or untrusted hooks | No | tag absent | n/a | UNKNOWN, notify, default OFF (section 5) |

The supremacy clause (A4) is byte-identical in all three host files regardless
of whether that host fires hooks. Default OFF lives in the INIT_BLOCK and MCP
`instructions` prose. Hook-core emits `""` on any error and for any sub-agent
turn, never a `<subagent-mcp>` tag.
