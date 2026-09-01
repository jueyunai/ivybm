# Task Split

## 路由

- 产品/架构：原生 Codex 子代理只读审查；主代理冻结 PRD。
- Backend implementer：Codex 子代理，拥有 PlatformAccounts/API/policy/migration/worker gate。
- Frontend implementer：Codex 子代理，拥有 Platform 页面、CSS 与 UI tests。
- Reviewer：独立 Codex 子代理只读 review；主代理负责集成与最终判断。

## T14.1 数据与 API

- Owner：backend implementer
- 文件：`PlatformAccounts`、DTO/API、migration、generated types、相关 tests。
- 验收：默认 false、admin-only、revision conflict、redacted DTO、审计。

## T14.2 入站与出站双重 gate

- Owner：backend implementer
- 文件：platform conversation policy/port、ConversationService server-only contract、delivery authority、worker wiring、tests。
- 验收：暂停仍落库；无 AI/outbound；竞态 provider I/O=0；人工消息不受影响。

## T14.3 平台账号页 UI

- Owner：frontend implementer
- 文件：`PlatformReadinessPage.tsx`、Portal CSS、UI/unit/E2E tests。
- 验收：摘要卡 + 管理对话框；无内嵌拥挤表单；390px 无横向滚动；键盘/焦点/状态反馈通过。

## T14.4 集成、Review 与 QA

- Owner：主代理 + 独立 reviewer
- 验收：定向 lint/typecheck/unit/integration/operations/E2E；桌面和 390px 截图；PR 风险/回滚完整。

## 外部 blocker

- 真实 Meta canary 必须在代码合并、production 备份、审批和重新授权后执行；本地 fixture 不算真实平台通过。
