# 统一会话待接管死锁解除与飞书即时通知增强设计方案

- **状态**：Draft，待另一名开发者完成共享会话/飞书/任务队列边界 Review 后实施
- **实施分支**：`fix/handoff-pending-lead-capture`
- **基线**：`origin/main`（创建 worktree 时为 `80c5441`，当前已 rebase 同步至 `b345f43`）
- **目标闭环**：官网 ChatWidget → 待接管期间继续留资 → Lead → 飞书即时接管通知
- **Review 边界**：涉及 `Conversations` / `Handoffs` 领域状态、Lead 持久化、跨模块飞书契约以及通用 `Jobs` 队列重试/dead-letter 保护边界，合并前必须由另一名开发者 Review
- **预计工作量**：1.5–2 个工作日；占用当前开发者唯一功能 PR 槽位，实施期间暂停同负责人非阻断优化，不与现有会话优化分支混合开发或合并

## 1. 概述与背景

### 1.1 现状与核心痛点

统一会话（`conversations`）在对接官网（Website ChatWidget）并联动 Lead / 飞书 CRM 的流转链路中，存在以下阻断转化的核心痛点。社媒渠道继续复用同一会话状态机与 Handoff 通知，但本期不改变社媒入站消息的 Lead 再评估或自动出站语义：

1. **访客输入死锁（Handoff Input Deadlock）**：
   - 当会话因触发高意向商机（`high_intent`）、需求收集完成（`qualification_complete`）、敏感话题（`high_risk_topic`）或访客主动点击转人工而进入 `handoff_requested`（待接管）状态后，`src/modules/conversations/handoffState.ts` 针对访客视角返回了空动作集 `[]`；
   - 导致前台聊天挂件的输入框被直接禁用（`disabled`）。海外访客即使想主动提供电子邮箱、WhatsApp 手机号或补充工程图纸，也完全无法在界面上键入任何内容。
2. **高价值商机转化为 Lead 链路阻断（Lead Conversion Blocked）**：
   - 系统底层的线索转化规则明确规定：会话被评定为 A 级意向商机后，必须具备持续有效联系方式（邮箱、电话或社媒身份）才能正式实例化为 `leads` 记录（见 `payloadRepository.ts:91`）；
   - 在访客输入框被锁死的情况下，未能在前期留下联系方式的高意向客户彻底失去了补充联系方式的入口，导致商机卡死在待接管状态，无法沉淀到销售团队的 CRM 中。
3. **已有 Lead 跟进状态被破坏回退（Lead Status Regression）**：
   - `payloadRepository.ts:432` 在客户后续消息更新已有关联 Lead 时，数据更新载荷中写死了 `status: 'new'`；
   - 如果销售人员已将该线索跟进状态推进为“已联系（`contacted`）”或“已合格（`qualified`）”，客户后续追加一条留言就会导致该线索的状态被强行倒退为“新增（`new`）”，破坏了业务数据的状态完整性。
4. **飞书通知即时性与上下文缺失**：
   - 当前系统的飞书待接管通知仅依赖后台 Worker 默认每 30 秒一次的全表扫描轮询（`worker.ts:95`），在 Worker 正常运行且队列无积压时仍可能产生最多约 30 秒的扫描等待；
   - 当前飞书推送内容仅包含会话 ID、来源和原因等极其简陋的代码字段，缺少客户所属国家、核心需求、联系方式以及直达管理后台对应会话的一键跳转深链；
   - 销售人员在移动端收到通知后无法获知客户项目概貌，且无法快速切入工作台接管。
5. **恢复策略与业务静默未解耦**：
   - `recoveryPolicy.ts` 将高风险敏感词（`high_risk_topic`）与系统故障（`ai_service_unavailable`、`reviewed_knowledge_unavailable`）混同处理；
   - 导致命中敏感词的客户既被静默过滤不发飞书通知，又被锁死前端输入，形成了线索流失黑洞。

---

## 2. 状态机与权限边界设计

### 2.1 状态矩阵与角色行为规范

严格解耦“AI 是否回复”与“访客是否允许输入”，重新定义统一会话在生命周期各阶段的绝对边界：

