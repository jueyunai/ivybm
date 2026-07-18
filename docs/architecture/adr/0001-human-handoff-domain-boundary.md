# ADR-0001：人工接管领域边界与 API 归属

## 状态

Accepted，2026-07-19。

## 背景

Task 9 同时包含官网 ChatWidget、统一会话、AI 回复、意向评分和人工接管。官网 UI 由 jueyunai 实现，会话与 AI 服务由 xuemusi 实现；未来 WhatsApp / Meta 等入站消息也需要复用同一套人工接管能力。

人工接管不是单一按钮，而是跨官网、社媒、运营后台、AI 服务、任务队列和飞书通知的领域状态。如果把状态判断放在浏览器，前端可以绕过权限、幂等和审计；如果每个渠道各自实现，则无法保证进入人工接管后 AI 在所有渠道停止回复。

## 决策

### 责任边界

| 层次             | jueyunai                                                         | xuemusi                                                      |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| 官网与运营体验   | ChatWidget、接管提示、输入状态、错误重试、会话列表和人工处理界面 | 不控制页面布局或交互细节                                     |
| 人工接管领域服务 | 消费服务端权威状态，不直接改写状态字段                           | 接管策略、状态机、转换守卫、幂等、权限、审计和领域事件       |
| 飞书与任务补偿   | Task 10 / 11 消费领域事件，执行通知、重试和人工补偿              | 产生 `handoff.created` 等领域事件，不直接耦合飞书 SDK        |
| 共享边界         | 共同 review contract、状态枚举、错误码、fixture 和破坏性变更     | 共同 review contract、状态枚举、错误码、fixture 和破坏性变更 |

### 状态机

```text
ai_active
    │  AI policy / visitor request / operator action
    ▼
handoff_requested
    │  assignment accepted
    ▼
human_active
    │  operator resolves conversation
    ▼
resolved
```

- `handoff_requested` 期间通知或分配失败，由 Job 重试并保持可见，不能静默退回 `ai_active`。
- `human_active` 后所有 AI 自动回复请求必须被领域服务拒绝。
- 重复接管命令通过 `conversationId + idempotencyKey` 返回首次结果，不创建重复 Handoff。
- 非法转换（例如 `resolved -> human_active`）由服务端拒绝并写审计日志。

### API 边界

系统仍是 Next.js + Payload 模块化单体，不为人工接管拆独立微服务。HTTP API 只是浏览器到领域服务的薄适配层：

```text
ChatWidget / Operator UI / Platform Connector
                  │
                  ▼
          Next Route / internal port
                  │
                  ▼
        ConversationService（权威状态）
                  │
        ┌─────────┼──────────┐
        ▼         ▼          ▼
 Conversations  Handoffs   Domain Events
                             │
                             ▼
                       Jobs / Feishu
```

前端或连接器可以表达“请求接管”，但不能直接指定最终状态或任意负责人。接口接受 `reason`、`source` 和 `idempotencyKey`，返回权威 `handoffStatus`、`requestId`、允许的下一步操作和稳定错误码。

建议的薄接口包括：

- `POST /api/chat/sessions/:id/handoff`
- `POST /api/chat/sessions/:id/take-over`
- `POST /api/chat/sessions/:id/resolve`
- `GET /api/chat/sessions/:id`

访客只能操作自己会话的有限命令；operator / admin 才能认领和解决会话。浏览器不得直接写 `handoffStatus`、`assignedTo`、审计字段或消息作者身份。

## 为什么需要 API

- 建立浏览器与服务端之间的信任边界，保护数据库、AI 密钥和平台 token。
- 让官网、社媒连接器和运营后台共用同一套状态机。
- 在服务端处理重复点击、网络重试、Webhook 重放和并发接管。
- 保证进入人工接管后 AI 停止回复，并留下完整审计记录。
- 支持 jueyunai 使用 `FakeChatService` 先完成 UI，同时 xuemusi 使用 fake repository 实现领域服务。

## 后果

### 正面

- 官网和社媒不会重复实现接管规则。
- UI 体验与领域逻辑可以并行开发，双方只在 contract 处耦合。
- 飞书、平台和 AI 供应商被 adapter 隔离，后续替换不会影响前端。
- 权限、幂等、审计和失败补偿集中在可测试的服务端边界。

### 负面

- contract、状态机和 fixture 变更必须双方 review，沟通成本高于单人实现。
- UI 需要处理服务端返回的 pending、conflict、forbidden 和 retryable error 状态。
- Task 10 的 Jobs 未完成前，通知失败只能记录为阻塞，不能形成完整自动补偿闭环。

## 备选方案

### 人工接管全部由 jueyunai 实现

不采用。会导致 AI 服务、官网和社媒连接器形成循环依赖，并可能出现多套状态机。

### 人工接管前后端全部由 xuemusi 实现

不采用。虽然领域逻辑集中，但会侵入官网和运营后台的视觉、交互与前端迭代边界。

### 前端直接修改 Payload Collection

不采用。无法可靠执行权限、转换守卫、幂等、AI 停止回复、审计和领域事件。

## 验证要求

- 单元测试覆盖所有合法和非法状态转换、重复接管、重复解决和人工接管后 AI 回复被拒绝。
- 集成测试覆盖并发接管、权限、审计日志、`handoff.created` 事件和 Job 失败可见性。
- E2E 覆盖访客请求接管、AI 自动转人工、运营认领、人工回复、解决会话和错误重试。
- contract test 确保 `FakeChatService` 与真实 `ConversationService` 对相同输入返回兼容结构。

## 关联文档

- [`docs/plans/2026-07-19-task9-task12-interface-boundaries-design.md`](../../plans/2026-07-19-task9-task12-interface-boundaries-design.md)
- [`docs/plans/2026-07-16-一期开发实施计划.md`](../../plans/2026-07-16-一期开发实施计划.md)
- [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)
