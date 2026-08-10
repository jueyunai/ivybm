# 一期平台接入 PoC 记录

更新日期：2026-08-10

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

## 当前能力矩阵

| 平台 / 能力                   | 当前状态      | 当前仓库证据                                                                                                                                                                                                                                          | 待联调条件                                                                                  |
| ----------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Facebook Messenger 入站消息   | `conditional` | Meta connector、合成 fixture、raw HMAC / 时间窗 / 幂等、Jobs inbox、worker、Task 9 adapter、平台账号 readiness；新增管理员 OAuth start / callback / disconnect、10 分钟加密 state、Business Login 权限复核、预登记 Page ID 严格绑定和加密 Page Token 保存 | Facebook 企业 / 商业账号、Page、Meta App Secret 安全注入、Webhook 订阅、所需权限 / App Review、受控真实环境 |
| Instagram DM 入站消息         | `conditional` | Meta connector、合成 fixture、raw HMAC / 时间窗 / 幂等、Jobs inbox、worker、Task 9 adapter、平台账号 readiness；独立的 Instagram Login for Business OAuth 代码已完成，真实授权仍待客户 Instagram Professional 账号与 App Review | Instagram 专业/商业账号、独立 Instagram Login 配置、Instagram App ID/Secret、App Review、受控真实环境 |
| TikTok 私信入站消息           | `blocked`     | 可安全记录商业账号/授权状态和缺口；内部 `tiktok` 会话 channel、Job dispatch 与幂等入库已验证，migration down 会拒绝仍可处理或人工重试的 TikTok Jobs；默认 worker fail-closed，只有未来经代码 review 的官方 connector 才能显式启用；未交付 raw connector、Webhook route 或猜测性 fixture 契约测试 | TikTok 商业账号、目标地区官方私信 API、官方事件 schema、应用授权 / 审核、受控真实环境       |
| 社媒会话 AI 出站回复          | `blocked`     | 入站 adapter 在没有出站授权时会持久人工接管，避免伪造已发送 AI 回复；出站 contract / fake 由 ADR-0003 约束，尚未形成真实 adapter                                                                                                                      | 对应账号 / 权限 / 消息窗口、持久 Job handler、平台 adapter、受控真实入站与出站验证          |
| Facebook / Instagram 图文发布 | `conditional` | 平台账号预检 + Task 13 账号级 `PublishingService` capability / publish / status contract 与 fake；未交付发布 adapter，`PublishJobs` / `PublishLogs` 尚待 Task 12                                                                                       | Task 12 发布结构、Meta Page / Instagram Content Publishing 权限、App Review、受控真实环境   |
| LinkedIn 图文发布             | `conditional` | 平台账号预检、账号级发布 contract / fake，以及公共 `prepareAssistedPublication()` 返回的确定性文案、无原始 `sourceUrl` manifest、离线 ZIP bytes 与人工步骤；自动发布 adapter 尚未交付                                                               | Task 12 发布结构；甲方 LinkedIn 账号及应用发布权限证据；有权限后再做自动发布 adapter        |
| WhatsApp 系统接入             | `phase-2`     | 不在一期开发或验收范围                                                                                                                                                                                                                                | 二期再评估网页插件等替代接入、成本、合规与账号资产                                          |

## 接口 / 纯逻辑阶段证据

