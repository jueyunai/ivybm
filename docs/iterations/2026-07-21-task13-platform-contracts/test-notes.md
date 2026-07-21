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
