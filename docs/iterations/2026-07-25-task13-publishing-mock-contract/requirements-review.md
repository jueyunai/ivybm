# Task 13 发布 Mock 契约加固：需求复核

## 目标

在 Task 12 内容工作台尚未开始、`PublishJobs` / `PublishLogs` 尚未存在时，冻结可供其 mock 消费的发布 port。一次被接受的发布必须返回一个可用于后续状态查询的稳定关联标识。

## 范围

- 为 `PlatformPublishAcceptance` 的 `accepted` 分支增加必填 `externalPublicationId`。
- 要求 `PlatformPublicationStatus` 回显同一标识。
- 用内存 fake 契约验证同一平台中的同一幂等键得到同一标识，并把该标识传给 `getStatus`。
- 同一平台 + 幂等键若携带不同请求内容，返回不可重试的 `invalid_request`，不得静默重用旧发布。

## 非目标与依赖

- 不创建或猜测 `PublishJobs`、`PublishLogs`、Collection、migration、Payload 配置或数据库字段。
- 不调用 Facebook、Instagram、LinkedIn、TikTok 的网络、SDK 或账号 token。
- 真实发布、回调、重试、持久化幂等与 worker 恢复仍分别等待 Task 12、Task 10 和平台授权。

## 验收标准

1. `publish()` 的 accepted 结果可直接作为 `getStatus()` 的查询关联。
2. blocked 结果不伪造外部发布关联。
3. TypeScript 类型禁止 status 结果遗漏关联标识。
4. mock / fixture 测试明确通过不代表真实平台可用。