- 统一归一化事件、connector、批次原子幂等 repository port、Webhook verifier / rate limiter port、conversation writer port 和 message-status writer port 已在 Task 13 分支实现。
- Meta Messenger / Instagram 使用合成官方结构 fixture；测试覆盖 raw bytes HMAC、challenge、JSON content type、body 大小、48 小时时间窗、延迟重投、账号 allowlist、每账号限流、重复事件和 digest 冲突，不访问真实平台网络。
- Facebook Page OAuth 使用 Facebook Login for Business 的 `config_id` 发起授权，App Secret 仅出现在服务器到 Meta 的 POST body；回调 URL 运行时绑定登记的站点 origin，不信任请求 Host。state / account context 以平台凭据主密钥加密，Page identity 与 `pages_show_list`、`pages_manage_metadata`、`pages_messaging` 在 Token 入库前逐项验证。Facebook 发布权限不作为 Messenger 连接硬门槛。Instagram 从该流程拆开，改走独立 Instagram Login for Business；初始 code exchange 解析 provider 返回的实际 `permissions`，不调用未受支持的 `graph.instagram.com/.../me/permissions`，再用 long token exchange 与 `/me` 完成 token 生命周期和身份绑定。
- Meta 与 Instagram OAuth transaction 绑定账号类型、external ID 和同一账号更新事务内单调递增的 `authorizationRevision`；provider I/O 返回后，callback 在同一 PostgreSQL 行锁事务中比较 revision 并写入。disconnect、身份或凭据修改都会使旧 callback 失效，不依赖可能同毫秒碰撞的 `updated_at timestamp(3)`。
- 官网已提供英文 / 阿语隐私政策、服务条款与数据删除说明，并为 Meta Dashboard 提供 `/privacy`、`/terms`、`/data-deletion` 三条稳定入口；提交 App Review 前仍需客户核对法律文本和公开联系邮箱。
- raw body 摘要仅用于审计；幂等冲突按规范化单事件摘要判断，避免同一平台事件因外层批次重组被误判冲突。
- Meta durable inbound 阶段将规范化事件作为 `Jobs` 的原子 inbox，worker 在租约前后围栏检查后，通过 Task 9 权威会话服务写入会话、消息、接管与审计；已覆盖“业务提交后 worker 死亡、lease 过期重领”的无重复恢复场景。
- Meta Webhook 在批次持久化前、worker 在 claim 后 dispatch 前分别查询 `PlatformAccounts`；账号不存在、重复、disabled / blocked / 未连接或 messaging capability blocked 时 fail closed。混合账号批次中任一账号被拒绝时整批零入队；账号在入队后停用时 worker 不调用会话写入。
- 平台账号 readiness 将显式 blocked capability 保持为 `blocked`，并检查 access token 过期、refresh token 是否配置及当前部署能否解密。替换或清除 access token 时会同步清理未显式更新的旧 `expiresAt`，避免轮换后沿用错误期限；所有检查只返回稳定缺口码，不回显 token、密文或 provider 错误。
- 社媒入站当前在没有外发账号 / adapter 时会明确转人工，不产生未投递的 AI 回复记录。后续出站 port / fake 必须遵循 [ADR-0003](../architecture/adr/0003-social-conversation-outbound-delivery.md)：`ConversationService` 创建稳定内部回复身份和 `deliveryKey`，delivery intent / outbox 持有业务状态；worker 调用 adapter 前以 `conversationId + replyId + deliveryKey + expectedRevision` 原子 claim 权威 intent，handoff 转换与 active claim 串行化，避免状态读取后的 TOCTOU。adapter 只接收平台传输字段，不接收 handoff、revision 或会话内部 ID。
- 附件不下载、不访问网络；外部附件 URL 只保留 HTTPS origin/path，查询参数、fragment 和 userinfo 一律不进入 Job payload，避免短期签名或 token 被持久化。
- Meta delivery/read callback 当前明确忽略，不进入 Jobs；`message-status` 仅保留未来 adapter 的内部类型，未被标记为已实现的状态回调能力。
- 发布侧以 `src/modules/publishing/contracts.ts` 冻结 Task 12 可直接消费的 Facebook / Instagram / LinkedIn `PublishingService` 公共 contract，并由 `tests/fakes/publishingService.ts` 提供不依赖平台私有模块的测试 fake。capability、publish、status、`prepareAssistedPublication` 与所有结果均携带 `platformAccountId`；默认 `conditional` automatic fake 不会假装 accepted，只有显式测试 override 的 `available` 状态才模拟自动发布成功。
- LinkedIn `conditional + assisted` 可通过公共 `prepareAssistedPublication()` 生成真实、确定性的内存 ZIP bytes、规范化文案、无敏感 URL manifest 和人工操作步骤，Task 12 无需导入 `src/modules/platforms/linkedin` 私有 helper。输入类型不包含 `sourceUrl`，运行时夹带该字段也 fail closed；调用方只能提供已授权的内部媒体 bytes。该路径不下载外部 URL、不写入文件、不调用平台网络，也不增加 provider publish attempt。
- 自动发布素材的 `sourceUrl` 是瞬时 transport 输入：只接受无 userinfo 的 HTTPS URL，保留 provider 下载所需的签名 query、移除 fragment，并严格限制长度；该 URL 不参与命令 fingerprint、不进入 assisted manifest / ZIP 或发布结果。真实 adapter 仍须避免将完整 transport URL 写入日志或持久状态。
- accepted 响应必须提供稳定的 `externalPublicationId`，供后续 status 查询与 Task 12 持久化关联使用；它是 adapter-issued 的平台 publication / async job 或可查询关联句柄，不是 Task 12 数据库主键。mock 将幂等作用域冻结为 `platform + platformAccountId + idempotencyKey`，并以带类型的结构化编码建立内部 command / reference key；控制字符不能跨字段制造账号碰撞。同键不同内容 fail-closed 为不可重试 `invalid_request`，同平台不同账号互不去重或错配状态。
- provider 请求已经越过发送边界、但响应丢失或最终成功标识缺失 / 畸形时，发布 contract 使用一等 `delivery_unknown`，`retryable: false`；同 key 重提只返回既有围栏，不会产生第二次 provider attempt。status 可按账号 + 幂等键查询，并用可选 `externalPublicationId` 交叉检查；fake 支持把未知结果恢复为确定状态。Meta / LinkedIn 纯 parser 只提供稳定、脱敏的 unknown-result 信号，真实 provider 查询、恢复和人工补偿仍待后续 adapter 与 Task 12 / Task 10 状态结构。
- `message-status` 的内部类型 / dispatch port 仅为后续 adapter 预留；当前没有真实平台送达状态 connector、回调 route 或入队路径。
- TikTok 官方私信事件 schema 仍缺失，不创建猜测字段、raw webhook parser 或伪造 fixture；在不触达外部平台的前提下，已为已认证、已规范化的未来事件完成 `tiktok` 会话 / Job 存储路径和幂等回归。默认 worker 会拒绝 TikTok 事件；未来 connector 必须在代码中显式启用该路径并通过新的官方 fixture / 契约 review。WhatsApp 一期 connector、fixture 与测试已删除。

