# 一期平台接入 PoC 记录

更新日期：2026-07-25

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

| 平台 / 能力                   | 当前状态      | 当前仓库证据                                                                                                          | 待联调条件                                                                                  |
| ----------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Facebook Messenger 入站消息   | `conditional` | Meta connector、合成 fixture、raw HMAC / 时间窗 / 幂等、Jobs inbox、worker、Task 9 adapter，以及公网 route 的 fake / PostgreSQL 测试 | Facebook 企业 / 商业账号、Page、Meta App、Webhook 订阅、所需权限 / App Review、受控真实环境 |
| Instagram DM 入站消息         | `conditional` | Meta connector、合成 fixture、raw HMAC / 时间窗 / 幂等、Jobs inbox、worker、Task 9 adapter，以及公网 route 的 fake / PostgreSQL 测试 | Instagram 企业 / 商业账号、Facebook Page 绑定、Meta App 权限 / App Review、受控真实环境     |
| TikTok 私信入站消息           | `blocked`     | 当前会话 channel / migration 尚未包含 TikTok，尚未交付 connector、Webhook route 或 fixture 契约测试                   | TikTok 商业账号、目标地区官方私信 API、应用授权 / 审核、受控真实环境                        |
| Facebook / Instagram 图文发布 | `conditional` | Task 13 分支已冻结 capability / publish / status port；未交付发布 adapter，`PublishJobs` / `PublishLogs` 尚待 Task 12 | Task 12 发布结构、Meta Page / Instagram Content Publishing 权限、App Review、受控真实环境   |
| LinkedIn 图文发布             | `conditional` | Task 13 分支已交付确定性文案、素材 manifest、调用方提供已授权素材字节时的离线 ZIP package 与人工发布步骤；自动发布 adapter 尚未交付 | Task 12 内容契约；甲方 LinkedIn 账号及应用发布权限证据；有权限后再做自动发布 adapter        |
| WhatsApp 系统接入             | `phase-2`     | 不在一期开发或验收范围                                                                                                | 二期再评估网页插件等替代接入、成本、合规与账号资产                                          |

## 接口 / 纯逻辑阶段证据

- 统一归一化事件、connector、批次原子幂等 repository port、Webhook verifier / rate limiter port、conversation writer port 和 message-status writer port 已在 Task 13 分支实现。
- Meta Messenger / Instagram 使用合成官方结构 fixture；测试覆盖 raw bytes HMAC、challenge、JSON content type、body 大小、48 小时时间窗、延迟重投、账号 allowlist、每账号限流、重复事件和 digest 冲突，不访问真实平台网络。
- raw body 摘要仅用于审计；幂等冲突按规范化单事件摘要判断，避免同一平台事件因外层批次重组被误判冲突。
- Meta durable inbound 阶段将规范化事件作为 `Jobs` 的原子 inbox，worker 在租约前后围栏检查后，通过 Task 9 权威会话服务写入会话、消息、接管与审计；已覆盖“业务提交后 worker 死亡、lease 过期重领”的无重复恢复场景。
- 附件不下载、不访问网络；外部附件 URL 只保留 HTTPS origin/path，查询参数、fragment 和 userinfo 一律不进入 Job payload，避免短期签名或 token 被持久化。
- Meta delivery/read callback 当前明确忽略，不进入 Jobs；`message-status` 仅保留未来 adapter 的内部类型，未被标记为已实现的状态回调能力。
- 发布侧只冻结 Facebook / Instagram / LinkedIn capability、publish、status 接口；默认 `conditional` fake 不会假装 accepted，只有显式测试 override 的 `available` 状态才模拟成功。LinkedIn assisted export 可在调用方提供已授权素材字节时生成内存中的 ZIP package、文案、无敏感 URL 的素材清单和人工操作步骤；它不下载外部 URL 或写入文件。
- publish 的 accepted 响应必须提供稳定的 `externalPublicationId`，供后续 status 查询与 Task 12 持久化关联使用；它是 adapter-issued 的平台 publication / async job 或可查询关联句柄，不是 Task 12 数据库主键。mock 将幂等作用域冻结为 `platform + idempotencyKey`，同键不同内容 fail-closed 为不可重试 `invalid_request`。
- `message-status` 的内部类型 / dispatch port 仅为后续 adapter 预留；当前没有真实平台送达状态 connector、回调 route 或入队路径。
- TikTok 官方私信事件 schema 仍缺失，不创建猜测字段或伪造 fixture；WhatsApp 一期 connector、fixture 与测试已删除。

## 数据库集成阻塞

- Task 9 `Conversations` / `Messages` 已合并；Meta durable inbound adapter 通过权威会话服务写入，不让外部事件绕过权限、幂等或审计。公网 route 代码已完成，但尚未部署、订阅或使用真实 secret。
- Task 12 `PublishJobs` / `PublishLogs` 尚未合并：不创建临时发布 Collection 或替代 migration。
- Task 10 Jobs / worker 已合并；Meta durable inbound 已注册 `platform.event.dispatch` handler，并由 Jobs 的既有 lease / retry / dead job 机制托管。真实 webhook ingress、平台账号授权、生产受控窗口、人工补偿界面和真实出站仍未实现，不能视为真实平台联调完成。
- 每个数据库依赖都必须等待对应 Collection、migration、`src/payload.config.ts` 注册和 `src/payload-types.ts` 生成类型全部合并到 `main`。随后必须先 `git fetch origin` 并从最新 `origin/main` 更新 Task 13 基线，再实现 Payload / PostgreSQL adapter 与 integration test。

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
