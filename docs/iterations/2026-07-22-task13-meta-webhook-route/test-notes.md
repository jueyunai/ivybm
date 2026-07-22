# Task 13 Meta Webhook Route：测试记录

本迭代只使用 fake secret、合成 Meta payload 和独立 PostgreSQL 18.4 + pgvector 0.8.5；没有请求真实 Meta、TikTok、LinkedIn 或付费 AI API。

```text
pnpm exec vitest run --config ./vitest.config.mts tests/unit/platforms/meta-http.test.ts tests/unit/platforms/webhook.test.ts
  22/22 passed

DATABASE_URL=...ivybm_route_test pnpm db:migrate
  fresh migration passed

DATABASE_URL=...ivybm_route_test pnpm exec vitest run --config ./vitest.integration.config.mts tests/integration/platforms/meta-webhook-route.test.ts
  1/1 passed

pnpm typecheck
pnpm lint
  passed
```

修复 P1 后重新执行的完整质量门禁：

```text
pnpm install --frozen-lockfile                              passed
pnpm lint                                                   passed
pnpm typecheck                                              passed
pnpm test:unit                                              passed
pnpm test:contract                                          35/35 passed
fresh migration + pnpm db:seed + pnpm db:seed               passed, idempotent
pnpm test:integration                                       passed
pnpm test:operations                                        25/25 passed
pnpm build (isolated DB + non-secret placeholders)          passed
git diff --check                                            passed
```

独立审查发现 route 在调用 `ingestSignedWebhook` 前先求值 repository，伪造签名也会触发 Payload / DB 初始化。回归测试注入 `payloadProvider` spy，断言错误签名、限流、未授权账号和 stale 事件路径调用次数为零；合法事件断言 lazy repository factory 恰好调用一次。repository 改为在既有 verifier、时间窗、allowlist、按账号限流与 normalize 全部通过后才解析。

PR #31 复审后新增回归：

- production / staging Compose 均把 Meta secret、verify token 和 allowlist 只传给 app；migration / worker 不接收。
- production preflight 允许三项 Meta 配置均未设置，但一旦启用就拒绝半配置或空 allowlist。
- Meta 失败投递在 36 小时后重试时，仍会进入同一 Jobs inbox 且第二次为 duplicate；route 为官方 36 小时重投保留 48 小时验签时窗。
- 未在 `META_WEBHOOK_ALLOWED_ACCOUNT_IDS` 中的已验签账号返回稳定 403，不初始化 Payload / DB；限流键按 `platform + accountExternalId` 隔离。
