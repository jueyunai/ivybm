# Task 13 发布 Mock 契约加固：复盘

## 已沉淀的做法

- 对异步 port 先沿 `accepted → query/status → retry/reconcile` 推演，不能只验证单次成功响应。
- mock 也要把跨调用关联和幂等语义写成契约测试，避免前端用硬编码 fixture ID 掩盖接口缺口。
- 依赖未合并时只冻结 TypeScript contract；不要以临时表、migration 或伪 provider schema 代替上游设计。

## 后续动作

Task 12 合并 `PublishJobs` / `PublishLogs` 后，补真实 adapter 的数据库事务、provider accepted 后进程死亡、lease reclaim、状态回调和人工重试故障注入测试。

隔离集成门禁应始终按 `migration → reset → seed（两次）→ integration` 顺序运行；reset 后直接运行 `seed-media` 会因其刻意断言的展示素材前置为空而失败，不应误判为发布 contract 回归。