| 状态 (`handoffStatus`) | AI 自动回复 | 访客行为 (Visitor) | 坐席操作 (Operator / Sales) | 说明与状态迁移 |
| :--- | :--- | :--- | :--- | :--- |
| **`ai_active`** | 允许（基于已审核企业知识库回复） | 允许发送消息、允许请求转人工 | 观察 / 查阅会话 | 触发高意向/敏感词/访客申请 → 迁移至 `handoff_requested` |
| **`handoff_requested`** | **禁止（AI 保持静默）** | **允许继续发送消息并持久化入库**（补充邮箱/电话/图纸，不触发 AI 回复） | **允许接管（`take_over`）** | 坐席点击接管 → 迁移至 `human_active` |
| **`human_active`** | 禁止 | 允许继续发送消息并持久化入库 | **允许发送坐席消息、允许标记解决（`resolve`）** | 坐席点击解决 → 迁移至 `resolved` |
| **`resolved`** | 禁止 | **允许开启新会话（点击后延迟建连，重置为本地欢迎态）** | 查看完整历史记录与审计日志 | 访客发送首条新问题 → 生成新 `ai_active` 会话 |

### 2.2 待接管状态下的消息处理流水线

在 `handoff_requested` 状态下，访客调用 `sendMessage` 的执行流完全复用既有的系统管道，不增加特化分支：

```
[访客在待接管状态下输入并发送新消息]
       │
       ▼
[权限校验] ── (handoffState 允许 visitor: ['send_message']) ──> 通过
       │
       ▼
[消息写入内存] ── (session.messages.push({ author: 'visitor', content }))
       │
       ▼
[线索意向评估] ── (leadSink.evaluate(session) 提取新出现的 email / phone / 资质)
       │
       ▼
[AI 回复分支判定] ── (当前状态为 handoff_requested !== 'ai_active') ──> 严格跳过 AI 生成
       │
       ▼
[会话持久化与 Lead 创建/更新] ── (若后补联系方式满足要求，原子生成或更新关联 Lead)
       │
       ▼
[完成返回] (前端保持输入框可用与友好等待提示，坐席实时看到客户补充的内容)
```

---

## 3. 数据完整性与 Lead 状态保护

在 `src/modules/conversations/payloadRepository.ts` 中针对 `persistLead` 进行修复：
- 检索到已有线索（`existing.docs[0]`）进行更新时，提取已有状态 `status: existing.docs[0].status`，严禁写入固定值 `'new'`；
- 只有在线索首次创建（`!existing.docs[0]`）时，赋予初始状态 `'new'`；
- 确保已进入销售跟进流水线（如已联系 `contacted`、已签约 `qualified`、已关闭 `disqualified`）的线索，在客户后续补充留言或资质时不发生状态回退。

---

## 4. 静默策略、输入权限与线索流转解耦

将“访客前端输入权限”、“是否生成 Lead”和“是否发送销售通知”三者彻底解耦：

1. **输入权限**：`ai_active`、`handoff_requested`、`human_active` 三个未结束状态允许访客发送消息；`resolved` 保持关闭，只允许通过现有 Lazy 延迟建连流程开启新会话；
2. **高意向 (`high_intent`) / 资质完成 (`qualification_complete`) / 访客主动转人工 (`visitor`)**：
   - 保持即时写入待接管任务并触发飞书销售通知；
   - 具备有效联系方式时立即生成 Lead。
3. **敏感话题 (`high_risk_topic`)**：
   - 触发待接管以阻断 AI 擅自承诺价格/交期/认证；
   - Handoff 创建时立即发送“需要人工接管”通知，不再与系统故障一起静默；
   - 访客后续补充有效联系方式且意向评分达标时，正常创建或更新 Lead，由既有 Lead Hook 发送“新线索/高意向”通知。两类通知分别表达“请立即接管”和“CRM 线索已形成”，不得在同一领域事件上重复入队。
4. **系统基础设施与知识库故障 (`ai_service_unavailable` / `reviewed_knowledge_unavailable`)**：
   - 保持静默过滤或仅限运维通道告警，严格禁止伪装成销售线索干扰业务团队。

---

## 5. 飞书即时通知架构与链路优化

### 5.1 事件驱动即时入队架构

