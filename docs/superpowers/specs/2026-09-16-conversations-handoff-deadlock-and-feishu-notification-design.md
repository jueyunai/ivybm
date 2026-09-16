# 统一会话待接管死锁解除与飞书即时通知增强设计方案

## 1. 概述与背景

### 1.1 现状与核心痛点

统一会话（`conversations`）在对接官网（Website ChatWidget）及海外社媒（Instagram、Facebook Messenger 等）并联动飞书 CRM 的流转链路中，存在以下阻断转化的核心痛点：

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
   - 当前系统的飞书待接管通知仅依赖后台 Worker 默认每 30 秒一次的全表扫描轮询（`worker.ts:95`），通知推送存在明显的分钟级滞后；
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

1. **输入权限**：全局对访客开放，访客在任何会话中均保留表达与补充信息的权利；
2. **高意向 (`high_intent`) / 资质完成 (`qualification_complete`) / 访客主动转人工 (`visitor`)**：
   - 保持即时写入待接管任务并触发飞书销售通知；
   - 具备有效联系方式时立即生成 Lead。
3. **敏感话题 (`high_risk_topic`)**：
   - 触发待接管以阻断 AI 擅自承诺价格/交期/认证；
   - 访客在待接管状态下继续补充了有效联系方式且意向评分达标时，正常升级为 Lead 并触发飞书通知，彻底消除客户被静默遗弃的风险。
4. **系统基础设施与知识库故障 (`ai_service_unavailable` / `reviewed_knowledge_unavailable`)**：
   - 保持静默过滤或仅限运维通道告警，严格禁止伪装成销售线索干扰业务团队。

---

## 5. 飞书即时通知架构与链路优化

### 5.1 1 秒级事件驱动即时入队架构

摒弃单纯依赖 30 秒全表轮询扫描的机制，构建基于 Payload 集合生命周期的事件驱动链路：

```
[Handoff 领域事件产生]
       │
       ▼
[入库 handoffs 集合]
       │
       ▼
[Handoffs.afterChange 钩子触发] ── (仅在 operation === 'create' 时执行)
       │
       ▼
[静默与过滤判定] ── (若属于系统级静默故障则跳过，否则继续)
       │
       ▼
[原子写入 jobs 表] ── (type: 'feishu.handoff.notify', idempotency_key: `${mapping.key}:handoff:${domainEventId}`)
       │              (SQL: INSERT ... ON CONFLICT ("type", "idempotency_key") DO NOTHING)
       │
       ▼
[后台 Job Worker (1 秒轮询间隔)] ── (约 1 秒内认领 Job 并调用 Feishu Client 发送)
       │
       ▼
[30 秒 enqueuePendingFeishuJobs 全表扫描] ── (保留为漏单兜底机制，依靠 idempotency_key 保障零重复)
```

### 5.2 实施切入点
1. 在 `src/collections/Handoffs.ts` 的 `hooks.afterChange` 中注册 `enqueueFeishuHandoffChange`；
2. 在 `src/modules/feishu/jobs.ts` 中实现 `enqueueFeishuHandoffChange` 钩子，直接利用数据库事务与冲突保护将任务瞬间推入待执行队列。

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
http://localhost:3000/dashboard/conversations?conversation=session-83444c82-a0d6-4a2e-8184-63da382f9586
```

### 6.2 细节规范与防御性设计
- **最新留言截断保护**：提取最后一条访客留言，截断在 150 字符以内，并将多行连续换行压缩为空格，防止恶意长文本或超长文档说明淹没飞书通知界面；
- **缺省值平稳降级**：国家缺失显示“待确认”，联系方式缺失显示“暂未留资（客户可继续输入）”，需求缺失显示“详见最新留言”；
- **运行时 Origin 动态解析**：严禁硬编码生产域名，复用现有 `src/modules/feishu/mapLead.ts` 中的 `resolvePortalOrigin()` 函数，动态从 `NEXT_PUBLIC_SERVER_URL` 或 `IVYBM_RUNTIME_SERVER_URL` 提取 Origin；
- **深链参数安全编码**：深链严格采用 `${origin}/dashboard/conversations?conversation=${encodeURIComponent(conversationPublicId)}`，与工作台已有的 `searchParams.conversation` 自动聚焦选中能力无缝联动。

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
3. **个人手机号**：严禁在代码中硬编码任何个人手机号码。

---

## 8. 实施任务分解与执行顺序

1. **Task 1（放开输入权限）**：
   - 修改 `src/modules/conversations/handoffState.ts`，为 `handoff_requested` 的 `visitor` 增加 `['send_message']`；
   - 更新前端挂件与既有单元测试中关于输入框禁用的反向断言。
2. **Task 2（Lead 状态保全）**：
   - 修改 `src/modules/conversations/payloadRepository.ts`，更新 Lead 时保留既有状态；
   - 编写单元测试验证客户追加消息不会将 `contacted` / `qualified` 重置为 `new`。
3. **Task 3（敏感话题与静默策略重构）**：
   - 调整 `recoveryPolicy.ts` 与 `payloadRepository.ts` 的线索判定，确保命中敏感话题的访客补充联系方式后能正常生成 Lead 并通知销售。
4. **Task 4（飞书钩子即时入队）**：
   - 在 `src/collections/Handoffs.ts` 接入 `afterChange` 钩子，实现向 `jobs` 集合的事务幂等写入。
5. **Task 5（飞书通知内容与深链丰富）**：
   - 在 `src/modules/feishu/notify.ts` 与 `jobs.ts` 中丰富信息提取与格式化，加入动态 Origin 生成的可点击深链与文本截断。
6. **Task 6（官网文案与口径更新）**：
   - 更新 `src/lib/i18n.ts` 中中东/英文的 `handoffPending` 确定性工作时间话术。
7. **Task 7（定向回归与文档沉淀）**：
   - 定向运行所有对话、线索、飞书相关的单元测试与集成测试，更新 `docs/开发进度.md`。
