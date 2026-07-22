# Task 13 平台契约迭代：测试记录

## TDD 记录

先改写一期平台测试并删除 WhatsApp 契约，首次运行按预期失败：缺少通用 verifier、content type、future timestamp、digest conflict、发布 port 与 LinkedIn assisted export。

实现后的专项结果：

```text
pnpm exec vitest run --config ./vitest.config.mts tests/unit/platforms
2 files, 13 tests passed

pnpm exec vitest run --config ./vitest.contract.config.mts tests/contract/platforms
2 files, 7 tests passed
```

## 最终质量门禁

```text
pnpm install --frozen-lockfile                         passed
pnpm lint                                               passed
pnpm typecheck                                          passed
pnpm test:unit                                          27 files, 137 tests passed
pnpm test:contract                                      4 files, 24 tests passed
pnpm db:migrate                                         11 migrations applied
pnpm db:reset:test                                      full down / reapply passed
pnpm db:seed && pnpm db:seed                            passed, idempotent
pnpm test:integration                                   13 files, 74 tests passed
pnpm build                                              passed
git diff --check                                        passed
```

数据库验证使用独立 PostgreSQL 18.4 + pgvector 0.8.5 临时测试容器，完成后已删除。平台测试仅使用合成 fixture、fake repository 和内存 port，不访问真实平台网络或付费 API。

## 2026-07-22 主线同步与契约加固复验

同步 `origin/main` 后，新增发布错误码 union 及下游 `accepted / duplicate` 投递结果 contract；未接入数据库或真实平台。

```text
fresh migration + full down / reapply + two idempotent seeds    passed
pnpm lint                                                       passed
pnpm typecheck                                                  passed
pnpm test:unit                                                  29 files, 145 tests passed
pnpm test:contract                                              4 files, 29 tests passed
pnpm test:integration                                           14 files, 86 tests passed
pnpm test:operations                                            6 files, 23 tests passed
pnpm build                                                      passed
git diff --check                                                passed
```

## 2026-07-22 Meta durable inbound 阶段

先新增失败测试，确认 provider attachment URL 的 query / fragment 会进入规范化事件和 Job payload；实现 URL 最小化后，Meta connector 与 Job payload parser 均只保留 HTTPS origin/path。新增的集成测试模拟：worker A 已完成会话业务事务、尚未来得及 ACK Job 时被终止，lease 到期后 worker B 重新领取同一 Job；断言只保留一个会话消息并最终标记 Job 为 `succeeded`。

```text
pnpm install --frozen-lockfile                                passed
pnpm lint                                                      passed
pnpm typecheck                                                 passed
pnpm test:unit                                                 30 files, 154 tests passed
pnpm test:contract                                             4 files, 35 tests passed
fresh migration + full down / reapply                          passed
pnpm db:seed && pnpm db:seed                                  passed, idempotent
pnpm test:integration                                          15 files, 90 tests passed
pnpm test:operations                                           6 files, 23 tests passed
pnpm build (isolated DB + non-secret placeholders)             passed
git diff --check                                               passed
```

另新增第二条不同 Meta 消息的状态机回归：第一条无出站授权的消息转为 `handoff_requested` 后，第二条和 resolved 后的后续消息必须分别持久化，不能重启 AI 或重复接管；相同场景同时运行在 real / fake ChatService contract。数据库为隔离 PostgreSQL 18.4 + pgvector 0.8.5。测试仅使用 synthetic fixture、fake responder 与本地数据库；不调用真实 Meta、TikTok、LinkedIn 或付费 AI 网络。
