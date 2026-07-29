# Claude Code 项目规则

Claude Code 在本仓库工作时，必须以 [`AGENTS.md`](AGENTS.md) 为主规则，并同时遵守 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

特别强调：

- 仓库必须保持 private。
- `ivybm` 主工作区只保留干净的 `main`；修改文件前从最新 `origin/main` 创建 Task 级短分支和独立 worktree，PR 审查使用临时 detached worktree。
- 禁止直接 push `main`，禁止 force push；先运行 `bash scripts/install-git-hooks.sh`。
- 除非用户明确要求，不自行 commit、push、创建或合并 PR、部署 production。
- 同一目标、实施计划、Review 边界和回滚 / 发布单元一致时，使用一个 Draft PR 和分阶段 commit，不把方案、实现、验证记录机械拆成多个 PR；不同任务也不得混入同一 PR。
- 修改 Payload 共享 Collection、`src/payload.config.ts`、migration、跨人公共契约或双方板块边界时，必须请求另一名开发者 review，并等待 review 完成后才能合并。
- AI 默认创建 Draft PR，push 前先做本地定向验证并合并同轮小修改；不手工选择 CI 档次，不使用 `[skip ci]`，Ready 后连续修改先转回 Draft。
- 审核只接受当前 head SHA 的成功 `CI policy`；Draft Fast CI、旧 head、skipped、cancelled、pending 或 failure 都不能授权合并。workflow、`scripts/ci/**`、policy 和镜像触发边界必须由另一名开发者独立 review。
- production image 成功不等于 production 部署授权，部署仍需 jueyunai 人工审批。
- 执行任务时以 `docs/plans/2026-07-16-一期开发实施计划.md` 为总计划；管理后台 Portal 事项以 `docs/architecture/adr/0004-modular-admin-portal.md` 和 `docs/plans/2026-07-29-modular-admin-portal-implementation.md` 为准。用户原图红圈的知识/AI 调试、AI 内容、海外发布、AI 客服、统一会话和社媒账号/连接器归 xuemusi，其他 Portal Core 与模块归 jueyunai。完成阶段后更新 `docs/开发进度.md`。
- 不提交任何密钥、客户商务文件、数据库、上传文件或备份。

若本文件与 `AGENTS.md` 有差异，以约束更严格者为准。