摒弃单纯依赖 30 秒全表轮询扫描的机制，构建基于 Payload 集合生命周期的事件驱动链路。在 Worker 空闲且数据库正常时，目标触达时间为 1–3 秒；该目标不是外部平台 SLA，队列积压或飞书限流时仍由既有 Job 重试机制负责。

```
[Handoff 领域事件产生]
       │
       ▼
[入库 handoffs 集合]
       │
       ▼
[Handoffs.afterChange 钩子触发]
       │ 仅 operation === 'create' 且 status === 'requested'
       │
       ▼
[读取当前 active Feishu mapping]
       │ 无 mapping：正常返回，保留 Handoff，等待 30 秒 Relay 在配置恢复后补偿
       │
       ▼
[PayloadJobQueue.enqueue(input, req)]
       │ 使用 req.transactionID 与 Handoff 同事务写入 jobs
       │ type: 'feishu.handoff.notify'
       │ idempotency_key: `${mapping.key}:handoff:${domainEventId}`
       │
       ▼
[后台 Job Worker (默认 1 秒轮询间隔)]
       │ 读取 Handoff + Conversation + Lead + 最新 Visitor Message
       │ 使用执行时当前 active mapping，Handoff 通知不因 mappingRevision 更新而静默丢弃
       │ 在实体已完整展开后执行系统故障静默判定
       │
       ▼
[Feishu Client.sendText]
       │ domainEventId + recipient 作为 provider uuid 幂等依据
       ▼
[30 秒 enqueuePendingFeishuJobs 扫描]
       │ 保留为无 mapping、旧数据或 Hook 未部署期间的补偿机制
       └─ 与 Hook 使用相同 Job 幂等键，禁止重复 Job
```

### 5.2 实施切入点
1. 在 `src/collections/Handoffs.ts` 的 `hooks.afterChange` 中注册 `enqueueFeishuHandoffChange`；
2. 在 `src/modules/feishu/jobs.ts` 中实现 `enqueueFeishuHandoffChange: CollectionAfterChangeHook`，复用 `PayloadJobQueue.enqueue(input, req)`，禁止复制一套手写 Job INSERT；
3. Hook 不直接调用 `shouldSilenceFeishuHandoff(doc)`，因为 `afterChange` 中的 `doc.conversation` 可能只是外键 ID；权威静默判定收敛在 Worker Handler 和 30 秒 Relay 的已展开实体上；
4. Handoff Handler 与 Lead 投影同步采用不同的 Mapping 策略：Lead 同步继续严格校验 revision；Handoff 是一次性事件，执行时使用当前 active mapping，避免旧 Job 因 revision 不匹配被标记成功却没有发送；
5. Handoff 与客户消息是主业务数据，飞书入队属于可补偿副作用：无 active mapping 时正常 no-op；Mapping 查询或 Job 入队异常必须记录包含 `handoffId` / `domainEventId` 的结构化错误并返回 `doc`，不得静默吞错，也不得仅因通知暂时不可用而回滚客户的接管请求。30 秒 Relay 负责后续补偿。

---

## 6. 飞书结构化文本通知与深链规范

### 6.1 字段提取与消息格式
为避免扩展第三方 SDK 契约的额外复杂度，通知采用结构化纯文本 + 自动识别点击 URL 的标准契约：

```text
🔔【AI 客服需要人工接管】
• 渠道来源：官方网站 (Website)
• 接管原因：高意向工程咨询 (high_intent)
• 客户国家：沙特阿拉伯
• 关注产品：6063-T5 阳极氧化铝板 / 2,000 m²
• 联系方式：ahmed@example.test / +971 50 123 4567
• 请求时间：2026-09-16 17:35 (UTC)
-----------------------------------------
💬 最新客户留言：
“Urgent inquiry: Need 2000 sqm architectural aluminum panels for hospital facade project in Riyadh. We have CAD drawings ready.”
-----------------------------------------
🔗 工作台一键接管：
https://ivybm.com/dashboard/conversations?conversation=session-83444c82-a0d6-4a2e-8184-63da382f9586
```

