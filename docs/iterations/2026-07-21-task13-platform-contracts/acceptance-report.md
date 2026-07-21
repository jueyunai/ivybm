# Task 13 平台契约迭代：验收报告

## 当前能力矩阵

| 能力                    | 当前结果             | 证据                                                  | 真实联调门槛                                                        |
| ----------------------- | -------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| Facebook Messenger 入站 | mocked / conditional | Meta connector、合成 fixture、契约测试                | Meta 企业资产、App Review、Webhook、受控真实环境                    |
| Instagram DM 入站       | mocked / conditional | Meta connector、合成 fixture、契约测试                | IG 商业账号、Page 绑定、权限审核、受控真实环境                      |
| TikTok 私信入站         | blocked              | 仅冻结 `tiktok` 类型与阻塞记录；未伪造 schema/fixture | 官方私信事件 schema、目标地区能力、商业账号、channel 前向 migration |
| Facebook 图文发布       | mocked / conditional | capability/publish/status TypeScript port             | Task 12 PublishJobs/PublishLogs、Meta 权限、真实 adapter            |
| Instagram 图文发布      | mocked / conditional | capability/publish/status TypeScript port             | Task 12 PublishJobs/PublishLogs、IG 发布权限、真实 adapter          |
| LinkedIn 图文发布       | mocked / conditional | assisted export 返回文案、素材 manifest、人工步骤     | Task 12 发布结构；自动发布另需 LinkedIn API 权限                    |
| WhatsApp                | phase-2 / excluded   | 一期 connector、fixture、测试已删除                   | 二期另行评估                                                        |

## 已通过项

- raw-body Meta HMAC、challenge、JSON content type、body 大小、过去/未来时间窗与 rate limit 失败测试。
- 相同事件键 + 相同规范化事件语义为 duplicate，即使外层 raw envelope 改变也不误冲突；相同事件键 + 不同事件摘要为 `idempotency_conflict`，批次不部分写入。
- Messenger / Instagram payload 归一化不抓取附件 URL。
- 消息送达状态与发布状态使用不同类型和 port。
- 消息送达状态目前只冻结内部类型与 dispatch port，尚无真实平台 status connector；不计为真实回调已完成。
- LinkedIn assisted export 不调用网络、不写文件系统，输出确定性排序。
- 未修改共享 Collection、migration、Payload 注册或生成类型。

## QA 与 release 结论

- lint、typecheck、unit 137/137、contract 24/24、integration 74/74、migration reset/reapply、双次 seed 和 production build 全部通过。
- 独立 Codex QA 与 Claude Code 复审均无未解决 P0/P1。
- 本次纯 contract 迭代：**GO**。
- 真实 Meta / TikTok / LinkedIn 平台可用性：仍为 **conditional / blocked**；没有账号授权和受控实测前不得标记 `available`。
- 发布数据库 adapter：等待 Task 12 `PublishJobs` / `PublishLogs` 完整合并；TikTok connector：等待官方 schema 和会话 channel 前向 migration。
