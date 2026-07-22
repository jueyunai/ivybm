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

- `META_WEBHOOK_APP_SECRET` 与 `META_WEBHOOK_VERIFY_TOKEN` 只由部署端注入；两者任一缺失时 route 返回脱敏 `503`。
- POST 以 raw bytes 做 HMAC，不先 JSON decode；body 限制为 1 MiB。
- 签名成功后才进入固定的内存限流桶 `meta-webhook`；不信任可伪造客户端 IP header。
- Payload repository 是 lazy source：错误 content type、错误 HMAC、时间窗、限流或规范化失败不会初始化 Payload / 连接数据库。
- 错误统一为稳定 code；仅 `rate_limited` 返回固定 `Retry-After: 60`。
- 不下载附件，不打印 body、token、secret 或内部数据库异常。

## HTTP 映射

| 情形 | 状态 |
| --- | ---: |
| challenge 成功 / event accepted / duplicate | 200 |
| 无效签名 | 401 |
| 无效 challenge | 403 |
| content、payload、时间窗错误 | 400 |
| body 太大 | 413 |
| rate limit | 429 |
| 同事件键的语义冲突 | 409 |
| 未配置或运行时持久化异常 | 503 |

## 回滚

本迭代无 migration、无真实平台副作用。回滚仅移除 route / handler；未处理的 Job 仍由现有 worker 的 retry / dead 策略管理。
