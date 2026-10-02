<!-- Modified for the subagent-mcp Pi adapter fork. -->
# subagent-mcp Pi adapter

Pi workers for Codex through a local MCP stdio server. The adapter keeps a Pi RPC process alive across messages, applies the shared permission bridge, and reports completion after the Pi session settles. Codex native subagents remain an independent channel.

This is an Apache-2.0 derivative of [Heretyc/subagent-mcp](https://github.com/Heretyc/subagent-mcp). See [LICENSE](LICENSE), [NOTICE](NOTICE), and [MODIFICATIONS.md](MODIFICATIONS.md). The package is private while GitHub owner and publishing metadata are pending.

See [PRIVACY.md](PRIVACY.md) for the publication boundary and generic configuration examples.

## Behavior

- Smart MCP routing selects only `pi / pi-balanced / max`.
- `pi-balanced` is an adapter profile, not the physical model name. Pi uses its locally configured provider and model; the adapter requests thinking `max`.
- MCP orchestration defaults OFF. OFF does not disable Pi launches allowed by the separate Pi preference.
- Pi AUTO weighs task fit and coordination cost. ON actively looks for beneficial bounded delegation. OFF prevents automatic Pi launches. None requires delegation merely because a task contains many files.
- The adapter does not gate or redirect Codex native subagents.
- `agent_settled` completes a turn. Follow-up input uses `prompt` with `streamingBehavior: followUp`, so an idle Pi starts work and an active Pi queues it.
- Permission requests use the shared verdict, ceiling, and pending-approval bridge. A rejected setting operation does not establish that every MCP tool is unavailable.

## Prerequisites

- Node.js 24, npm, and Python 3 on PATH. The Python ruleset runs during MCP launches.
- Pi coding agent 1.0.0, installed and configured locally.
- Codex with MCP stdio support.

```sh
npm install -g @earendil-works/pi-coding-agent@1.0.0
pi --version
```

Configure and sign in to the desired provider using Pi. Do not put credentials in this repository. The adapter integration is tested with Pi 1.0.0; newer Pi versions need verification.

## Build from source

From this checkout:

```sh
npm ci --ignore-scripts
npm run build
npm run test:pi
```

`npm test` runs the broader inherited test suite. Dependency installation does not register the MCP server or change Codex settings.

## Register the MCP server

Use an absolute path to your built `dist/index.js`:

```toml
[mcp_servers.subagent-mcp]
command = "node"
args = ["/absolute/path/to/subagent-mcp-pi-adapter/dist/index.js"]
enabled = true
```

On Windows, a TOML literal string avoids backslash escaping:

```toml
args = ['C:\projects\subagent-mcp-pi-adapter\dist\index.js']
```

See [examples/codex-config.toml](examples/codex-config.toml). If a server with this name already exists, review its entry rather than adding a duplicate. Restart the host after changing its MCP configuration.

## Pi session preference

Use [examples/pi-session-policy.md](examples/pi-session-policy.md) in the applicable Codex instructions to ask once per new session for AUTO, ON, or OFF. Until answered, do not automatically launch Pi. An existing answer can be followed directly; recording it through `orchestration-mode` is optional and may require host tool approval.

MCP orchestration is a separate setting and defaults OFF without an enable question. Do not require orchestration ON before suitable Pi delegation. Pi OFF never disables Codex native subagents.

## Block private directories

The ruleset accepts `SUBAGENT_PI_BLOCKED_ROOTS`, a JSON array of absolute directory paths. It vetoes MCP launches for those directories and descendants. An absent value means an empty list. Invalid configuration fails the ruleset; it does not silently route elsewhere.

```toml
[mcp_servers.subagent-mcp.env]
SUBAGENT_PI_BLOCKED_ROOTS = '["C:/private-projects", "C:/confidential"]'
```

This is an additional launch restriction. Honor project instructions even if a directory is not in this list. It does not alter the Codex native channel.

## Permission scope and codemode

The permission bridge transports structured requests from the shipped `ask_permission` extension. Safe allow, protected-path deny, pending allow, and pending deny are tested. This is not comprehensive operating-system isolation or proof that every tool execution is automatically intercepted. Pi commands execute with the child process's host permissions.

This adapter does not enable codemode. Keep Pi codemode disabled for the documented configuration. Codemode execution interception is outside this integration's verified scope.

## Optional local verification

```sh
node scripts/verify_pi_rpc.mjs --pi-cli /absolute/path/to/pi/dist/bundle/cli.js --output /outside/repository/pi-verification.json
```

The script uses local Pi configuration and runs synthetic permission dialogues without performing the represented file operations. Add `--model-smoke` only when a real provider request is authorized; it incurs a small model request and checks the configured physical model and thinking level. It does not copy or print auth values.

## Development and upstream

See [CONTRIBUTING.md](CONTRIBUTING.md). [Inherited engine documentation](README.upstream.md) describes the general subagent-mcp framework; this README defines the Pi-only launch profile. Inherited npm and marketplace installation examples install the upstream package, not this private fork preparation.

No registry publisher or external-agent workflow is configured in this preparation. Registry update checks and the `update`, `--update`, and `upgrade` commands are disabled while the package is private. The Codex marketplace catalog stays empty until the fork URL is supplied; use the direct MCP registration above. A GitHub repository name, owner, and publication decision must be supplied separately.

繁體中文說明：[README.zh-TW.md](README.zh-TW.md).
