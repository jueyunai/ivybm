# Task 13 Meta Webhook Route：复盘

- 已把“纯验签逻辑通过”与“真实 HTTP ingress / durable inbox”拆开验收，避免 fixture 成功被误写为平台可用。
- Post-merge 审计中的多个 P1 线索经 migration、调用链和现有测试核验后均不成立；未来审查必须先查真实 migration `.ts`，不能只看最新 snapshot。
- 外部 MiniMax 实现会话未形成完成报告或可验收 diff；后续仅把更小、单文件、可在一次测试内验证的任务交给它，并保留 controller fallback。
- Claude 长审查无可用输出时，按既定规则切换独立只读子代理；不能把“工具曾被调用”写成已完成 review。
- 独立 reviewer 发现 object literal 的 eager evaluation 会绕过“先验签再连接数据库”的设计。今后 Webhook / queue 依赖必须在失败注入测试中断言拒绝路径的 provider / repository 调用次数为零。
