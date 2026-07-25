# Task 13 可复用发布 Fake：复盘

## 无账号阶段可以证明的事

- 调用方可使用稳定的 `PlatformPublishingPort`、能力状态、关联 ID、幂等和失败语义完成 UI / contract 开发。
- fake 的 provider failure、状态推进和跨平台 key 隔离可用确定性 fixture 回归，不需要 token、网络或付费 API。

## 不能证明的事

- 内存 map 不能代替 `PublishJobs` / `PublishLogs` 的事务、数据库唯一约束或 provider 已接受后进程死亡的恢复。
- `conditional` 不等于 Meta 发布许可、LinkedIn API 权限、真实 webhook、回调或账号审核已经通过。

## 后续动作

Task 12 合并 `PublishJobs` / `PublishLogs` 后，先从最新 `origin/main` 更新分支；Task 10 worker 和外部账号条件同时满足后，才为真实 adapter 增加数据库事务、outbox / worker lease、provider accepted 后崩溃、回调幂等和人工重试的失败注入测试。
