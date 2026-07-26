# 一期平台接入 PoC 记录

更新日期：2026-07-26

> 范围冻结（2026-07-20）：一期会话接入为 Facebook Messenger、Instagram DM、TikTok 私信；一期图文发布为 Facebook、Instagram、LinkedIn。WhatsApp 移出一期，二期再评估网页插件等替代接入；LinkedIn 私信不属于一期自动会话范围。
>
> 本文件用于冻结 Task 13 的验收口径和阻塞条件。Task 13 功能分支已实现纯 TypeScript connector contract、fixture/mock 与 LinkedIn 降级导出；`main` 是否包含这些能力以对应 PR 合并状态为准。当前证据不包含真实平台授权或联网操作，不代表平台真实可用。

## 状态定义

| 状态          | 含义                                                                                |
| ------------- | ----------------------------------------------------------------------------------- |
| `available`   | 已在 production 受控窗口或等价真实环境完成账号授权、Webhook 和目标操作实测          |
| `conditional` | 已交付连接器契约或 mock，真实接入仍受账号、权限、App Review、地区或上游数据结构限制 |
| `blocked`     | 所需资产、官方权限或上游依赖缺失，当前只能保留配置、格式化或人工降级路径            |
| `phase-2`     | 不属于一期验收范围，作为二期候选保留研究结论                                        |

fixture / mock 通过只表示接口契约完成。只有在 production 受控窗口或等价真实环境完成账号授权、Webhook 和目标操作实测后，平台能力才能标记为 `available`。

## 无账号本地演练

- admin-only `/admin/platforms` 平台联调中心把账号 readiness、无凭据 fixture 演练和外部阻塞集中到一个可点击界面；管理员可从状态矩阵进入 `PlatformAccounts` CRUD，后续取得账号后在既有结构中补录非敏感 ID、授权 / 审核状态和只写 token，不需要重做 UI 或纯请求 seam。
- admin-only `POST /api/platforms/simulations` 提供 8 个确定性场景：Meta 入站归一化、Meta 回复请求、Facebook 图片发布请求、Instagram 发布序列、LinkedIn 初始化 / PUT 上传 / 发帖 / 状态、TikTok 官方签名验证、无账号发布降级和未知结果人工补偿。所有场景禁止网络访问，不读取平台凭据，不把 fixture 成功解释为平台 accepted / published。
- 演练 route 限制 4KB JSON，请求鉴权与错误状态覆盖 `401 / 403 / 400 / 413 / 415`；响应只暴露稳定的内部步骤、方法和不含凭据的路径。TikTok 验签与 LinkedIn 辅助发布包可显示为 `ready-for-controlled-test + implemented`，但 TikTok Business DM 与 LinkedIn 自动发布仍分别读取 blocked 的官方 / readiness 条件。
- 故障模型回归覆盖未知外部结果停止自动重发、重复发布键冲突、凭据 / URL 查询参数不泄漏、签名缺失或畸形、请求过期、长 URL、4KB body 和 UTF-8 多字节长度。production standalone Chrome 已验证桌面 / 移动状态矩阵、键盘 Tab 切换、Mock 执行和阻塞视图。
- 隔离 PostgreSQL fresh reset 后直接运行 integration 会因缺少 8 条 showcase media 前置而在 `seed-media.test.ts` 得到 `0 / 8`，与平台代码无关；按正式门禁先完整 seed 两次后，integration `111/111` 通过。其余门禁为 unit `341/341`、contract `47/47`、operations `27/27`、production build 和 production E2E `2/2`。

## 当前能力矩阵

