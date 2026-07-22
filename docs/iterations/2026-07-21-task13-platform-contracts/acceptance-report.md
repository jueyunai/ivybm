# Task 13 平台契约迭代：验收报告

## 当前能力矩阵

| 能力                    | 当前结果             | 证据                                                  | 真实联调门槛                                                        |
| ----------------------- | -------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| Facebook Messenger 入站 | durable / conditional | Meta connector、合成 fixture、Jobs inbox、worker handler、Task 9 会话 adapter、集成测试 | Meta 企业资产、App Review、公网 Webhook route、受控真实环境 |
| Instagram DM 入站       | durable / conditional | Meta connector、合成 fixture、Jobs inbox、worker handler、Task 9 会话 adapter、集成测试 | IG 商业账号、Page 绑定、权限审核、公网 Webhook route、受控真实环境 |
| TikTok 私信入站         | blocked              | 仅冻结 `tiktok` 类型与阻塞记录；未伪造 schema/fixture | 官方私信事件 schema、目标地区能力、商业账号、channel 前向 migration |
| Facebook 图文发布       | mocked / conditional | capability/publish/status TypeScript port             | Task 12 PublishJobs/PublishLogs、Meta 权限、真实 adapter            |
| Instagram 图文发布      | mocked / conditional | capability/publish/status TypeScript port             | Task 12 PublishJobs/PublishLogs、IG 发布权限、真实 adapter          |
| LinkedIn 图文发布       | mocked / conditional | assisted export 返回文案、素材 manifest、人工步骤     | Task 12 发布结构；自动发布另需 LinkedIn API 权限                    |
| WhatsApp                | phase-2 / excluded   | 一期 connector、fixture、测试已删除                   | 二期另行评估                                                        |

## 已通过项

- raw-body Meta HMAC、challenge、JSON content type、body 大小、过去/未来时间窗与 rate limit 失败测试。
- 相同事件键 + 相同规范化事件语义为 duplicate，即使外层 raw envelope 改变也不误冲突；相同事件键 + 不同事件摘要为 `idempotency_conflict`，批次不部分写入。
- Messenger / Instagram payload 归一化不抓取附件 URL，且不持久化 URL query、fragment 或 userinfo。
- 规范化 Meta 入站事件先以 `Jobs` 的 `(type, idempotencyKey)` 原子唯一键落库，再由 worker 调用 Task 9 的权威会话服务；已覆盖 worker 在业务提交后死亡、lease 重领后无重复消息的恢复场景。
- 消息送达状态与发布状态使用不同类型和 port。Meta delivery/read callback 当前明确忽略，不会进入 Jobs；`message-status` 仍是未来 adapter 的内部类型，不计为真实回调已完成。
- LinkedIn assisted export 不调用网络、不写文件系统，输出确定性排序。
- 未修改共享 Collection、migration、Payload 注册或生成类型；会话 adapter 只消费 Task 9 的服务端 contract，公共 contract 变更仍需 jueyunai review。

## QA 与 release 结论

- lint、typecheck、unit 154/154、contract 35/35、integration 90/90、operations 23/23、完整 migration reset/reapply、双次 seed、production build 和 `git diff --check` 全部通过。
- 本次 Meta durable inbound 增量：**本地 GO，待 jueyunai 跨人 review**。
- 真实 Meta / TikTok / LinkedIn 平台可用性：仍为 **conditional / blocked**；没有账号授权和受控实测前不得标记 `available`。
- 发布数据库 adapter：等待 Task 12 `PublishJobs` / `PublishLogs` 完整合并；TikTok connector：等待官方 schema 和会话 channel 前向 migration。

## 2026-07-22 复验补充

- 同步最新主线后，发布 contract 增加冻结的机器可读错误码与 `blocked / failed` retryable 语义；投递 port 明确后续 adapter 必须按平台事件 `idempotencyKey` 持久去重并报告 `accepted / duplicate`。
- 独立 PostgreSQL 18.4 + pgvector 0.8.5 复验通过 fresh migrate、完整 reset/reapply 和双次 seed；通过 unit 145/145、contract 29/29、integration 86/86、operations 23/23、lint、typecheck、production build 和 `git diff --check`。
- 三路只读故障模型复核后补齐附件 URL 最小化、worker 死亡后 lease 重领回归和状态 callback 的明确不接入边界；实际 PostgreSQL 已确认 Task 9 的 `(scope, idempotencyKey)` 唯一索引存在，无需新增替代 migration。
- Claude Code 独立复审发现并复核了“首条 Meta 消息触发接管后，第二条不同消息会被拒绝”的 P1：现已用 `externalInbound` 的 record-only 路径修复，后续消息在 `handoff_requested` / `resolved` 中仍持久化，但不会重启 AI 或重复接管；复审结论为 Approve。真实账号、Webhook route、Task 12 发布数据库 adapter 和 TikTok 官方 schema 仍是明确 blocked 依赖。
