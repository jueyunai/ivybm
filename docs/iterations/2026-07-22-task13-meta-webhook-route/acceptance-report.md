# Task 13 Meta Webhook Route：验收报告

| 能力 | 当前结果 | 证据 | 真实联调门槛 |
| --- | --- | --- | --- |
| Meta subscription challenge | code complete | unit 通过 | Meta App verify token、HTTPS callback |
| Messenger / Instagram 入站 ingress | durable / conditional | raw-HMAC → Jobs PostgreSQL integration | Page / IG business binding、权限、App Review、真实 secret |
| Worker / 会话交付 | 已由 PR #30 提供 | Task 10 Job + Task 9 adapter integration | 受控真实消息验证 |
| Meta 出站 / status callback | blocked | 未实现 | 授权、产品规则、adapter |
| TikTok 私信 | blocked | 无猜测 schema | 官方 API / 地区 / 审核 |
| 发布侧 | blocked | Task 12 结构尚未合并 | PublishJobs / PublishLogs + 平台权限 |

结论：拒绝路径不初始化 Payload / DB 的 P1 已修复；完整本地门禁通过，代码层入口达到本地验收。平台状态仍为 `conditional`，不可标记为 `available`。