### 6.2 细节规范与防御性设计
- **最新留言查询**：从 `messages` 集合按 `conversation + author=visitor` 查询，`depth: 0`、`limit: 1`、`sort: '-createdAt'`；禁止为生成一条通知加载完整会话消息；
- **最新留言截断保护**：先将连续空白压缩为单个空格，再按最多 150 个 Unicode code point 截断，防止恶意长文本或超长说明淹没飞书通知界面；
- **原因字段保护**：已知原因映射为业务可读文案并保留代码；未知原因只展示压缩、截断后的安全文本，最大 120 个 Unicode code point；
- **缺省值平稳降级**：国家缺失显示“待确认”，联系方式缺失显示“暂未留资（客户可继续输入）”，需求缺失显示“详见最新留言”；
- **运行时 Origin 动态解析**：严禁硬编码生产域名，在 `src/modules/feishu/mapLead.ts` 导出 `resolvePortalConversationUrl()`，复用既有 Origin 解析顺序 `IVYBM_RUNTIME_SERVER_URL` → `NEXT_PUBLIC_SERVER_URL` → 本地回退；production 环境若最终仍解析为 localhost，抛出 `FeishuConfigurationError`，禁止向销售发送不可用深链；
- **深链参数安全编码**：深链严格采用 `${origin}/dashboard/conversations?conversation=${encodeURIComponent(conversationPublicId)}`，与工作台已有的 `searchParams.conversation` 自动聚焦选中能力无缝联动。
- **登录后返回**：`ConversationsPage` 必须把完整安全深链传给 `requirePortalUser({ returnTo })`。销售未登录时完成登录后仍应打开同一会话，不能丢失 `conversation` 参数。

### 6.3 TypeScript 契约

```ts
export type HandoffForFeishu = {
  channel: 'website' | 'whatsapp' | 'facebook' | 'instagram' | 'tiktok'
  conversationPublicId: string
  country?: string | null
  domainEventId: string
  email?: string | null
  latestVisitorMessage?: string | null
  phone?: string | null
  portalUrl: string
  productInterest?: string | null
  publicId: string
  quantitySquareMeters?: number | null
  reason: string
  requestedAt: string
  source: 'ai_policy' | 'operator' | 'visitor'
}

export const enqueueFeishuHandoffChange: CollectionAfterChangeHook<Handoff>

export const resolvePortalConversationUrl = (
  conversationPublicId: number | string,
  explicitOrigin?: string,
): string
```

Job payload 保持轻量，只保存 `entityId`、`mappingId`、`mappingRevision`，业务展示字段由 Handler 执行时查询权威实体。`mappingRevision` 为兼容既有 Job payload 保留，但 Handoff Handler 不以 revision 不一致作为静默成功条件。

---

## 7. 官网业务口径统一与确定性文案

### 7.1 业务口径对齐
统一外贸工作时间，严格与官网 `Contact` 页面现有声明（`src/lib/i18n.ts:151`）保持 100% 一致：
- **营业时段**：`Monday – Saturday, 09:00 – 18:00 China Standard Time (UTC+8)` / `من الإثنين إلى السبت، 09:00 – 18:00 بتوقيت الصين (UTC+8)`；
- **响应预期**：不承诺虚假的“1 小时内”或“明天上午”，统一承诺“优先在下一个工作时段跟进”。

### 7.2 官网挂件提示文案 (`handoffPending`)
- **英文 (EN)**：
  > *"Our project team has been notified. Our service hours are Mon–Sat 09:00–18:00 China Standard Time (UTC+8). Please feel free to leave your work email, WhatsApp, or additional project details below so we can prioritize your follow-up."*
- **阿拉伯语 (AR)**：
  > *"تم إشعار فريق المشروع. ساعات العمل: من الإثنين إلى السبت 09:00–18:00 بتوقيت الصين (UTC+8). يُرجى ترك بريدك الإلكتروني أو رقم الواتساب أو تفاصيل إضافية أدناه لنتمكن من متابعة طلبك بأولوية."*

