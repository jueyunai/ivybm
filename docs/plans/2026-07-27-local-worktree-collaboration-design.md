# 本地 worktree 与分支协作设计

## 目标

在两名开发者通过 GitHub PR 并行协作的前提下，让目录用途、分支归属和运行时环境可识别、可审计、可安全清理。worktree 只解决本地并行检出，不引入 `develop`、integration 或 release 等长期分支。

## 决策

采用“1 个固定主工作区 + 按 Task 创建开发 worktree + 按 PR 创建临时审查 worktree”的混合模式：

- `ivybm` 永久绑定干净的 `main`，作为创建和审计其他 worktree 的控制入口。
- Task、修复和文档改动分别使用与短分支同生命周期的 `ivybm-task<编号>-<简述>`、`ivybm-fix-<简述>` 和 `ivybm-docs-<简述>`。
- 协作者 PR 使用 detached HEAD 的 `ivybm-review-pr-<编号>`，审查结束立即删除。
- 有明确退出条件的实验使用 `ivybm-poc-<简述>`；采用实验结果时，从最新 `origin/main` 建正式分支，只迁移选定改动。
- 开发类与审查 worktree 不设置固定数量上限，按实际并行 Task/PR 创建；通过明确归属、资源隔离、周度审计和完成即清理，避免目录无约束地随远程分支增长。

`main`、GitHub PR 和 CI 继续构成唯一集成基线。production 从已 review 的 `main` SHA + image digest 发布，不需要本地 production worktree。

## 安全边界

开发 worktree 必须从最新 `origin/main` 创建，本地分支与远程 upstream 同名。PR 审查默认只读，不在协作者分支提交或 push。任何清理都先检查未提交改动；开发分支还必须用祖先关系确认已进入 `origin/main`。注册的 worktree 只能通过 `git worktree remove` 清理，不能直接删除目录。

并行运行时必须隔离应用端口、Compose project name、开发数据库和测试数据库。每个 worktree 单独维护被忽略的 `.env`、`node_modules`、`.next` 和其他可变目录；密钥和客户数据不进入 Git、日志或 PR。

## 生命周期

1. 在 `ivybm` 更新并确认干净的 `main`。
2. 从 `origin/main` 创建与一个 Task 对应的 worktree 和短分支。
3. 在该 worktree 开发、验证、push 并提交 PR。
4. 协作者在独立临时 review worktree 检查 head、diff、合并风险、测试和共享边界。
5. PR 合并后确认开发分支已经进入 `origin/main`，再移除 worktree 和本地分支。
6. 审查完成后立即移除 review worktree 和 review ref；每周审计 worktree、upstream、已合并分支和可 prune 元数据。

完整命令和异常处理见仓库根目录的 [`CONTRIBUTING.md`](../../CONTRIBUTING.md)；编码代理的硬约束见 [`AGENTS.md`](../../AGENTS.md)。
