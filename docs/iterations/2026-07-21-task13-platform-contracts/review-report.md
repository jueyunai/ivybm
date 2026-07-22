# Task 13 平台契约迭代：Review 报告

## Reviewer

- 独立 Codex QA Agent：范围、验收矩阵、共享结构边界和测试证据复核。
- Claude Code：两轮只读 correctness / security / regression 审查。
- Codex controller：最终 diff、命令执行与问题处置。

## 第一轮 findings 与处置

| Finding                                                     | 级别     | 处置                                                                                                                                              |
| ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 整个 raw body digest 绑定到单事件幂等键，批次重组可能误冲突 | P2       | 同时保存 raw body 摘要用于审计，改用规范化单事件稳定摘要判断 duplicate/conflict；新增外层 envelope 改变仍 duplicate、语义改变整批 conflict 测试。 |
| 业务限流在验签前计数，伪造请求可能消耗合法预算              | P2       | 调整为 body/content-type 预检后先验签，再消费业务限流；新增验签失败不调用 limiter 断言。                                                          |
| 空 externalEventId 可能抛裸 Error                           | P3       | 映射为稳定 `invalid_payload` 并补测试。                                                                                                           |
| ingest 接受 string raw body，存在重编码歧义                 | P3       | ingest contract 收紧为 `Uint8Array`；Meta helper 仍可独立测试 string/bytes。                                                                      |
| 合法空事件批次缺少覆盖                                      | Test gap | 新增 0 accepted / 0 duplicate / 0 side effect 测试。                                                                                              |

## 复审结论

- Codex QA：未发现 P0/P1，确认 WhatsApp 清理、TikTok blocked、Meta 契约、发布 port、LinkedIn assisted export 和共享结构边界符合要求。
- Claude Code 第二轮：上述 5 项全部解决；P0=0、P1=0，建议 Approve。最后一处 `rawBodyBytes` 冗余表达式已同步清理。
- Reviewer 均为只读；所有测试和构建由 Codex controller 在最终工作树执行。

## 最终建议

Task 13 纯接口 / fixture / mock 阶段达到 GO。由于 `ports.ts` / `types.ts` 是 Task 12 将消费的跨人公共发布契约，PR 合并前仍必须请求 jueyunai review；真实平台联调和数据库 adapter 不在本次完成声明内。

## 2026-07-22 Meta durable inbound 复审

| Finding | 级别 | 处置 |
| --- | --- | --- |
| 首条 Meta 入站因未配置出站能力进入 `handoff_requested` 后，同一发送者的下一条不同消息被 visitor action guard 拒绝，worker 会重试至 dead | P1 | `externalInbound` 仅对已验签的 connector command 放宽“记录客户消息”边界；AI 回复、评分、状态转换和重复接管保持关闭。新增 unit、contract 和真实 PostgreSQL integration 回归，覆盖 `handoff_requested`、`resolved`、worker lease reclaim 与 fake/real contract 一致性。 |
| provider attachment URL 的 query / fragment 可能包含短期签名并被保存在 Job payload | P2 | connector 和 job parser 统一只保留 HTTPS origin/path，拒绝 userinfo / 非 HTTPS；不下载附件。 |
| resolved 会话目前继续保留后续外部消息，而不是自动创建新会话 | P2 / 产品策略 | 记录消息优先于静默丢失；新会话 rollover / archive 策略待 Task 9 运营规则确认，不在无授权的 Task 13 connector 内猜测。 |

Claude Code 对 P1 修复做了第二次只读复审，结论为 **Approve**：无未解决 P0/P1。`jueyunai` 仍须对跨人会话 contract 和 worker 集成完成 GitHub review。
