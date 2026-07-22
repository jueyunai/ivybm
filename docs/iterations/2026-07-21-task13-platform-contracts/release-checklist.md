# Task 13 平台契约迭代：发布检查表

- [x] 范围内无 WhatsApp connector / fixture / 测试。
- [x] 不修改共享 Collection、migration、Payload 注册或生成类型。
- [x] unit 与 contract 测试不调用真实平台网络。
- [x] Meta durable inbound 以 Jobs inbox、worker lease fence 和 Task 9 权威会话服务持久化；worker 死亡后 lease 重领不会重复写入。
- [x] provider attachment URL 不保留 query、fragment 或 userinfo；不下载附件。
- [x] Meta delivery/read callback 不进入当前 Jobs 链路，避免没有 adapter 的状态事件重试至 dead。
- [x] TikTok 官方 schema 缺失明确标记 blocked。
- [x] Task 12 缺失明确标记 blocked。
- [x] 真实 Meta webhook route、账号授权和受控联调仍明确标记 blocked / conditional。
- [x] lint、typecheck、unit、contract、integration、migration lifecycle、双次 seed、build 通过。
- [ ] Meta durable inbound 后续改动待 jueyunai 跨人 review；共享会话 contract 与 worker 集成不适用作者自检合并。
- [x] fixture / mock 结果未标记为真实平台 available。
