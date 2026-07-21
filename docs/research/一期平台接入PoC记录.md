# 一期平台接入 PoC 记录

更新日期：2026-07-21

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
| Facebook Messenger 入站消息   | `conditional` | Task 13 分支已交付 Meta connector、合成官方结构 fixture、raw-body 验签/时间窗/幂等契约测试；尚无 route / DB adapter   | Facebook 企业 / 商业账号、Page、Meta App、Webhook 订阅、所需权限 / App Review、受控真实环境 |
| Instagram DM 入站消息         | `conditional` | Task 13 分支已交付 Meta connector、合成官方结构 fixture、raw-body 验签/时间窗/幂等契约测试；尚无 route / DB adapter   | Instagram 企业 / 商业账号、Facebook Page 绑定、Meta App 权限 / App Review、受控真实环境     |
| TikTok 私信入站消息           | `blocked`     | 当前会话 channel / migration 尚未包含 TikTok，尚未交付 connector、Webhook route 或 fixture 契约测试                   | TikTok 商业账号、目标地区官方私信 API、应用授权 / 审核、受控真实环境                        |
| Facebook / Instagram 图文发布 | `conditional` | Task 13 分支已冻结 capability / publish / status port；未交付发布 adapter，`PublishJobs` / `PublishLogs` 尚待 Task 12 | Task 12 发布结构、Meta Page / Instagram Content Publishing 权限、App Review、受控真实环境   |
| LinkedIn 图文发布             | `conditional` | Task 13 分支已交付确定性文案、素材 manifest 与人工发布步骤；自动发布 adapter 尚未交付                                 | Task 12 内容契约；甲方 LinkedIn 账号及应用发布权限证据；有权限后再做自动发布 adapter        |
| WhatsApp 系统接入             | `phase-2`     | 不在一期开发或验收范围                                                                                                | 二期再评估网页插件等替代接入、成本、合规与账号资产                                          |

## 接口 / 纯逻辑阶段证据

- 统一归一化事件、connector、批次原子幂等 repository port、Webhook verifier / rate limiter port、conversation writer port 和 message-status writer port 已在 Task 13 分支实现。
- Meta Messenger / Instagram 使用合成官方结构 fixture；测试覆盖 raw bytes HMAC、challenge、JSON content type、body 大小、时间窗、重复事件和 digest 冲突，不访问真实平台网络。
- raw body 摘要仅用于审计；幂等冲突按规范化单事件摘要判断，避免同一平台事件因外层批次重组被误判冲突。
- 发布侧只冻结 Facebook / Instagram / LinkedIn capability、publish、status 接口；LinkedIn assisted export 只生成内存中的文案、素材清单和人工操作步骤。
- message-status 目前只冻结内部类型和 dispatch port，尚未交付真实平台送达状态 connector 或回调 route。
- TikTok 官方私信事件 schema 仍缺失，不创建猜测字段或伪造 fixture；WhatsApp 一期 connector、fixture 与测试已删除。

## 数据库集成阻塞

- Task 9 `Conversations` / `Messages` 已合并；连接器仍必须通过权威会话服务写入，不得让外部 Webhook 直接绕过权限、幂等或审计。
- Task 12 `PublishJobs` / `PublishLogs` 尚未合并：不创建临时发布 Collection 或替代 migration。
- Task 10 Jobs / worker 已合并，可作为后续真实平台异步 handler 的基础；但当前 Task 13 分支尚未实现 Webhook route、Jobs handler、失败重试、dead job 或人工补偿集成，不能视为真实异步链路已完成。
- 每个数据库依赖都必须等待对应 Collection、migration、`src/payload.config.ts` 注册和 `src/payload-types.ts` 生成类型全部合并到 `main`。随后必须先 `git fetch origin` 并从最新 `origin/main` 更新 Task 13 基线，再实现 Payload / PostgreSQL adapter 与 integration test。

## 外部资产清单

开始受控真实联调前需甲方提供或确认：

- Meta Business、App ID、App Secret 的受控 secret 注入方式；
- Facebook 企业 / 商业账号的 Page、Instagram 企业 / 商业账号及绑定关系；
- TikTok 商业账号、目标地区、开发者应用及私信 API / 审核状态；
- Webhook callback 域名、verify token 和对应订阅字段；
- 已申请权限、App Review 状态与平台阻塞截图 / 工单；
- LinkedIn 图文发布的账号及应用发布权限证据；
- 测试应用与 production 的 token、账号和 Webhook 配置隔离方式。

所有真实 secret 只进入部署环境，不写入本记录、代码、fixture、日志或 PR。
