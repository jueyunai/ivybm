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
- `deliveryKey` 由 `ConversationService` 以平台、平台账号和稳定的内部回复身份构造；adapter 只消费该 key。只有平台官方 schema 确认支持请求幂等键时，adapter 才能映射该 key 并把重试声明为安全；其他平台必须遵循第 5 节的查询或未知结果语义。
- `sent`、`delivered`、`read` 等状态只表示 adapter 已取得对应的真实 provider 证据。真实 provider 证据必须由经 review 的平台 delivery 状态 / callback 路径保存；共享 `ChatMessage.status` 不能单独作为 provider 已投递的断言。fake 的测试结果不得写入 production 会话或改变共享 `ChatMessage` 状态语义。

### 4. 调用方向与状态所有权

- `ConversationService` 在同一权威命令/事务内决定是否生成自动回复、分配稳定内部回复身份，并创建对应的 delivery intent / outbox。连接器、Webhook HTTP handler、浏览器 Route 和平台 adapter 都不能自行创建投递 intent 或直接调用 provider。
- AI 文本生成和平台 transport 都不得持有该数据库事务；事务只原子持久化已决定的内部回复身份、delivery intent / outbox 与权威状态变化，随后才由 worker 调用外部平台。
- delivery intent / outbox 持有业务投递生命周期：`queued`、`retrying`、`blocked`、`failed`、`dead`、`delivery_unknown`。Task 10 的 Job 行只持有抢占、lease、attempt 与 worker 执行状态；不得把 Job 的 `succeeded` 等同于平台已送达，也不得把共享消息状态当作 delivery lifecycle。
- worker 只能领取由该 intent 创建的 Job。持久 delivery intent 必须保存创建它的 Task 10 `jobId`，Job payload 只携带可反查该 intent 的稳定引用；authority 在 claim 和 provider-I/O 标记事务内同时校验 Job ↔ intent 绑定、`conversationId + replyId + deliveryKey + expectedRevision`、当前 revision 及 `ai_active`，不能信任可变 Job payload 自称的完整 intent。handoff 转换必须与 active claim 使用同一 authority 串行化：接管先提交则旧 intent 无法 claim，claim 已开始则接管不得先提交为 `human_active` 再发生自动发送。单纯“读取状态后调用 adapter”存在 TOCTOU，不满足本约束。
- claim 必须携带 Task 10 Job lease evidence：`jobId + ownerToken + leaseExpiresAt`，并带单调 fencing generation。其中 `jobId + ownerToken` 是一次持有期内的稳定 fence identity；`leaseExpiresAt` 只证明当前新鲜度，正常 heartbeat 延长 expiry 不得使同一 owner 的 claim 失效。持久 authority 必须在 claim、provider-I/O 标记和 release 边界读取当前 Jobs row，原子核验 owner 仍匹配且当前 expiry 未过期；仅在 handler 外预先调用 `assertLease()` 不足以消除 TOCTOU。worker 崩溃、lease 到期或 owner 被替换后，authority 必须在新 claim 时原子回收旧 active claim：I/O 未开始可重新 `send`，I/O 已开始则建立 recovery obligation，新 owner 必须先以 `recover` 模式查询同一完整 intent。只有 recovery 明确返回 `retry_same_delivery_key`，且新 owner 重新取得当前 fencing generation 的 provider-I/O 标记时，才允许一次相同 payload、相同 delivery key 的 send；其他 recovery 结果不得 send。持久 authority、lease 回收和 handoff 串行化必须由后续 Task 10 / Conversation repository 集成共同实现，本 PR 的内存 fake 只冻结协议和故障注入行为。
- authority 的拒绝结果必须可判别：active claim / lease 冲突属于可恢复的 worker 竞争，不能伪装成人工接管；只有权威状态明确不再是 `ai_active` 时才返回 `handoff_required`，旧 revision 和缺失 / 不匹配 intent 也必须保持独立的 fail-closed 语义。
- claim 返回权威 intent 的防御性快照，不能信任可变 Job payload。adapter 只接收平台、外部账号、收件人、文本及 `deliveryKey` 这些受控 transport 字段；不能接收 `conversationId`、`replyId`、revision、handoff 状态或外部 thread 等会话内部状态，也不能直接写会话、消息、handoff、审计或 delivery 状态。
- worker 将 adapter 的结果回传给 `ConversationService` 的受信内部命令，由它以内部回复身份和 `deliveryKey` 围栏更新 delivery intent / provider 证据并产生后续领域事件。平台送达 callback 也必须经同一受信命令归并，不能绕过会话状态机。