### 7.3 本期边界收敛 (Out-of-Scope)
1. **WhatsApp Connector**：本期不引入独立的 WhatsApp 接口对接；
2. **社媒自动下发**：由于社媒渠道下发等待话术需要构建复杂的双向 Outbound Delivery Intent 状态机，本期不纳入实施范围；
3. **社媒待接管再评分**：本期不改变 `externalInbound && handoffStatus !== 'ai_active'` 的 record-only 行为；社媒消息继续可靠落库，但不在本 PR 新增待接管阶段的 Lead 再评估；
4. **聊天附件上传**：当前 `SendChatMessageInput` 只有 `text` 字段，本期仅支持访客补充图纸情况、文件名或外部链接，不建设 CAD/PDF 上传能力；
5. **个人手机号**：严禁在代码中硬编码任何个人手机号码；
6. **数据库结构**：不新增 Collection、字段、索引或 migration；
7. **Job 类型**：不新增 Job Type，复用 `feishu.handoff.notify`；
8. **飞书卡片**：不扩展飞书 Card / 富文本协议，继续使用 `FeishuClientPort.sendText`；
9. **Lead 生命周期**：不改变 `new | contacted | qualified | disqualified` 枚举和销售流程；
10. **后台入口**：通知不得链接 Payload `/admin`，只允许 `/dashboard/conversations`。

---

## 8. 实施任务分解与执行顺序

### 8.1 点名文件与修改清单

生产代码：

- `[MODIFY] src/modules/conversations/handoffState.ts`：`handoff_requested` 的 visitor 动作改为 `['send_message']`；operator 仍只有 `['take_over']`，sales 仍无动作。
- `[MODIFY] src/modules/conversations/payloadRepository.ts`：移除 `high_risk_topic` 的 Lead 静默阻断；更新已有 Lead 时保留原状态。
- `[MODIFY] src/modules/conversations/recoveryPolicy.ts`：静默集合只保留 `ai_service_unavailable` 与 `reviewed_knowledge_unavailable`。
- `[MODIFY] src/collections/Handoffs.ts`：在 `writeAuditLogAfterChange` 后注册 `enqueueFeishuHandoffChange`。
- `[MODIFY] src/modules/feishu/contracts.ts`：扩展 `HandoffForFeishu` 展示契约，不改变 `FeishuClientPort.sendText`。
- `[MODIFY] src/modules/feishu/jobs.ts`：新增 Handoff `afterChange` 入队 Hook；Handler 按权威实体查询通知上下文；Handoff 使用当前 active mapping；Relay 保持 30 秒补偿扫描。
- `[MODIFY] src/modules/feishu/notify.ts`：实现业务可读原因、缺省值、Unicode 截断、结构化纯文本和工作台深链。
- `[MODIFY] src/modules/feishu/mapLead.ts`：导出共用 Origin 解析能力并新增 `resolvePortalConversationUrl()`；production 禁止 localhost 深链。
- `[MODIFY] src/lib/i18n.ts`：更新 EN / AR `chat.handoffPending`，与 Contact 页 Mon–Sat 09:00–18:00 China Standard Time 口径一致。
- `[MODIFY] src/app/(dashboard)/dashboard/(protected)/conversations/page.tsx`：读取 `conversation` 后构造完整 `returnTo`，确保未登录销售完成登录后仍回到指定会话。
- `[MODIFY] src/modules/jobs/claim.ts`：扩展 `EnsureRunnableJobOptions` 支持 `rearmDeadForFailureCodes`，限定仅在特定结构化失败码（`feishu_mapping_inactive`）时受控重置 dead Job；在 `fail` 中捕获非重试错误及结构化 `lastFailureCode` 写入 `payload`，且在无 code 时显式清除残留的 `lastFailureCode`。
- `[MODIFY] src/modules/jobs/retry.ts`：`transitionAfterFailure` 支持 `retryable?: boolean`，当错误显式为不可重试时立即转入 `dead` 终态。
- `[MODIFY] src/modules/ai/gateway.ts`：校准 `normalizeError` 重试语义，区分显式不可重试与未分类普通 Provider `Error`，将未分类异常设置为 `retryable: true` 保障知识库索引等通用任务重试契约。

测试与记录：

