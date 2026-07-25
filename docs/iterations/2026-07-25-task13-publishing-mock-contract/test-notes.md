# Task 13 发布 Mock 契约加固：测试记录

## TDD 证据

先修改 `tests/contract/platforms/publishing.test.ts`，要求 accepted 结果包含 `mock:facebook:fixture-publish-1`，并将返回值传给 `getStatus()`。首次运行按预期失败：fake 返回结果没有 `externalPublicationId`。

随后更新类型、fake 和失败状态回显断言；专项 contract 与 typecheck 已通过。

## 最终质量门禁

```text
pnpm install --frozen-lockfile                         passed
pnpm lint                                               passed
pnpm typecheck                                          passed
pnpm test:unit                                          35 files, 177 tests passed
pnpm test:contract                                      4 files, 35 tests passed
fresh migration + full down/up reset                    passed
pnpm db:seed && pnpm db:seed                            passed, idempotent
pnpm test:integration                                   17 files, 94 tests passed
pnpm test:operations                                    6 files, 25 tests passed
pnpm build                                              passed
git diff --check                                        passed
```

数据库使用一次性 PostgreSQL 18.4 + pgvector 0.8.5 容器；所有 AI 调用使用 fake provider，未访问真实平台或付费 API。

## 覆盖边界

- 覆盖 mock 的 accepted → status 关联、同一平台同一幂等命令的稳定结果，以及同键但不同文案、素材或定时字段的 fail-closed `invalid_request`。
- 不声称覆盖 provider 已接收但进程死亡、真实 webhook 回调、数据库并发、worker lease 或真实账号权限；这些是后续依赖满足后的故障注入场景。