### 5. Provider 已接受但结果未知

当 provider 已接受发送、但 worker 在持久化结果前崩溃、超时或失去 lease 时，结果不是自动重试，而是按已审核的平台能力收敛：

1. 平台支持请求幂等键时，adapter 必须把同一 `deliveryKey` 映射到该字段；重领 worker 只能用相同 key 重试。
2. 平台不支持幂等键、但支持按稳定外部 ID 查询结果时，重领 worker 必须先查询并归并真实证据，确认未发送后才允许再次发送。
3. 两者都不支持或无法确认结果时，delivery intent 必须进入 `delivery_unknown`，停止自动重发并提供人工补偿 / 核对入口；不得猜测为 `sent`、`failed` 或盲目重发。

`delivery_unknown` 是业务投递状态，不是普通 Job retry。只有经人工核对、平台 callback 或受控查询取得证据后，才可由权威会话命令转为已知状态或创建新的人工补偿 intent。

adapter 在请求越过 provider 发送边界后丢失响应时，必须抛出公共、可判别且脱敏的 `PlatformConversationOutboundOutcomeUnknownError`：`code = delivery_unknown`、`retryable = false`，并携带 platform 与原 delivery key。应用层捕获后只调用 `recoverUnknownOutcome()`；恢复失败、正常结果身份不匹配、recovery 身份不匹配或 adapter 抛出未分类异常也收敛为 `delivery_unknown`，不得让它们落入 Task 10 的普通 `queue.fail()` 重试。claim release 失败不能把 accepted / provider-accepted 结果解释为普通可重试失败，也不能把 provider 已明确返回的限流、权限拒绝等 confirmed blocked 结果错误改写为 unknown。只有 provider I/O 标记之前的 authority 失败可作为脱敏的普通 Job 失败处理。

### 6. 分阶段门槛

| 阶段                 | 允许的工作                                                        | 必须满足的条件                                                                                                                    |
| -------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 接口 / 纯逻辑        | 出站 port、fake adapter、fixture、契约和失败注入测试              | 不创建 / 修改共享 Collection、migration 或 Payload 配置；无网络、无 token；跨人 port 先 review                                    |
| 数据库 / worker 集成 | outbox / Job handler、会话状态二次检查、重试、dead job 和人工补偿 | `Conversations` / `Messages`、Task 10 Jobs / worker、`PlatformAccounts` 及其 migration / Payload 注册 / 类型均已合并到最新 `main` |
| 外部平台联调         | Meta 或 TikTok adapter、Webhook / 送达回调、受控测试消息          | 平台账号、允许的权限 / App Review、production 或等价受控真实环境、官方目标 schema 和部署 secret 已就绪                            |

## 测试与验收

纯逻辑测试至少覆盖：重复 `deliveryKey`、跨账号对抗键、retryable 与不可重试错误、限流重试提示、旧 revision / 人工接管后的零发送、active claim 与接管转换串行化、worker 重领后的不重复投递、provider 已接受后进程死亡 / 结果未持久化，以及 fake 不触发网络。未知结果必须分别覆盖 provider 幂等键重试、状态查询归并和 `delivery_unknown` 人工补偿三条路径，并证明最终 unknown 不进入 Task 10 普通失败重试。真实平台能力只能在 production 或等价受控真实环境完成授权与目标操作实测后标记为 `available`。

## 后果

Task 13 可以在无账号阶段补齐隔离的出站 contract / fake / 测试，但不得改变 Task 9 的共享会话状态语义或绕过其人工接管状态机。真实自动发送仍受账号、官方审核、`PlatformAccounts`、持久 Job 和平台 adapter 的共同门槛约束。

## 拒绝的方案

- 在入站 webhook 中同步调用平台 Send API：会破坏幂等、重试与进程崩溃恢复。
- 将 fake 或未授权的 AI 文案记录为已发送：会误导运营人员并让人工接管失效。
- 为未合并的 `PublishJobs` / `PublishLogs` 或 TikTok schema 创建临时 Collection / migration：会制造错误的共享数据基线。
