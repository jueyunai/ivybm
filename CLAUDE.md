# Claude Code 项目规则

Claude Code 在本仓库工作时，必须以 [`AGENTS.md`](AGENTS.md) 为主规则，并同时遵守 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

特别强调：

- 仓库必须保持 private。
- `ivybm` 主工作区只保留干净的 `main`；修改文件前从最新 `origin/main` 创建 Task 级短分支和独立 worktree，PR 审查使用临时 detached worktree。
- 禁止直接 push `main`，禁止 force push；先运行 `bash scripts/install-git-hooks.sh`。
- 除非用户明确要求，不自行 commit、push、创建或合并 PR、部署 production。
- 修改 Payload 共享 Collection、`src/payload.config.ts`、migration、跨人公共契约或双方板块边界时，必须请求另一名开发者 review，并等待 review 完成后才能合并。
- 执行任务时以 `docs/plans/2026-07-16-一期开发实施计划.md` 为准，完成阶段后更新 `docs/开发进度.md`。
- 不提交任何密钥、客户商务文件、数据库、上传文件或备份。

若本文件与 `AGENTS.md` 有差异，以约束更严格者为准。
