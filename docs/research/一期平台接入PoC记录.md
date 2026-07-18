# 一期平台接入 PoC 记录

更新日期：2026-07-18

## 状态定义

| 状态            | 含义                                                                            |
| --------------- | ------------------------------------------------------------------------------- |
| `available`     | 已在 staging 或等价真实环境完成账号授权、Webhook 和目标操作实测                 |
| `conditional`   | 连接器契约或 mock 已完成，真实接入仍受账号、权限、App Review 或上游数据结构限制 |
| `blocked`       | 所需资产、官方权限或上游依赖缺失，当前只能保留配置、格式化或人工降级路径        |
| `research-only` | 一期只记录官方能力和限制，不承诺自动读写或发布                                  |

## 当前能力矩阵

| 平台 / 能力                   | 当前状态        | 已完成证据                                                                                                 | 待联调条件                                                                                                     |
| ----------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Facebook Messenger 入站消息   | `conditional`   | 官方结构 fixture、HMAC-SHA256 验签、challenge、时间戳、幂等、限流 port、文本消息归一化和 echo 过滤契约测试 | Meta App、Page、Webhook 订阅、所需权限 / App Review、staging；数据库侧等待 Task 9 `Conversations` / `Messages` |
| Instagram DM 入站消息         | `conditional`   | 官方结构 fixture 和图片附件归一化契约测试；不下载 fixture 中的外部 URL                                     | Instagram 专业账号、Facebook Page 绑定、Meta App 权限 / App Review、staging；数据库侧等待 Task 9               |
| WhatsApp Cloud API 入站消息   | `conditional`   | 官方结构 fixture、联系人名称、文本消息、账号 / 发件人 / 收件人 ID 归一化契约测试                           | Meta Business、WABA、合规号码、App 权限、Webhook 订阅和 staging；数据库侧等待 Task 9                           |
| WhatsApp 发送状态回调         | `conditional`   | `sent / delivered / read / failed` 状态类型、转移级 external event ID 和 delivery fixture 契约测试         | 真实发送资产和 staging；作为会话消息送达状态，持久化侧等待 Task 9 `Messages`                                   |
| Facebook / Instagram 图文发布 | `blocked`       | 本轮纯逻辑不提前假设 Task 12 字段，未实现发布 adapter                                                      | 等待 Task 12 `PublishJobs` / `PublishLogs`，以及 Meta Page / Instagram Content Publishing 权限和 staging       |
| LinkedIn 发布                 | `blocked`       | 已锁定“API 可用则自动，否则格式化、素材打包、复制文案和人工发布”降级口径                                   | 等待 Task 12 内容契约和甲方 LinkedIn 应用 / 发布权限证据                                                       |
| TikTok 私信 / 发布            | `research-only` | 需求和实施计划明确不作为一期自动化必达项                                                                   | 甲方商业账号、目标地区能力和官方开放接口证据                                                                   |

## 接口 / 纯逻辑阶段证据

- 实现统一归一化事件、connector、原子 `enqueue` 幂等 repository port、Webhook rate limiter port、conversation writer port 和 message-status writer port。WhatsApp 消息送达状态与 Task 12 社媒内容发布状态保持独立。
- 验签使用原始请求字节与 `X-Hub-Signature-256` HMAC-SHA256；不记录 app secret、verify token 或平台 token。
- 事件时间戳默认允许十分钟窗口，请求体默认限制 1MB；限流实现由后续 API route / 部署 adapter 注入。
- 本地验证：平台专项 unit 9/9、Meta / WhatsApp contract 8/8、累计 unit 38/38、lint、typecheck 和 production build 通过。
- 测试全部使用合成 ID、fixture 和 fake repository，不访问真实平台网络。

## 数据库集成阻塞

- Task 9 `Conversations` / `Messages` 尚未合并：不创建临时会话 Collection，不提供伪生产持久化。
- Task 12 `PublishJobs` / `PublishLogs` 尚未合并：不创建临时发布 Collection 或替代 migration。
- 上游合并后，必须先 `git fetch origin` 并从最新 `origin/main` 更新 Task 13 基线，再实现 Payload / PostgreSQL adapter 与 integration test。

## 外部资产清单

开始 staging 联调前需甲方提供或确认：

- Meta Business、App ID、App Secret 的 staging secret 注入方式；
- Facebook Page、Instagram 专业账号及绑定关系；
- WABA、测试号码 / 正式号码、phone number ID；
- Webhook callback 域名、verify token 和对应订阅字段；
- 已申请权限、App Review 状态与平台阻塞截图 / 工单；
- staging 与 production 独立的 token、账号和 Webhook 配置。

所有真实 secret 只进入部署环境，不写入本记录、代码、fixture、日志或 PR。
