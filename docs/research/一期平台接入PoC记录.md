# 一期平台接入 PoC 记录

更新日期：2026-07-20

> 范围冻结（2026-07-20）：一期会话接入为 Facebook Messenger、Instagram DM、TikTok 私信；一期图文发布为 Facebook、Instagram、LinkedIn。WhatsApp 移出一期，二期再评估网页插件等替代接入；LinkedIn 私信不属于一期自动会话范围。
>
> 本文件用于冻结 Task 13 的验收口径和阻塞条件。当前分支及 `main` 尚未交付第三方平台 connector 代码；旧的 fixture / mock 证据来自未 push 的本地 checkpoint，仅供历史参考，不属于仓库交付，也不代表平台真实可用。

## 状态定义

| 状态            | 含义                                                                            |
| --------------- | ------------------------------------------------------------------------------- |
| `available`     | 已在 staging 或等价真实环境完成账号授权、Webhook 和目标操作实测                 |
| `conditional`   | 已交付连接器契约或 mock，真实接入仍受账号、权限、App Review、地区或上游数据结构限制 |
| `blocked`       | 所需资产、官方权限或上游依赖缺失，当前只能保留配置、格式化或人工降级路径        |
| `phase-2`       | 不属于一期验收范围，作为二期候选保留研究结论                                   |

fixture / mock 通过只表示接口契约完成。只有在 staging 或等价真实环境完成账号授权、Webhook 和目标操作实测后，平台能力才能标记为 `available`。

## 当前能力矩阵

| 平台 / 能力                   | 当前状态  | 当前仓库证据                                                                                       | 待联调条件                                                                                                     |
| ----------------------------- | --------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Facebook Messenger 入站消息   | `blocked` | 已有统一会话模型；尚未交付 Facebook connector、Webhook route 或官方 fixture 契约测试              | Facebook 企业 / 商业账号、Page、Meta App、Webhook 订阅、所需权限 / App Review、staging                         |
| Instagram DM 入站消息         | `blocked` | 已有统一会话模型；尚未交付 Instagram connector、Webhook route 或官方 fixture 契约测试             | Instagram 企业 / 商业账号、Facebook Page 绑定、Meta App 权限 / App Review、staging                              |
| TikTok 私信入站消息           | `blocked` | 当前会话 channel / migration 尚未包含 TikTok，尚未交付 connector、Webhook route 或 fixture 契约测试 | TikTok 商业账号、目标地区官方私信 API、应用授权 / 审核、staging                                                 |
| Facebook / Instagram 图文发布 | `blocked` | 尚未交付发布 adapter；`PublishJobs` / `PublishLogs` 共享结构尚待 Task 12                           | Task 12 发布结构、Meta Page / Instagram Content Publishing 权限、App Review、staging                            |
| LinkedIn 图文发布             | `blocked` | 已锁定“API 可用则自动，否则格式化、素材打包、复制文案和人工发布”降级口径；尚未交付 adapter          | Task 12 内容契约、甲方 LinkedIn 账号及应用发布权限证据                                                          |
| WhatsApp 系统接入             | `phase-2` | 不在一期开发或验收范围                                                                            | 二期再评估网页插件等替代接入、成本、合规与账号资产                                                              |

## 本地接口 / 纯逻辑 checkpoint（未 push，非仓库交付）

- 历史 checkpoint 曾探索统一归一化事件、connector、原子 `enqueue` 幂等 repository port、Webhook rate limiter port、conversation writer port 和 message-status writer port；该 checkpoint 未 push，不能作为当前一期交付证据。
- 后续一期实现应为 Facebook Messenger、Instagram DM、TikTok 私信分别提供官方结构 fixture、验签、时间戳、幂等与归一化契约测试；消息送达状态与 Task 12 图文发布状态保持独立。
- Meta / WhatsApp contract 的历史本地测试不覆盖 TikTok，且 WhatsApp 不再计入一期验收。

## 数据库集成阻塞

- Task 9 `Conversations` / `Messages` 已合并；连接器仍必须通过权威会话服务写入，不得让外部 Webhook 直接绕过权限、幂等或审计。
- Task 12 `PublishJobs` / `PublishLogs` 尚未合并：不创建临时发布 Collection 或替代 migration。
- 真实 Webhook 异步消费、发布执行、失败重试、dead job 和人工补偿仍须以 Task 10 的 Jobs / worker 完整契约为前提；纯连接器接口和 fixture 契约测试不依赖 Task 10。
- 每个数据库依赖都必须等待对应 Collection、migration、`src/payload.config.ts` 注册和 `src/payload-types.ts` 生成类型全部合并到 `main`。随后必须先 `git fetch origin` 并从最新 `origin/main` 更新 Task 13 基线，再实现 Payload / PostgreSQL adapter 与 integration test。

## 外部资产清单

开始 staging 联调前需甲方提供或确认：

- Meta Business、App ID、App Secret 的 staging secret 注入方式；
- Facebook 企业 / 商业账号的 Page、Instagram 企业 / 商业账号及绑定关系；
- TikTok 商业账号、目标地区、开发者应用及私信 API / 审核状态；
- Webhook callback 域名、verify token 和对应订阅字段；
- 已申请权限、App Review 状态与平台阻塞截图 / 工单；
- LinkedIn 图文发布的账号及应用发布权限证据；
- staging 与 production 独立的 token、账号和 Webhook 配置。

所有真实 secret 只进入部署环境，不写入本记录、代码、fixture、日志或 PR。
