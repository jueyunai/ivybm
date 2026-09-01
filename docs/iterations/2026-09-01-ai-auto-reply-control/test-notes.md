# Test Plan / Notes

| ID | 场景 | 期望 | 证据 |
| --- | --- | --- | --- |
| AR-API-01 | admin 暂停/恢复账号 | 值和 revision 原子更新，DTO 返回真实状态 | integration |
| AR-API-02 | 非 admin / stale revision | 403 / 409，无写入 | integration |
| AR-DB-01 | 旧库 migration | 既有账号默认 false，字段非空 | migration/integration |
| AR-IN-01 | 暂停账号合法 Meta 入站 | Webhook/Job/Conversation/visitor Message 成功，无 AI Message | contract + integration |
| AR-IN-02 | 恢复后新消息 | 新消息进入现有 AI 流；旧消息不重放 | integration |
| AR-RACE-01 | AI intent 入队后暂停 | claim 阻断，provider I/O=0，不重试 | integration |
| AR-HUMAN-01 | human_active + 账号开启 | 不自动回复；operator reply 可出站 | integration |
| AR-UI-01 | 桌面账号卡/管理对话框 | 状态唯一、操作分层、无裸控件 | Playwright + screenshot |
| AR-UI-02 | 390px | 无横向滚动、按钮≥44px、长文本换行 | Playwright + screenshot |
| AR-A11Y-01 | 键盘/对话框/状态通知 | 焦点、Esc、aria、alert/status 可用 | Playwright |
| AR-SEC-01 | API/审计/log | 不暴露 Token、正文、provider payload | unit/integration review |
| AR-PROD-01 | 真实 Instagram/Facebook canary | 暂停只落库不回复；开启后新消息回复 | production UAT（blocked until release） |

## 当前证据

- Unit：107/107；Contract：16/16。
- PlatformAccounts / conversation delivery integration：20/20。
- Migration snapshot：4/4；typecheck、改动文件 ESLint、`git diff --check`：通过。
- 平台页本地 E2E：7/7，覆盖桌面、390px、摘要/诊断折叠和账号管理流程。
- Compose/preflight operations：本机缺少 Docker CLI，未运行成功，等待 GitHub CI。
- 真实 Facebook/Instagram canary：未运行，必须在 PR 合并、生产审批和账号授权后执行。