| 平台 / 能力                   | 当前状态      | 当前仓库证据                                                                                                                                                                                                                                          | 待联调条件                                                                                  |
| ----------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Facebook Messenger 入站消息   | `conditional` | Meta connector、合成 fixture、raw HMAC / 时间窗 / 幂等、Jobs inbox、worker、Task 9 adapter、平台账号预检，以及公网 route 的 fake / PostgreSQL 测试                                                                                                    | Facebook 企业 / 商业账号、Page、Meta App、Webhook 订阅、所需权限 / App Review、受控真实环境 |
| Instagram DM 入站消息         | `conditional` | Meta connector、合成 fixture、raw HMAC / 时间窗 / 幂等、Jobs inbox、worker、Task 9 adapter、平台账号预检，以及公网 route 的 fake / PostgreSQL 测试                                                                                                    | Instagram 企业 / 商业账号、Facebook Page 绑定、Meta App 权限 / App Review、受控真实环境     |
| TikTok 私信入站消息           | `blocked`     | 可安全记录商业账号/授权状态和缺口；内部 `tiktok` 会话 channel、Job dispatch 与幂等入库已验证，但默认 worker fail-closed，只有未来经代码 review 的官方 connector 才能显式启用该内部路径；未交付 raw connector、Webhook route 或猜测性 fixture 契约测试 | TikTok 商业账号、目标地区官方私信 API、官方事件 schema、应用授权 / 审核、受控真实环境       |
| 社媒会话 AI 出站回复          | `blocked`     | server-only contract / fake 已冻结未知结果恢复语义；无出站授权时入站 adapter 持久化人工接管，不伪造已发送 AI 回复                                                                                                                                     | 对应账号 / 权限 / 消息窗口、持久 Job handler、平台 adapter、受控真实入站与出站验证          |
| Facebook / Instagram 图文发布 | `conditional` | 平台账号预检 + Task 13 capability / publish / status port；未交付发布数据库 adapter，`PublishJobs` / `PublishLogs` 尚待 Task 12                                                                                                                       | Task 12 发布结构、Meta Page / Instagram Content Publishing 权限、App Review、受控真实环境   |
| LinkedIn 图文发布             | `conditional` | 平台账号预检、确定性文案、素材 manifest、调用方提供已授权素材字节时的离线 ZIP package 与人工发布步骤；自动发布 adapter 尚未交付                                                                                                                       | Task 12 内容契约；甲方 LinkedIn 账号及应用发布权限证据；有权限后再做自动发布 adapter        |
| WhatsApp 系统接入             | `phase-2`     | 不在一期开发或验收范围                                                                                                                                                                                                                                | 二期再评估网页插件等替代接入、成本、合规与账号资产                                          |

## 接口 / 纯逻辑阶段证据

- 统一归一化事件、connector、批次原子幂等 repository port、Webhook verifier / rate limiter port、conversation writer port 和 message-status writer port 已在 Task 13 分支实现。
- Meta Messenger / Instagram 使用合成官方结构 fixture；测试覆盖 raw bytes HMAC、challenge、JSON content type、body 大小、48 小时时间窗、延迟重投、账号 allowlist、每账号限流、重复事件和 digest 冲突，不访问真实平台网络。
- raw body 摘要仅用于审计；幂等冲突按规范化单事件摘要判断，避免同一平台事件因外层批次重组被误判冲突。
- Meta durable inbound 阶段将规范化事件作为 `Jobs` 的原子 inbox，worker 在租约前后围栏检查后，通过 Task 9 权威会话服务写入会话、消息、接管与审计；已覆盖“业务提交后 worker 死亡、lease 过期重领”的无重复恢复场景。
- 社媒入站当前在没有外发账号 / adapter 时会明确转人工，不产生未投递的 AI 回复记录。后续出站 port / fake 必须遵循 [ADR-0003](../architecture/adr/0003-social-conversation-outbound-delivery.md)：`ConversationService` 创建稳定内部回复身份和 `deliveryKey`，delivery intent / outbox 持有业务状态，真实发送必须通过持久 Job 且在入队和执行前检查人工接管状态。
- 附件不下载、不访问网络；外部附件 URL 只保留 HTTPS origin/path，查询参数、fragment 和 userinfo 一律不进入 Job payload，避免短期签名或 token 被持久化。
- Meta delivery/read callback 当前明确忽略，不进入 Jobs；`message-status` 仅保留未来 adapter 的内部类型，未被标记为已实现的状态回调能力。
- 发布侧只冻结 Facebook / Instagram / LinkedIn capability、publish、status 接口；默认 `conditional` fake 不会假装 accepted，只有显式测试 override 的 `available` 状态才模拟成功。LinkedIn assisted export 可在调用方提供已授权素材字节时生成内存中的 ZIP package、文案、无敏感 URL 的素材清单和人工操作步骤；它不下载外部 URL 或写入文件。
- publish 的 accepted 响应必须提供稳定的 `externalPublicationId`，供后续 status 查询与 Task 12 持久化关联使用；它是 adapter-issued 的平台 publication / async job 或可查询关联句柄，不是 Task 12 数据库主键。mock 将幂等作用域冻结为 `platform + idempotencyKey`，同键不同内容 fail-closed 为不可重试 `invalid_request`。
- `message-status` 的内部类型 / dispatch port 仅为后续 adapter 预留；当前没有真实平台送达状态 connector、回调 route 或入队路径。
- TikTok 官方私信事件 schema 仍缺失，不创建猜测字段、raw webhook parser 或伪造 fixture；在不触达外部平台的前提下，已为已认证、已规范化的未来事件完成 `tiktok` 会话 / Job 存储路径和幂等回归。默认 worker 会拒绝 TikTok 事件；未来 connector 必须在代码中显式启用该路径并通过新的官方 fixture / 契约 review。WhatsApp 一期 connector、fixture 与测试已删除。

