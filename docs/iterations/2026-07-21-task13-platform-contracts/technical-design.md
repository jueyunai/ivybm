# Task 13 平台契约迭代：技术设计

## 边界

`src/modules/platforms` 不导入 Payload，不读取环境变量，不调用外部网络。平台 route、数据库 adapter、Jobs handler 在后续依赖满足后实现。

## 核心模型

- `MessagingPlatform`: `facebook-messenger | instagram | tiktok`
- `PublishingPlatform`: `facebook | instagram | linkedin`
- `PlatformAvailability`: `available | conditional | blocked`
- 入站事件、消息送达状态、发布结果为独立联合类型。

## Webhook 流程

1. 检查原始 body 字节数和 JSON content type。
2. 对原始字节执行平台专属 verifier；Meta 使用 `X-Hub-Signature-256` HMAC-SHA256。
3. 解析并由 connector 归一化。
4. 校验事件时间窗和稳定 idempotency key。
5. 对 raw body 计算 SHA-256 摘要用于审计，对规范化单事件计算稳定摘要用于幂等冲突判断。
6. fake/event repository 以批次原子返回 `accepted | duplicate | conflict`，同一事件键语义不变时允许外层批次变化，语义冲突时整批不写入。
7. conflict 转换为稳定 `idempotency_conflict` 错误，不执行下游副作用。

## 发布 contract

- capability 返回平台、状态、模式、限制和阻塞原因。
- publish/status port 只描述请求响应，不绑定 Task 12 Collection。
- LinkedIn 无 API 权限时生成 assisted export：文案、素材清单、操作说明。
- Facebook / Instagram 自动发布只冻结接口，不实现网络 adapter；LinkedIn assisted export 只返回内存清单，不写文件系统。

## 安全

- 验签只使用 raw bytes，常量时间比较。
- 调用方必须把未解码的 `Uint8Array` / `Buffer` 原始请求体交给 ingest contract；业务限流只在验签通过后计数。
- 错误不包含 app secret、token 或原始 payload。
- fixtures 只含合成 ID、文本、URL 和时间戳。
- 不把客户端字段作为凭据或内部主键。

## 回滚

本迭代无 migration 和外部副作用；回滚只需回退模块与测试提交。
