# Task 13 发布 Mock 契约加固：技术设计

## 契约语义

`externalPublicationId` 是 adapter 产生的稳定关联句柄，通常对应平台的 publication 或异步 job ID；若平台只能按其它稳定关联值查询，adapter 可以提供该可查询值。它绝不是 Task 12 的数据库主键。

`PlatformPublishingPort.publish()` 的 accepted 分支返回该句柄；`getStatus()` 接收并回显同一值。这样 Task 12 将来持久化任务时有明确的跨调用关联，而不需要先猜测 Task 12 表结构。

幂等键的作用域是 `platform + idempotencyKey`：同一平台同键同请求返回同一 accepted 结果；同键而内容不同是调用方错误，mock 返回不可重试的 `invalid_request`。不同发布平台可以使用同一个业务命令键，各自拥有独立关联句柄。

## Mock 边界

本迭代只在契约测试中使用确定性内存 fake：`mock:<platform>:<idempotencyKey>`。它用于验证 API 闭环和同进程幂等冲突，不代表 provider API 的真实 ID 格式，也不实现数据库级并发、重试或回调。

## 风险与回滚

这是共享 TypeScript 接口变更，需 jueyunai review。若回滚，只需回退类型和契约测试；本迭代没有 migration、外部副作用或数据回滚步骤。