## 数据库集成阻塞

- Task 9 `Conversations` / `Messages` 已合并；Meta durable inbound adapter 通过权威会话服务写入，不让外部事件绕过权限、幂等或审计。公网 route 代码已完成，但尚未部署、订阅或使用真实 secret。
- Task 12 `PublishJobs` / `PublishLogs` 尚未合并：不创建临时发布 Collection 或替代 migration。
- Task 10 Jobs / worker 已合并；Meta durable inbound 已注册 `platform.event.dispatch` handler，并由 Jobs 的既有 lease / retry / dead job 机制托管。真实 webhook ingress、平台账号授权、生产受控窗口、人工补偿界面和真实出站仍未实现，不能视为真实平台联调完成。
- 真实社媒 AI 自动出站仍缺 `PlatformAccounts`、持久 delivery handler、官方 adapter、账号 / 权限及受控发送窗口；在这些条件满足前不得把 fake、草稿或内部状态标为发送成功。provider 已接受但 worker 未持久化结果时，必须使用平台幂等键或状态查询归并；两者不可用时标为 `delivery_unknown` 并人工补偿，禁止盲目重发。
- 每个数据库依赖都必须等待对应 Collection、migration、`src/payload.config.ts` 注册和 `src/payload-types.ts` 生成类型全部合并到 `main`。随后必须先 `git fetch origin` 并从最新 `origin/main` 更新 Task 13 基线，再实现 Payload / PostgreSQL adapter 与 integration test。
- `PlatformAccounts` 是 Task 13 的真实前向配置结构，不是替代 `Conversations`、`Messages`、`PublishJobs` 或 `PublishLogs`。它只保存管理员可见的账号元数据、审核状态与加密令牌配置，并提供不含令牌的 readiness 预检；不改变发布侧等待 Task 12 的约束。

## 外部资产清单

开始受控真实联调前需甲方提供或确认：

- Meta Business、App ID、App Secret 的受控 secret 注入方式，以及 Facebook Page / Instagram Professional Account 的外部 ID allowlist；
- Facebook 企业 / 商业账号的 Page、Instagram 企业 / 商业账号及绑定关系；
- TikTok 商业账号、目标地区、开发者应用及私信 API / 审核状态；
- Webhook callback 域名、verify token 和对应订阅字段；
- Meta App 的 admin / developer 测试角色，以及一期实际订阅的入站消息字段；delivery/read callback 不进入当前一期 route；
- 已申请权限、App Review 状态与平台阻塞截图 / 工单；
- LinkedIn 图文发布的账号及应用发布权限证据；
- 测试应用与 production 的 token、账号和 Webhook 配置隔离方式。

所有真实 secret 只进入部署环境，不写入本记录、代码、fixture、日志或 PR。
