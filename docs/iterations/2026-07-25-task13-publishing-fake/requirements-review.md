# Task 13 可复用发布 Fake：需求复核

## 目标

在 Task 12 内容工作台和真实平台账号尚未就绪时，提供一个无凭据、无网络的内存 `PlatformPublishingPort` fake，供内容工作台和平台契约测试模拟发布能力、幂等、状态推进及可重试失败。

## 范围

- Facebook / Instagram：默认 `conditional + automatic` 仅声明将来可支持的模式；无账号 fake 必须 fail closed 为 `account_not_connected`。仅显式 test override 为 `available + automatic` 时，才可模拟 accepted、pending、publishing、published、failed 与提交时 provider failure。
- LinkedIn：默认 `conditional + assisted`，自动 `publish()` 必须稳定拒绝；既有 assisted export 与新增的纯函数 ZIP package 负责人工降级。ZIP 只封装调用方已授权提供的字节，绝不下载 URL 或调用平台网络。
- 幂等：以 `platform + idempotencyKey` 作用域；同一规范化请求返回同一 accepted 结果，内容变化 fail-closed 为不可重试 `invalid_request`。
- fake 控制面仅用于测试 / mock：受控状态推进和下一次 provider failure 注入。

## 非目标与依赖

- 不实现 Facebook / Instagram / LinkedIn 真实 SDK、token、HTTP 调用、结果回调或账号授权。
- 不创建 `PublishJobs`、`PublishLogs`、Collection、migration 或 Payload 配置；真实 adapter 等待 Task 12 结构及账号条件。
- TikTok 私信官方 schema 尚未取得；不伪造 connector、fixture 或 channel migration。TikTok 图文发布不属于一期。

## 验收标准

1. fake 满足既有 `PlatformPublishingPort`，不改变其接口。
2. 不同平台同 key 隔离；同平台重复与冲突都确定性、无外部副作用。
3. 无效状态回退、未知 ID / 平台不匹配不能伪装成成功。
4. 单元与 contract 测试不访问网络、文件系统、数据库或凭据；LinkedIn package 是内存字节结果，由后续 UI / 受保护路由决定如何下载。