- `[MODIFY] tests/unit/conversations/handoff-state.test.ts`
- `[MODIFY] tests/unit/conversations/recovery-policy.test.ts`
- `[MODIFY] tests/unit/conversations/payload-repository-lead-gate.test.ts`
- `[MODIFY] tests/unit/conversations/service.test.ts`
- `[MODIFY] tests/unit/jobs/retry.test.ts`
- `[MODIFY] tests/contract/chat-service.test.ts`
- `[MODIFY] tests/contract/ai-gateway.test.ts`
- `[MODIFY] tests/unit/chat-widget.test.ts`
- `[NEW] tests/unit/feishu-handoff-notification.test.ts`
- `[MODIFY] tests/integration/chat.test.ts`
- `[MODIFY] tests/integration/feishu-sync.test.ts`
- `[MODIFY] tests/integration/jobs/worker.test.ts`
- `[MODIFY] tests/e2e/chat-handoff.spec.ts`
- `[MODIFY] tests/e2e/website-chat-real.spec.ts`
- `[MODIFY] tests/e2e/admin-portal-conversations.spec.ts`
- `[MODIFY] tests/e2e/admin-portal-live-workflow-smoke.spec.ts`
- `[MODIFY] scripts/smoke/chat-workflow.ts`
- `[MODIFY] docs/开发进度.md`

明确复用、无需修改的生产文件：

- `src/modules/conversations/service.ts`：官网消息放开状态机动作后，现有 `消息落库 → leadSink.evaluate → 非 ai_active 跳过生成 → saveSession` 管道已满足需求，不新增网站专用分支。
- `src/components/chat/ChatWidget.tsx`：输入框可用性已由 `allowedActions.includes('send_message')` 驱动，仅同步测试和 i18n 文案，不增加第二套前端状态判断。
- `src/worker.ts`：保留 1 秒 Job Worker 领取间隔与 30 秒 Feishu Relay 补偿间隔，不改全局轮询参数。

### 8.2 真实接口与实现约束

1. `allowedActionsFor('handoff_requested', 'visitor')` 必须精确返回 `['send_message']`；不得把 `take_over`、`resolve` 或 operator 消息权限暴露给访客。
2. `sendVisitorMessage()` 在官网待接管状态必须调用一次 `leadSink.evaluate(session)`，必须调用 `repository.saveSession()`，且 `responder.generateReply()` 调用次数为 0。
3. `persistLead()` 采用“创建与更新分离”的状态载荷：首次创建写 `status: 'new'`；已有 Lead 更新沿用 `existing.docs[0].status`。本期不顺带重构其他 Lead 字段合并策略。
4. `enqueueFeishuHandoffChange` 仅处理 `operation === 'create' && doc.status === 'requested'`。它通过 `findActiveFeishuMapping(req.payload, req)` 获取当前 Mapping，并调用：

   ```ts
   await new PayloadJobQueue({ payload: req.payload }).enqueue(
     {
       idempotencyKey: `${mapping.key}:handoff:${doc.domainEventId}`,
       payload: {
         entityId: doc.id,
         mappingId: mapping.id,
         mappingRevision: mapping.revision,
       },
       type: FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
     },
     req,
   )
   ```

5. Hook 与 30 秒 Relay 必须使用完全相同的 `type + idempotencyKey`。并发命中唯一约束时只能得到一个 Job；禁止引入第二种 Handoff Job 或第二张 outbox 表。
6. Handler 不依赖 `depth: 1` 的隐式嵌套展开。执行时分别读取 Handoff、Conversation、可选 Lead，以及最新一条 visitor Message；随后用 `conversation.channel + handoff.reason` 执行静默判定。
7. Handoff Handler 忽略 payload 中旧的 `mappingRevision` 作为发送门禁，改用执行时 `findActiveFeishuMapping()` 的结果；Lead 同步现有 revision 校验保持不变。
8. `resolvePortalConversationUrl()` 只接受内部 `conversationPublicId`，必须 `encodeURIComponent`；解析顺序保持 `explicitOrigin → IVYBM_RUNTIME_SERVER_URL → NEXT_PUBLIC_SERVER_URL → localhost`。`NODE_ENV=production` 且结果为 localhost 时抛出 `FeishuConfigurationError`。
9. `ConversationsPage` 只接受单个字符串形式的 `conversation`；数组取第一项，并通过 `encodeURIComponent` 构造 `/dashboard/conversations?conversation=...` 后交给 `requirePortalUser({ returnTo })`。既有 `safePortalReturnTo()` 继续负责拒绝站外跳转。

