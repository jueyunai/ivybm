# Task 13 平台契约迭代：需求复核

## 当前范围

- 入站会话：Facebook Messenger、Instagram DM、TikTok 私信。
- 图文发布：Facebook、Instagram、LinkedIn。
- 本迭代只实现纯 TypeScript contract、Webhook 验签/时间戳/幂等、payload 归一化、fixture 与 fake repository。
- WhatsApp 为二期范围，不创建 connector、fixture、测试或新写入路径。

## 非目标

- 不创建或修改 Conversations、Messages、PublishJobs、PublishLogs、PlatformAccounts。
- 不生成 migration，不修改 `src/payload.config.ts` 或 `src/payload-types.ts`。
- 不调用真实平台网络，不保存或读取平台 token。
- 不把 fixture/mock 通过标记为平台 available。

## 依赖状态

| 能力                            | 状态      | 说明                                                                  |
| ------------------------------- | --------- | --------------------------------------------------------------------- |
| Task 9 Conversations/Messages   | available | Collection、migration、注册和类型已合并；本迭代仍不写数据库 adapter。 |
| Task 10 Jobs/worker             | available | 真实 Webhook 异步 handler 尚未实现。                                  |
| Task 12 PublishJobs/PublishLogs | blocked   | main 中不存在，禁止临时替代。                                         |
| Meta/TikTok/LinkedIn 账号授权   | blocked   | 无账号、审核和受控联调窗口。                                          |
| TikTok 私信官方事件 schema      | blocked   | 仓库和可访问官方资料不足，不猜测字段。                                |

## 验收标准

- 范围内平台枚举不包含 WhatsApp。
- Meta raw body HMAC、challenge、时间窗、body 大小、content type 和事件幂等均有失败测试。
- 同一 `platform + externalEventId` 的规范化事件语义相同为 duplicate；语义摘要不同为 conflict，外层批次重组不产生误冲突。
- Messenger 与 Instagram 官方结构 fixture 可归一化，不发起网络请求。
- 发布 contract 区分 capability、自动发布与 assisted delivery，并将消息状态和发布状态分开。
- LinkedIn assisted export 产出稳定文案和素材清单，不写文件系统。
- TikTok 保留阻塞记录，不以伪造 fixture 冒充 contract 完成。
