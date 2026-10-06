[![English](https://img.shields.io/badge/Language-English-6e7781?style=for-the-badge)](README.md) [![繁體中文](https://img.shields.io/badge/Language-%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87-0969da?style=for-the-badge)](README.zh-TW.md)

# subagent-mcp Pi adapter

讓 Codex 透過本機 MCP 服務使用 Pi 工作代理。Pi 在獨立的 RPC 程序中執行，可在同一代理內接收後續訊息；Codex 原生子代理仍是獨立通道。

這是 [Heretyc/subagent-mcp](https://github.com/Heretyc/subagent-mcp) 的 Apache-2.0 衍生版本。請保留 [LICENSE](LICENSE)、[NOTICE](NOTICE) 和修改聲明。GitHub 原始碼位於 [LatentHarbor-create/subagent-mcp-pi-adapter](https://github.com/LatentHarbor-create/subagent-mcp-pi-adapter)。`private: true` 只防止發布到 npm，不會阻止建置或執行。

個人路徑已改成通用範例，原本機提交保留在發布目錄外；發布分支使用通用署名。詳見 [PRIVACY.md](PRIVACY.md)。

**使用前請填入自己的設定。** [CONFIGURATION.md](CONFIGURATION.md) 列出必填路徑、Pi 模型與登入、codemode、可選禁用目錄及設定缺失的症狀。範例不是可直接沿用的個人配置；原使用者的憑證和私人目錄規則不會隨原始碼提供。

## 主要設定

- MCP Smart 路由僅選擇 `pi / pi-balanced / max`。
- `pi-balanced` 是 adapter 設定名稱。實際供應商與模型由 Pi 的本機設定決定，adapter 請求 `max` 思考等級。
- MCP 編排預設 OFF。它和 Pi 使用傾向是兩個不同選項，OFF 仍允許符合 Pi 偏好的委派。
- Pi AUTO：依任務效益、成本、提示、協調和審查負擔判斷。
- Pi ON：積極尋找有淨效益的獨立工作，不強制委派，不因檔案數量就啟動。
- Pi OFF：不自動啟動 Pi；後續明確委派仍須遵守專案規則。
- MCP 設定和服務故障不會停用 Codex 原生子代理。原生通道仍須遵守 Codex 和專案規則。

## 安裝和建置

需要 Node.js 24、npm、Python 3，以及已設定模型與登入資訊的 Pi 1.0.0。

```powershell
npm install -g @earendil-works/pi-coding-agent@1.0.0
pi --version
git clone https://github.com/LatentHarbor-create/subagent-mcp-pi-adapter.git
cd subagent-mcp-pi-adapter
npm ci --ignore-scripts
npm run build
npm run test:pi
```

最後三條命令在本專案目錄執行。再將 [examples/codex-config.toml](examples/codex-config.toml) 的程式路徑換成你的絕對路徑，加入 Codex MCP 設定；完成後重新啟動宿主。若已有同名服務，先確認原本設定。

完整 `npm test` 含 Git 歷史檢查，需在 Git checkout 執行。解壓 ZIP 可以建置並執行 `npm run test:pi`。

## 每個新會話的 Pi 選擇

將 [examples/pi-session-policy.md](examples/pi-session-policy.md) 放入適用的 Codex 指令中。每個新會話問一次 AUTO、ON 或 OFF；使用者已明確選擇就直接採用，未回答前不自動啟動 Pi。

可以直接遵守會話中的回答。呼叫設定工具記錄選擇是可選步驟，可能產生宿主的工具授權提示；授權被拒絕不代表所有 MCP 功能都不可用。MCP 編排維持預設 OFF，不列入這個選擇題。

## 私人專案限制

`SUBAGENT_PI_BLOCKED_ROOTS` 接受 JSON 格式的絕對目錄陣列。該目錄及其子目錄禁止 MCP 啟動，設定錯誤會拒絕路由。仍須遵守每個專案的 Pi 禁用指令。

```toml
[mcp_servers.subagent-mcp.env]
SUBAGENT_PI_BLOCKED_ROOTS = '["C:/private-projects"]'
```

## 權限和驗證範圍

已驗證結構化權限請求的安全允許、受保護路徑拒絕，以及暫停等待後的允許和拒絕。這個橋接本身不提供完整作業系統隔離，也不代表每個工具執行都已自動攔截。Pi 程序使用宿主提供的權限。

adapter 不主動開啟 codemode；本配置保持關閉。真實模型回覆與同代理續傳曾在本機整合中驗證。整理副本的離線測試不等於重新驗證全部模型和平台。

完整的建置、測試及本機驗證命令請見 [README.md](README.md)。金鑰、登入檔、個人部署清單、模型會話和測試輸出應保留在倉庫外。
