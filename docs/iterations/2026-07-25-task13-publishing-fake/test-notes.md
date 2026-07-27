# Task 13 可复用发布 Fake：测试记录

## TDD 覆盖

单元 / contract 测试覆盖：

- 默认 conditional capability 的 Facebook / Instagram 均 fail closed 为 `account_not_connected`，LinkedIn assisted 自动 `publish` 均拒绝；
- 显式 `available + automatic` mock override 下的 accepted → pending → publishing → published；
- failed 转换、非法状态回退、未知或跨平台 ID；
- `Promise.all` 重复提交、同 key 内容冲突、跨平台 key 隔离；
- 下一次 provider failure 不创建 accepted 关联 ID；已 accepted 的重复命令不能消费该失败队列，随后新的命令才会消费它。
- 未知 publishing platform、非字符串命令字段、畸形 capability override 和非对象 request / status / control 都以稳定 fake error 拒绝，避免 TypeScript escape 在 mock 中伪装成 provider 行为。
- LinkedIn ZIP package 对相同素材集稳定排序、字节稳定，包含 README / 文案 / 无签名 URL 的 manifest / 素材字节；拒绝路径穿越、重复文件名和未提供 bytes，不访问网络或文件系统。

## 最终质量门禁

```text
pnpm install --frozen-lockfile                         passed
pnpm lint                                               passed
pnpm typecheck                                          passed
pnpm test:unit                                          37 files, 192 tests passed
pnpm test:contract                                      4 files, 35 tests passed
fresh migration + full down/up reset                    passed
pnpm db:seed && pnpm db:seed                            passed, idempotent
pnpm test:integration                                   17 files, 94 tests passed
pnpm test:operations                                    6 files, 25 tests passed
pnpm db:test:persistence                                passed
pnpm build (CI-equivalent placeholder configuration)    passed
git diff --check                                        passed
```

数据库验证使用一次性 PostgreSQL 18.4 + pgvector 0.8.5 容器；fake 没有调用真实平台、文件系统、数据库或付费 AI API。production build 使用与 CI 一致的无敏感占位配置，未读取或写入生产凭据。
