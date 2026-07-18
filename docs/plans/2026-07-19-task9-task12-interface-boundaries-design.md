# Task 9 / Task 12 跨开发者接口边界设计

## 目标

Task 9 和 Task 12 按“前端体验与内部工作流”和“后端服务与第三方平台适配”拆分，避免任一方等待另一方完成全部 Task 才能开发。双方先冻结内部接口、请求响应结构、错误码和 mock/fixture，再分别实现消费者与服务提供者。

## 责任边界

| 领域                | jueyunai                                                                                                                 | xuemusi                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Task 9 官网 AI 客服 | `ChatWidget`、官网交互、加载/错误/人工接管 UI、前端 E2E                                                                  | 会话服务、AI 回复、知识引用、意向评分、人工接管 API、`Conversations` / `Messages` / `Handoffs` 数据集成 |
| Task 12 内容工作台  | 图文内容发布页面、内容生成/审核 UI、状态展示、内容生成与审核工作流、`PublishJobs` / `PublishLogs` 共享结构和发布任务创建 | 第三方平台 capability / publish / status 服务、Meta / WhatsApp / LinkedIn 等平台 adapter、发布结果回调  |
| 共同                | 冻结 contract、错误码、fixture、mock 行为；跨边界改动互相 review                                                         | 冻结 contract、错误码、fixture、mock 行为；跨边界改动互相 review                                        |

## 接口与解耦

- 官网前端只依赖 `ChatService` contract，不导入模型供应商 SDK，也不直接访问 `Conversations` / `Messages`。
- 内容工作台只依赖 `PublishingService` contract，不导入 Meta / WhatsApp / LinkedIn SDK，也不读取平台 token。
- xuemusi 的服务实现可以先使用 fake repository 和 fake provider；平台账号、审核和 staging 条件满足后，再替换为真实 adapter。
- 共享 Collection、migration、Payload 注册和生成类型仍按 `main` 的合并顺序维护；接口 contract 可以先于数据库 adapter 合并。

### 人工接管边界

- jueyunai 负责 ChatWidget、运营会话列表、接管提示、认领/解决操作和所有用户可见状态。
- xuemusi 负责服务端权威状态机、转换守卫、幂等、权限、审计，以及进入 `human_active` 后阻止 AI 自动回复。
- `ChatService` 的 HTTP route 是模块化单体内的薄适配层，不是独立微服务；官网、运营后台和社媒连接器共用同一个 `ConversationService`。
- 前端只提交 `reason`、`source` 和 `idempotencyKey` 等命令参数，不能直接写 `handoffStatus`、`assignedTo` 或审计字段。
- 服务端产生 `handoff.created` 领域事件，Task 10 / 11 负责 Job、飞书通知、失败重试和人工补偿，AI 服务不直接依赖飞书 SDK。

人工接管的完整决策和状态机见 [`ADR-0001`](../architecture/adr/0001-human-handoff-domain-boundary.md)。

## Mock-first 交付顺序

1. 双方共同提交 TypeScript port/interface、JSON schema、错误码、状态枚举和官方结构 fixture。
2. jueyunai 用 `FakeChatService` 和 `FakePublishingService` 完成页面、交互和前端测试；mock 必须覆盖 loading、retry、handoff、scheduled、published、failed 等状态。
3. xuemusi 用 contract test、fake repository 和平台 mock 完成服务与 adapter；测试不得访问真实平台网络或携带真实 token。
4. 服务端接口稳定后，双方分别补数据库集成测试；Task 13 的真实发布 adapter 只有在 `PublishJobs` / `PublishLogs` 合并后接入。
5. staging 具备账号授权后，执行真实平台联调；fixture / mock 通过不等同于平台已可用。

## 验收边界

- Task 9 前端验收：英文 / 阿语、RTL、移动端、重试、敏感问题转人工、人工接管后停止 AI 回复。
- Task 9 服务验收：会话幂等、知识引用、意向评分、Lead 创建、稳定错误码和权限边界。
- Task 12 前端验收：内容生成、审核状态机、平台选择、定时发布、发布中/成功/失败展示。
- Task 12 平台服务验收：能力查询、发布任务幂等、结果回调、限流/重试和 token 隔离。