### 8.3 实施顺序

1. **状态与 Lead 正确性**：先修改 `handoffState.ts`、`recoveryPolicy.ts`、`payloadRepository.ts`，同步 unit / contract / chat integration；确认待接管补充联系方式能形成或更新同一个 Lead，且不触发 AI。
2. **即时入队与补偿**：实现 `enqueueFeishuHandoffChange` 并注册到 `Handoffs.afterChange`；覆盖同事务可见性、无 Mapping、入队失败降级、Hook/Relay 竞争幂等。
3. **通知上下文与深链**：扩展契约、按需查询最新留言与可选 Lead、格式化文本、生产 Origin 保护，并修复登录回跳保留 query。
4. **官网文案与 UI 契约**：更新 EN / AR 文案；同步 ChatWidget mock，使待接管状态继续显示可输入文本框而没有 AI 回复。
5. **定向门禁与进度记录**：运行第 11 节命令，记录真实结果到 `docs/开发进度.md`。只有实现、测试、风险/回滚和共享边界 Review 均完成后才进入 Ready。

---

## 9. 版本锚定

- Node.js `24.x`
- pnpm `10.15.1`
- Next.js `16.2.6`（App Router / Server Component）
- React / React DOM `19.2.6`
- Payload CMS `3.86.0`
- `@payloadcms/db-postgres` `3.86.0`
- TypeScript `5.7.3`
- Vitest `4.0.18`
- Playwright `1.58.2`
- `@larksuiteoapi/node-sdk` `^1.72.0`

实现必须使用仓库当前 `PayloadJobQueue.enqueue(input, req?)` 与 Payload 3.86 `CollectionAfterChangeHook` 签名，不新增依赖，不按其他版本的通用印象编造 Hook 或事务 API。

---

## 10. 错误、降级与幂等矩阵

| 场景 | 主业务结果 | 飞书结果 | 必须验证的保护 |
| :--- | :--- | :--- | :--- |
| 待接管访客补充普通项目信息 | 消息入库，会话仍为 `handoff_requested` | 不新增 Handoff 通知 | AI 调用 0 次，输入权限保持可用 |
| 待接管访客补充有效联系方式且达到 Lead 门槛 | 更新同一会话并创建/更新同一 Lead | 既有 Lead Hook 可产生 Lead 通知 | Lead 幂等键不变，已有状态不回退 |
| `high_risk_topic` | AI 停止回复，创建 Handoff，访客可继续输入 | 创建接管通知；形成 Lead 后可另有 Lead 通知 | 两种事件各自幂等，不在同一事件重复入队 |
| `ai_service_unavailable` / `reviewed_knowledge_unavailable` | 保持既有恢复语义 | Handoff 销售通知继续静默 | 不伪装为销售商机 |
| Handoff 创建时无 active Mapping | Handoff 正常提交 | Hook no-op；配置恢复后 Relay 补偿 | 不因通知配置缺失阻断访客 |
| Hook Mapping 查询或 enqueue 异常 | Handoff 正常提交并记录结构化错误 | Relay 后续补偿 | 禁止空 catch；日志含事件标识 |
| Hook 与 Relay 同时入队 | Handoff 正常提交 | 只存在一个 `feishu.handoff.notify` Job | 相同 `type + idempotencyKey` 唯一约束 |
| Job 入队后 Mapping revision 更新 | 不影响会话 | Handler 使用当前 active Mapping 发送一次 | 不把旧 revision 当作静默成功条件 |
| 飞书限流/临时失败 | 不影响会话 | 沿用 Job 重试与 dead-letter 机制 | 不在 Handler 内盲目重复发送 |
| production Origin 缺失或解析为 localhost | 不影响会话与 Handoff | Job 失败并显式报配置错误 | 禁止发送不可点击的 localhost 深链 |
| 飞书上下文字段缺失 | 不影响发送 | 使用“待确认 / 暂未留资 / 详见最新留言” | 不抛空值异常，不编造客户信息 |

---

## 11. 端到端可执行验证命令与断言

以下命令从本 worktree 根目录执行。Checkpoint 只运行与本 diff 直接相关的门禁；不以重复全仓库矩阵替代关键业务断言。

