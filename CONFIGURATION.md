# Configuration / 使用前設定

Personal configuration is intentionally absent. Source installation does not install Pi, select a physical model, authenticate a provider, register Codex hooks, or copy private-directory restrictions from the original installation.

原始碼不包含個人配置。安裝原始碼不會代你安裝 Pi、選擇實際模型、登入供應商、註冊 Codex hooks，或複製原使用者的私人目錄限制。

## Required for Pi workers / Pi 工作代理必需

| Setting / 設定 | Where and what to fill in / 位置與內容 | If missing / 缺少時 |
| --- | --- | --- |
| Node.js 24 and npm | Install locally. MCP `command = "node"` requires the host's PATH to find Node. Otherwise set `command` to your absolute Node executable path. | MCP server cannot start. / MCP 無法啟動。 |
| Built adapter path | Run `npm ci --ignore-scripts` and `npm run build`. Replace MCP `args[0]` with the absolute path to this checkout's `dist/index.js`. | An example path will not load the adapter. / 範例路徑無法載入程式。 |
| Python 3 | Put Python on the MCP host's PATH, or set `SUBAGENT_RULESET_PYTHON` to your absolute Python executable path in the MCP `env` table. The ruleset needs only the standard library. | Tools may load but launches fail the ruleset check. / 工具可能載入，但委派會因規則檢查失敗。 |
| Pi 1.0.0 CLI | Install `@earendil-works/pi-coding-agent@1.0.0` using npm. Verify `pi --version`. Windows lookup uses the npm global prefix. | Launch fails because Pi is unavailable. / 找不到 Pi，無法委派。 |
| Physical provider and model | Start Pi locally; use its `/login` and `/model` flows. Choose and persist a model supported by your account. `pi-balanced` is an adapter alias; it is not a provider's model ID. | Without configured credentials, Pi may report an unknown model; completion requests cannot work. / 沒有登入或模型設定，可能顯示 unknown 或無法回覆。 |
| Provider authentication | Complete Pi's local login flow. Keep authentication in Pi's user configuration, outside this checkout. Use real local credentials for actual model requests; examples and test placeholders are not credentials. | The provider cannot authenticate a completion request. / 模型請求無法驗證登入。 |
| Codemode disabled | In Pi's user-level `settings.json`, set `"codemode": false`. Preserve other settings and auth files. | Enabled codemode is outside this adapter's verified permission scope. / 開啟 codemode 不在本整合已驗證的範圍內。 |

Pi's default user configuration directory is `~/.pi/agent/`; on Windows it is under the current user's profile. `settings.json` stores `defaultProvider`, `defaultModel`, and `codemode`. `auth.json` is private authentication state and must never be committed. An explicitly configured `PI_CODING_AGENT_DIR` changes that directory; make sure Pi and the MCP host use the intended configuration.

Pi 預設使用目前使用者的 `~/.pi/agent/`。`settings.json` 的 `defaultProvider` 和 `defaultModel` 應由你自己的 Pi 模型設定決定，`codemode` 保持 `false`。`auth.json` 是私人登入檔，不可加入倉庫。若自行設定 `PI_CODING_AGENT_DIR`，請確保 Pi 和 MCP 宿主指向同一個預期配置。

The adapter requests thinking level `max`. Actual support depends on the selected physical model. The optional verification script checks the reported model and thinking level; selecting a model that cannot report `max` does not reproduce the verified configuration.

adapter 請求 `max` 思考等級，實際支援程度由模型決定。可選驗證腳本會檢查模型與思考等級；不支援 `max` 的模型不會重現已驗證配置。

## Optional / 可選設定

| Setting / 設定 | Default / 預設 | When to configure / 何時設定 |
| --- | --- | --- |
| `SUBAGENT_PI_BLOCKED_ROOTS` | Unset means `[]`, with no extra directory block. / 不設定就是空清單。 | Add absolute private-project paths as a JSON array. These paths and descendants veto MCP launches; malformed values fail closed. Does not gate native Codex agents. / 將私人專案的絕對路徑填入 JSON 陣列，才會增加目錄限制。 |
| Session AUTO / ON / OFF policy | MCP does not choose eagerness from its orchestration OFF state. | Apply [examples/pi-session-policy.md](examples/pi-session-policy.md) in applicable Codex instructions for the once-per-session question. / 需要每次詢問時，加入範例指令。 |
| Codex SessionStart / UserPromptSubmit hooks | Direct MCP registration supplies tools without registering these hooks. | Configure separately if you want verified per-turn orchestration/session reminders. Hook trust and configuration belong to the host. / 需要經驗證的編排狀態提示時，另行設定與信任 hooks。 |
| MCP permission policy | Default shipped ceiling is `auto`. | Review permissions for your own project. Provider login is separate from host tool approval; do not enable yolo to fix missing configuration. / 模型登入與工具授權是兩件事，不要用 yolo 代替設定。 |

The shipped [examples/codex-config.toml](examples/codex-config.toml) contains placeholders. Replace paths; set the optional blocked-roots list to real directories you own, or omit its line if you do not need an extra directory restriction. Do not leave example paths believing they protect your actual private projects.

範例的路徑要替換。禁用目錄如有需要，就填入你自己的真正目錄；不需要額外限制時可省略該行。保留範例路徑不會保護其他私人專案。專案本身禁止 Pi 的指令仍須遵守。

This Pi-only profile does not require Claude/Codex external-provider credentials, `providers.jsonc`, or an upstream `.env` provider scaffold. Codex native subagents remain governed by the host's independent channel.

本 Pi-only 配置不要求外部 Claude/Codex 供應商憑證、`providers.jsonc` 或上游 `.env` 範例；Codex 原生子代理仍走宿主的獨立通道。

## Check installation / 驗證安裝

1. Run `pi --version` and confirm `1.0.0`; start Pi and verify your model is selected.
2. Build the adapter and run `npm run test:pi`. This is an offline fixture test, not a live credential or provider test. Full `npm test` requires a Git checkout.
3. Replace the MCP paths, then restart Codex. Confirm `get_status`, `launch_agent`, `wait`, and `respond_permission` appear in the connected MCP tool list.
4. For optional real-CLI checks, use the README verification command with your actual Pi bundle path. Without `--model-smoke`, it exercises synthetic permission dialogues. It still needs configured local model/auth state to verify model selection. `--model-smoke` makes a paid provider request and requires separate authorization.
5. If launches fail, check Node/Python/Pi paths, Pi model/login, and blocked-directory rules before changing orchestration. Orchestration OFF does not disable suitable Pi delegation.

依序檢查版本、模型登入、建置測試和宿主工具列表。離線測試不代表憑證或實體模型請求成功；需要真實回覆時才授權使用 `--model-smoke`。修正路徑或登入，不需要先把編排切成 ON。
