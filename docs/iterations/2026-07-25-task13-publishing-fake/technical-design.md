# Task 13 可复用发布 Fake：技术设计

## 模块边界

新增 `src/modules/platforms/fakePublishingPort.ts`，导出 factory 与仅用于 mock 的控制面。它实现既有 `PlatformPublishingPort`，不注册到 Payload、worker 或公开路由。

## 内存模型

- command key：`platform + idempotencyKey`。
- fingerprint：递归、对象 key 排序的稳定序列化；数组顺序保留，因为素材顺序可能有发布语义。
- accepted record：稳定 `mock:<platform>:<idempotencyKey>` 关联 ID 与初始 `pending` 状态。
- 状态：`pending → publishing → published`，或 provider 已立即完成时 `pending → published`；`pending|publishing → failed`。终态不允许回退，`failed → failed` 只允许完全相同的幂等重放，不能替换失败元数据。
- `failNextPublish` 只影响尚未 accepted 的下一条自动发布命令，返回现有判别式 `blocked` 响应，不创建关联 ID。
- factory、`publish`、`getCapability`、状态读取和 test control 在 runtime 检查平台、字段和 capability override；未知平台或畸形 typed escape 以稳定 fake error 拒绝，不会因 map lookup、`.trim()` 或 `.includes()` 产生无语义的 `TypeError`。

## 平台默认能力

- Facebook / Instagram：`conditional + automatic`，仅表示 fake 可以模拟，绝不表示真实平台可用。
- LinkedIn：`conditional + assisted`；`publish()` 返回 `platform_blocked`，调用方应使用既有 assisted export。

## 回滚

本迭代没有 migration、数据库或网络副作用；回滚只需回退 fake 模块、测试和迭代记录。