## Instagram production OAuth 联调记录（2026-08-10）

- production 受控联调确认 Instagram short-token endpoint 返回 HTTP 200，响应包含 `access_token`、`permissions`、`user_id` 顶层字段；原实现只接受 `data[0]`，已改为兼容 provider 的顶层 grant。
- Meta Access Token Debugger 已确认测试账号 token 有效，并同时包含 `instagram_business_basic`、`instagram_business_manage_messages`、`instagram_business_manage_comments`；Instagram 授权页也显示基础、消息和评论权限均已开启，但 callback 仍返回 `required_permission_missing`。因此账号角色、App ID 和所需权限配置不再是当前首要阻塞，剩余问题指向 short-token `permissions` 值的运行时格式兼容与可观测性。
- 本轮修复的验收条件：兼容逗号分隔字符串和字符串数组两种 `permissions` 格式；缺字段、类型错误、空值、超量、非法 scope 继续 fail closed；日志记录 `permissionsType`、数量、数组元素类型、完整的有界合法 `providerScopes` 及白名单内 `grantedScopes` / `missingScopes`，不得记录 token、authorization code、user ID、App Secret 或原始响应正文。
- 回归矩阵覆盖 flat / wrapped grant、字符串 / 数组 permissions、缺少必需权限、畸形数组、未知 scope 脱敏和 callback 结构化日志。修复与自动化测试通过仍不把能力标记为 `available`；只有 production 重新授权、身份绑定和 token 加密入库成功后才能提升状态。

## 数据库集成阻塞

- Task 9 `Conversations` / `Messages` 已合并；Meta durable inbound adapter 通过权威会话服务写入，不让外部事件绕过权限、幂等或审计。公网 route 代码已完成，但尚未部署、订阅或使用真实 secret。
- Task 12 `PublishJobs` / `PublishLogs` 尚未合并：不创建临时发布 Collection 或替代 migration。
- Task 10 Jobs / worker 已合并；Meta durable inbound 已注册 `platform.event.dispatch` handler，并由 Jobs 的既有 lease / retry / dead job 机制托管。真实 webhook ingress、平台账号授权、生产受控窗口、人工补偿界面和真实出站仍未实现，不能视为真实平台联调完成。
- 真实 Facebook Page / Instagram Professional OAuth 尚未用客户账号和 production HTTPS 完成浏览器联调；当前只代表代码、mock 与契约完成，状态继续是 `conditional`。真实社媒 AI 自动出站仍缺持久 delivery intent / claim 实现、Task 10 handler、官方 adapter、账号 / 权限及受控发送窗口；在这些条件满足前不得把 fake、草稿或内部状态标为发送成功。claim 必须绑定 worker lease 与 fencing generation：I/O 开始后的过期重领先 recovery，只有明确的 `retry_same_delivery_key` 能在重新取得 fencing 标记后执行一次同 payload、同 key 重试。provider 已接受但 worker 未持久化结果时，公共 `delivery_unknown` 信号不可进入普通 Job retry，必须使用平台幂等键或状态查询归并；两者不可用或恢复身份不匹配时标为 `delivery_unknown` 并人工补偿，禁止盲目重发。
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
