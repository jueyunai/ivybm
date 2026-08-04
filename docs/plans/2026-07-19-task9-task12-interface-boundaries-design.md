# Task 9 / Task 12 跨开发者接口边界设计

## 目标

Task 9 和 Task 12 按 Portal Core 与业务模块 owner 拆分。jueyunai 提供 `/dashboard`
基座、共享 UI/状态/错误契约、官网 ChatWidget、AI 内容工作台和整体视觉/集成验收；xuemusi 负责知识/AI、
统一会话、AI 客服及海外平台服务的页面或领域服务和持续迭代。
双方先冻结接口、请求响应、错误码和 mock/fixture，再独立开发。

## 一期平台范围

- 入站会话：Facebook Messenger、Instagram DM（均要求企业 / 商业账号及相应 Meta 权限）和 TikTok 私信（商业账号、目标地区官方能力与审核）。
- 图文发布：Facebook、Instagram（企业账号及相应 Meta 发布权限）和 LinkedIn（账号类型不限制，但自动发布仍取决于 API 发布权限）。
- LinkedIn 私信不在一期自动会话范围；TikTok 发布不在一期范围；WhatsApp 不纳入一期系统 connector、Webhook、自动回复或发布能力，二期再评估网页插件等替代接入。官网静态外链不等于系统接入。

## 责任边界

| 领域                | jueyunai                                                                                                                 | xuemusi                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portal Core | `/dashboard` 登录、Shell、module registry、共享 UI/状态、设计规范、集成验收 | 按公共 contract 接入模块；不复制 Core 或绕过权限 |
| Task 9 官网 AI 客服 | 官网 `ChatWidget` 与公开页面集成、整体体验验收 | `/dashboard/conversations`、会话服务、AI 回复、知识引用、意向评分、人工接管 API、平台 adapter 和数据集成 |
| Task 12 内容工作台  | `/dashboard/content-studio`、素材/CMS 输入、生成/审核流程、正式共享结构、发布任务、整体 IA 与视觉验收 | 平台 capability/publish/status、账号 readiness、adapter、结果回调和真实发布执行 |
| 共同                | 冻结 contract、错误码、fixture、mock 行为；跨边界改动互相 review                                                         | 冻结 contract、错误码、fixture、mock 行为；跨边界改动互相 review                                                                                                 |

## 接口与解耦

- 官网前端只依赖 `ChatService` contract，不导入模型供应商 SDK，也不直接访问 `Conversations` / `Messages`。
- 内容工作台模块只依赖 `PublishingService` contract，不导入 Facebook / Instagram / LinkedIn SDK，也不读取平台 token。
- jueyunai 的内容工作台先消费双方冻结的 `PublishingService` fake；xuemusi 的平台服务可以先使用 fake repository 和 fake provider，production 或等价受控真实环境条件满足后再替换真实 adapter。
- 共享 Collection、migration、Payload 注册和生成类型仍按 `main` 的合并顺序维护；接口 contract 可以先于数据库 adapter 合并。

### 人工接管边界

- jueyunai 负责官网 ChatWidget、Portal Core、统一设计规范和集成验收。
- xuemusi 负责 `/dashboard/conversations` 的运营会话 UI、服务端权威状态机、转换守卫、
  幂等、权限、审计，以及进入 `human_active` 后阻止 AI 自动回复。
- `ChatService` 的 HTTP route 是模块化单体内的薄适配层，不是独立微服务；官网、运营后台以及一期 Facebook Messenger / Instagram DM / TikTok 私信连接器共用同一个 `ConversationService`。
- 前端只提交 `reason`、`source` 和 `idempotencyKey` 等命令参数，不能直接写 `handoffStatus`、`assignedTo` 或审计字段。
- 运营界面先从 `GET /api/chat/operator/sessions` 读取分页摘要，再用 `GET /api/chat/sessions/:id?view=operator` 读取详情；admin/operator 可认领，sales 只能处理已分配会话。
- 服务端产生 `handoff.created` 领域事件，Task 10 / 11 负责 Job、飞书通知、失败重试和人工补偿，AI 服务不直接依赖飞书 SDK。

人工接管的完整决策和状态机见 [`ADR-0001`](../architecture/adr/0001-human-handoff-domain-boundary.md)。

## Mock-first 交付顺序

1. 双方共同提交 TypeScript port/interface、JSON schema、错误码、状态枚举和官方结构 fixture。
2. jueyunai 先交付 Portal module manifest、示例模块、共享 UI/状态和视觉测试工具。
3. jueyunai 用 `PublishingService` mock 完成内容工作台；xuemusi 用 fake repository、平台 mock 和 Portal contract 完成知识、会话与平台发布服务；测试不得访问真实平台网络或携带真实 token。
4. 服务端接口稳定后，双方分别补数据库集成测试；Task 13 的真实发布 adapter 只有在 `PublishJobs` / `PublishLogs` 合并后接入。
5. production 或等价受控真实环境具备账号授权后，分别执行 Facebook Messenger / Instagram DM / TikTok 私信入站、Facebook / Instagram / LinkedIn 图文发布的真实联调；fixture / mock 通过不等同于平台已可用。

## 验收边界

- Task 9 前端验收：官网 ChatWidget 与 `/dashboard/conversations` 的移动端、重试、敏感问题转人工、人工接管后停止 AI 回复。
- Task 9 服务验收：Facebook Messenger / Instagram DM / TikTok 私信的会话幂等、知识引用、意向评分、Lead 创建、稳定错误码和权限边界。
- Task 12 前端验收：内容生成、审核状态机、平台选择、定时发布、发布中/成功/失败展示。
- Task 12 平台服务验收：Facebook / Instagram / LinkedIn 图文能力查询、发布任务幂等、结果回调、限流/重试和 token 隔离。
