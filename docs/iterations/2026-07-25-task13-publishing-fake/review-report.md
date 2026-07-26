# Task 13 可复用发布 Fake：审查报告

## 预设不变量

1. 每个 accepted fake 命令都有可查询的稳定关联 ID；blocked 命令没有 ID。
2. 任意重复或并发的相同命令不产生第二个 fake publication。
3. 状态不会从 terminal 回退；错误状态必须保留 error code 与 retryable。
4. TikTok 不因 TypeScript union 存在而被假装已接入。
5. 没有账号的 `conditional` capability 不能生成 accepted ID 或 published 状态；成功模拟必须是显式 `available` 测试配置。
6. LinkedIn 降级包只包含调用方提供的授权素材字节，不能下载或持久化带临时签名的 URL。

## 独立审查结论

两轮独立只读审查未发现 P0 / P1。审查沿 `publish → accepted / blocked → getStatus / setStatus`、平台作用域、幂等键与失败注入的时序追踪，而不是只看 green CI。

已在合入前关闭的回归缺口：

- 技术设计与实现都允许 provider 立即完成，因此明确并测试 `pending → published`；其余 terminal 状态不得回退。
- `failed → failed` 仅允许完全相同的幂等重放，不能替换 `errorCode` 或 `retryable`。
- fingerprint 忽略 optional `undefined`，让显式 `undefined` 和省略字段保持同一命令语义，同时保留素材数组顺序。
- 已 accepted 的重复命令在到达 provider 逻辑前返回稳定结果，不能消耗 `failNextPublish` 队列；下一条新的自动发布命令才消费该失败注入。
- factory、`publish`、`getCapability`、状态读取和 test control 在 runtime 检查未知平台、畸形 typed escape 与 capability override，返回稳定 fake error，而不是泄漏 map lookup / `.trim()` / `.includes()` 的运行时异常。
- 默认 `conditional + automatic` 曾错误返回 accepted；现已用失败注入回归固定为 `account_not_connected`，并将所有成功模拟改为显式 `available + automatic` override。
- LinkedIn assisted export 曾只有清单；现已增加确定性 ZIP bytes（README、文案、manifest、素材），且测试确认 manifest 不携带临时 URL query、路径穿越和重复文件名均被拒绝。

## 残余边界

- 内存 fake 不证明数据库级并发幂等、provider 已接受后进程死亡、回调去重、worker lease/retry 或人工补偿。
- Facebook / Instagram 仍只为 `conditional`；LinkedIn 仍只提供 assisted export。真实 adapter 还等待 Task 12 的 `PublishJobs` / `PublishLogs`、Task 10 的 worker 条件和平台账号授权。
- TikTok 图文发布不在一期；TikTok 私信官方 schema / 账号条件仍未满足，不能因 TypeScript union 而伪造接入。
