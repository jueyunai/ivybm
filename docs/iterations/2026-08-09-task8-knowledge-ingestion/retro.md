# Retro

## What worked

- luna_worker 负责实现、Main Codex 负责 Review、独立 agent 负责 QA，避免实现者自批。
- 真实数据库和 101+ 分页用例发现了普通 happy-path 测试覆盖不到的状态问题。
- 独立 QA 识别出脏测试库、全局 pnpm 和 Playwright 端口三个环境问题，而不是误判为业务通过。

## Improvements

- 每次完整 integration 前先使用受保护的 `db:reset:test` 清理独立 `_test/_ci` 库。
- E2E launcher 一律通过 Corepack 使用仓库锁定的包管理器版本，并显式统一监听/等待端口。
- 涉及事务内数据与异步 Job 时，Review 必须验证 Job 在 commit 前不可见。
- production preflight 的成功路径依赖 Docker，应在任务开始时标记为外部本机能力门禁。
