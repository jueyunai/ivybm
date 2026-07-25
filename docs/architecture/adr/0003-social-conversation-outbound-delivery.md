# ADR-0003：社媒会话 AI 出站投递边界

- 状态：Proposed（须由 jueyunai review 后才能作为跨人契约基线）
- 日期：2026-07-25
- 关联：Task 9、Task 10、Task 13、[ADR-0001](0001-human-handoff-domain-boundary.md)

## 背景

一期需求要求官网和首批社媒会话共用 AI 初筛：AI 先回答常见问题、追问需求并在高意向或高风险时转人工。当前 Task 13 已能把 Meta 入站事件可靠地落入统一会话服务；在没有平台账号、授权和出站 adapter 时，它会形成持久人工接管，而不会把未投递的 AI 文案伪装成已发送回复。

实施计划此前只列出入站会话与图文发布的 ports，未明确社媒会话的 AI 出站投递。这会造成“需求要求先回复、实现只能接管”的口径缺口。

## 决策

### 1. 一期会话出站范围

- 自动会话出站仅面向 Facebook Messenger、Instagram DM 和 TikTok 私信；TikTok 仍须等待目标地区的官方 DM schema、权限和审核后才能实现 adapter。
- LinkedIn 私信与 WhatsApp 不属于一期自动会话出站范围。
- 图文发布仍走独立的 `PublishingService`，不复用本 ADR 的会话出站 port。

### 2. 无账号阶段的诚实降级

- 未取得对应平台的账号、授权、允许的消息窗口或可用 adapter 时，社媒入站继续进入权威会话服务并走人工接管；不得持久化或向运营界面宣称一条 AI 回复已经发送。
- 可以先交付 server-only TypeScript port、fake adapter、fixture 和失败注入测试。它们只证明内部契约，绝不代表平台 `available`，也不允许真实网络、SDK 或 token。
- “辅助回复”仅能表示明确标为未发送的运营草稿。当前阶段不新增运营 UI、临时 Collection 或替代 migration；在该 UI 和数据语义被单独设计前，默认行为仍是人工接管。

### 3. 自动投递的权威边界

- `ConversationService` 是是否可由 AI 回复的唯一权威来源。`handoff_requested`、`human_active` 和 `resolved` 状态均不得自动出站；在入队前和 worker 真正调用 adapter 前都必须再次检查这一条件。
- 自动投递不得在 webhook HTTP handler、浏览器 Route 或同一入站数据库事务内同步调用平台。它必须先以稳定 `deliveryKey` 持久化为 Job / outbox，再由 Task 10 worker 处理。
- `deliveryKey` 由调用方以平台、平台账号和稳定的内部回复身份构造；adapter 只消费该 key 并确保重复执行不重复发送。平台 provider 的具体幂等字段只能在官方 schema 已确认后映射。
- `sent`、`delivered`、`read` 等状态只表示 adapter 已取得对应的真实 provider 证据。真实 provider 证据必须由经 review 的平台 delivery 状态 / callback 路径保存；共享 `ChatMessage.status` 不能单独作为 provider 已投递的断言。fake 的测试结果不得写入 production 会话或改变共享 `ChatMessage` 状态语义。

### 4. 分阶段门槛

| 阶段                 | 允许的工作                                                        | 必须满足的条件                                                                                                                    |
| -------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 接口 / 纯逻辑        | 出站 port、fake adapter、fixture、契约和失败注入测试              | 不创建 / 修改共享 Collection、migration 或 Payload 配置；无网络、无 token；跨人 port 先 review                                    |
| 数据库 / worker 集成 | outbox / Job handler、会话状态二次检查、重试、dead job 和人工补偿 | `Conversations` / `Messages`、Task 10 Jobs / worker、`PlatformAccounts` 及其 migration / Payload 注册 / 类型均已合并到最新 `main` |
| 外部平台联调         | Meta 或 TikTok adapter、Webhook / 送达回调、受控测试消息          | 平台账号、允许的权限 / App Review、受控 production 窗口、官方目标 schema 和部署 secret 已就绪                                     |

## 测试与验收

纯逻辑测试至少覆盖：重复 `deliveryKey`、retryable 与不可重试错误、限流重试提示、人工接管后的出站抑制、worker 重领后的不重复投递，以及 fake 不触发网络。真实平台能力只能在受控环境完成授权与目标操作实测后标记为 `available`。

## 后果

Task 13 可以在无账号阶段补齐隔离的出站 contract / fake / 测试，但不得改变 Task 9 的共享会话状态语义或绕过其人工接管状态机。真实自动发送仍受账号、官方审核、`PlatformAccounts`、持久 Job 和平台 adapter 的共同门槛约束。

## 拒绝的方案

- 在入站 webhook 中同步调用平台 Send API：会破坏幂等、重试与进程崩溃恢复。
- 将 fake 或未授权的 AI 文案记录为已发送：会误导运营人员并让人工接管失效。
- 为未合并的 `PublishJobs` / `PublishLogs` 或 TikTok schema 创建临时 Collection / migration：会制造错误的共享数据基线。
