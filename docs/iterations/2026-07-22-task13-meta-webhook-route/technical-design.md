# Task 13 Meta Webhook Route：技术设计

## 请求链路

```text
Meta GET/POST
  → /api/webhooks/meta (Node runtime, no-store)
  → raw-byte size cap / challenge / HMAC
  → createMetaConnector + ingestSignedWebhook
  → PayloadPlatformEventRepository
  → Jobs(type=platform.event.dispatch)
  → existing worker + Task 9 authoritative ConversationService
```

## 配置与安全

- `META_WEBHOOK_APP_SECRET`、`META_WEBHOOK_VERIFY_TOKEN` 与逗号分隔的 `META_WEBHOOK_ALLOWED_ACCOUNT_IDS` 只由部署端注入；POST 要求三项同时存在，否则返回脱敏 `503`。GET challenge 只在 secret 与 verify token 已配置时通过。
- POST 以 raw bytes 做 HMAC，不先 JSON decode；body 限制为 1 MiB。
- Meta Graph Webhooks 对失败投递会在后续 36 小时内重试；route 接受 48 小时以内的已验签事件，为平台重投、时钟与队列留余量。重复事件由 Jobs inbox 幂等键安全去重。
- 先验证签名、规范化、时间窗与 allowlist，再按 `platform + accountExternalId` 使用内存限流桶；不信任可伪造客户端 IP header，也不让一个已授权账号耗尽其他账号的固定额度。
- Payload repository 是 lazy source：错误 content type、错误 HMAC、时间窗、allowlist、限流或规范化失败不会初始化 Payload / 连接数据库。
- 错误统一为稳定 code；仅 `rate_limited` 返回固定 `Retry-After: 60`。
- 不下载附件，不打印 body、token、secret 或内部数据库异常。

## HTTP 映射

| 情形 | 状态 |
| --- | ---: |
| challenge 成功 / event accepted / duplicate | 200 |
| 无效签名 | 401 |
| 无效 challenge / 未授权 Meta 账号 | 403 |
| content、payload、时间窗错误 | 400 |
| body 太大 | 413 |
| rate limit | 429 |
| 同事件键的语义冲突 | 409 |
| 未配置或运行时持久化异常 | 503 |

## 回滚

本迭代无 migration、无真实平台副作用。回滚仅移除 route / handler；未处理的 Job 仍由现有 worker 的 retry / dead 策略管理。
