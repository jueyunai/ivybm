# Test notes

## Passed

- ESLint：0 errors，32 个既有/生成 migration warnings。
- TypeScript：通过。
- Unit：115 files / 806 tests；AI evaluation 60/60。
- Integration：隔离测试库重置后 29 files / 172 tests；Task 8 ingestion 3/3。
- Contract：7 files / 70 tests。
- Chromium：知识库 desktop/mobile/CRUD 3/3，未 skip。
- Production build：通过。
- PostgreSQL 18.4 + pgvector 0.8.5 本地 `_test` 库完整 migration down/up 通过。
- Operations 非 Docker 用例：32/32；`git diff --check` 通过。

## Local environment limitation

本机没有 Docker CLI。Compose 8 项和 production preflight 的 9 个成功路径在执行最终 Compose 校验前因 Docker 缺失退出；负向 preflight 6/6 及其他 operations 全部通过。该缺口保留给 GitHub Full CI，不计作 production 授权。

未调用 production、真实客户资料或外部付费模型；聊天中的测试 Key 未用于 production。