```bash
# 1. 精确 lint 与类型检查
git diff -z --name-only --diff-filter=ACMR origin/main -- '*.ts' '*.tsx' \
  | xargs -0 pnpm exec eslint
pnpm typecheck

# 2. 状态机、静默策略、Lead gate、Service 与挂件契约
pnpm test:unit -- \
  tests/unit/conversations/handoff-state.test.ts \
  tests/unit/conversations/recovery-policy.test.ts \
  tests/unit/conversations/payload-repository-lead-gate.test.ts \
  tests/unit/conversations/service.test.ts \
  tests/unit/chat-widget.test.ts \
  tests/unit/feishu-handoff-notification.test.ts
pnpm test:contract -- tests/contract/chat-service.test.ts tests/contract/feishu.test.ts

# 3. 真实 Payload/数据库边界：Lead 状态、Hook 事务、Relay 幂等、Mapping 更新
pnpm test:integration -- tests/integration/chat.test.ts tests/integration/feishu-sync.test.ts

# 4. 浏览器 UI 契约：待接管继续输入、EN/AR 文案、登录后深链保留
pnpm test:e2e -- tests/e2e/chat-handoff.spec.ts tests/e2e/admin-portal-conversations.spec.ts

# 5. 文档与补丁卫生
git diff --check
```

交付断言：

1. Website 会话进入 `handoff_requested` 后可连续提交新消息，消息可在 Portal 侧读取，`responder.generateReply` 为 0 次。
2. 后补邮箱或电话后只创建/更新一个 Lead；`contacted`、`qualified`、`disqualified` 均不会被重置为 `new`。
3. `high_risk_topic` 会产生接管 Job；两个系统恢复原因仍静默。
4. Handoff Hook 与 Handoff 创建共享事务上下文；无 Mapping 或 Hook 失败不回滚 Handoff；Relay 可补偿且不产生重复 Job。
5. Mapping revision 在 Job 执行前改变，Handoff 通知仍由当前 active Mapping 发送；Lead Job 的 revision 防护不受影响。
6. 最新留言按 150 Unicode code point 截断，未知 reason 按 120 code point 截断；空字段使用规定缺省值。
7. 已登录用户打开飞书深链直接选中对应会话；未登录用户登录后仍保留 `conversation` query。
8. EN / AR 待接管提示均显示 Mon–Sat、09:00–18:00、UTC+8，且不出现 “join shortly” 或等价即时承诺。

---

## 12. 发布、Review 与回滚

- 本任务不修改 schema、migration、Payload 注册、全局 Worker 轮询间隔或 CI 配置。
- 修改会话公共状态动作、Lead 持久化和飞书跨模块契约，必须由另一名开发者 Review；Review 重点为状态权限、Lead 数据完整性、Hook/Relay 幂等和外部通知副作用。
- 发布前确认 production 已配置可公开访问的 `IVYBM_RUNTIME_SERVER_URL` 或 `NEXT_PUBLIC_SERVER_URL`，并运行官网 Chat → Handoff → Portal 接管 → Lead/飞书 smoke。
- 回滚以整个 PR 为单位：恢复 visitor 动作、静默集合、Handoff Hook、通知格式和深链 helper。由于无 migration，代码回滚不需要数据库 down；已创建的 Job 继续遵循既有幂等/重试规则，不手工删除 production Jobs。
- 若即时 Hook 上线后出现异常，可优先回滚 `Handoffs.afterChange` 注册，保留原 30 秒 Relay 维持可用性；不得通过关闭整个 Worker 或删除 Handoff 数据止血。

---

## 13. 完成定义

- 本文列出的生产文件、测试文件与 `docs/开发进度.md` 已按计划更新；
- 第 11 节定向门禁真实通过，未运行或受环境阻塞的项目有明确记录；
- 官网待接管输入死锁、Lead 状态回退、高风险通知静默三项正确性缺陷均有回归测试；
- 飞书通知具备当前 Mapping、业务上下文、生产可用深链和 30 秒补偿机制；
- 无新增依赖、无 schema/migration、无 WhatsApp Connector、无社媒自动等待回复；
- 共享边界 Review 完成后方可合并，production 部署仍由 jueyunai 人工批准。
