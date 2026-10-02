<!-- Modified for the subagent-mcp Pi adapter fork. -->
# Install : Codex Desktop

Codex Desktop can run the same `SessionStart` and `UserPromptSubmit` command
hooks as Codex CLI. User hooks must be reviewed and trusted before they run.
Until then, the MCP server can answer tool calls, but no hook tag is injected;
the instruction fallback treats orchestration as UNKNOWN and defaults to OFF.

Do the [build prerequisite](_INDEX.md) first.

---

## Configure the server (shared with the CLI)

The Desktop/IDE extension and the Codex CLI **share one** `~/.codex/config.toml`
(Windows: `C:\Users\YourName\.codex\config.toml`). If you already registered the
server for the CLI, **it is already available here** : no second step.

If you have not registered it yet, add it once:

```toml
[mcp_servers.subagent-mcp]
command = "node"
args = ["/abs/path/to/subagent-mcp/dist/index.js"]
startup_timeout_sec = 10
tool_timeout_sec = 60

# Windows: forward slashes (or doubled backslashes) in TOML
# args = ["C:/Users/YourName/Dropbox/subagent-mcp/dist/index.js"]
```

Or via the CLI helper (writes the same shared file):

```bash
codex mcp add subagent-mcp -- node /abs/path/to/subagent-mcp/dist/index.js
```

Configure the [Codex CLI guide](codex-cli.md) `~/.codex/hooks.json` entries for
both `SessionStart` and `UserPromptSubmit`. Review and trust both definitions
in Codex before expecting hook injection. `SessionStart` emits the initial ON
or OFF tag; `UserPromptSubmit` refreshes the tag on each prompt and carries
the independent Pi session preference.

---

## Verification

1. **Build present:** confirm `dist/index.js` exists.
2. **Tools appear:** open the extension and confirm the `subagent-mcp` tools
   (`orchestration-mode`, `launch_agent`, etc.) are listed via the shared
   `config.toml`.
3. **Hook trust:** confirm both user hooks have been reviewed and trusted.
4. **State tag:** start a new session and confirm a `<subagent-mcp state="off">`
   tag is injected by default. An explicit session enable changes it to ON.
   Pi delegation preference remains separate in either state.
