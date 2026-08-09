# Claude Code 项目规则

Claude Code 在本仓库工作时，必须以 [`AGENTS.md`](AGENTS.md) 为主规则，并同时遵守 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

特别强调：

- 仓库必须保持 private。
- `ivybm` 主工作区只保留干净的 `main`；修改文件前从最新 `origin/main` 创建 Task 级短分支和独立 worktree，PR 审查使用临时 detached worktree。
- 禁止直接 push `main`，禁止 force push；先运行 `bash scripts/install-git-hooks.sh`。
- 除非用户明确要求，不自行 commit、push、创建或合并 PR、部署 production。
- 同一目标、实施计划、Review 边界和回滚 / 发布单元一致时，使用一个 Draft PR 和分阶段 commit，不把方案、实现、验证记录机械拆成多个 PR；不同任务也不得混入同一 PR。
- 修改 Payload 共享 Collection、`src/payload.config.ts`、migration、跨人公共契约或双方板块边界时，必须请求另一名开发者 review，并等待 review 完成后才能合并。
- 只有本地完整门禁、PR 描述、风险 / 回滚和 Review 边界全部完成，并得到当前任务级明确授权时，AI 才可以直接创建 Ready PR；否则必须创建 Draft 并保持到真实检查点，禁止创建后几十秒内立即转 Ready。
- push 前先做本地定向验证，同一轮小修改集中完成后一次 push，禁止用 GitHub Actions 逐提交调试；不手工选择 CI 档次，不使用 `[skip ci]`，Ready 后连续修改先转回 Draft。
- 审核只接受当前 head SHA 的成功 `CI policy`；Draft Fast CI、旧 head、skipped、cancelled、pending 或 failure 都不能授权合并。workflow、`scripts/ci/**`、policy 和镜像触发边界必须由另一名开发者独立 review。
- production image 成功不等于 production 部署授权，部署仍需 jueyunai 人工审批。
- 当前冲刺以 `docs/plans/2026-08-10-MVP范围冻结与交付冲刺.md` 为最高执行基线；历史总体计划、Portal 计划和 ADR 与其冲突时以后者为准。`/dashboard` 是唯一客户后台，`/admin` 只供受限内部维护；CI 演进冻结，三平台发布只由用户点击后触发服务端官方 API，不做定时/无人值守发布或人工复制粘贴替代。jueyunai 负责 Portal Core、官网/CMS/素材/线索和 AI 内容工作台；xuemusi 负责知识/AI 调试、AI 客服/统一会话、平台账号/连接器及真实 API 发布服务。完成阶段后更新 `docs/开发进度.md`。
- 不提交任何密钥、客户商务文件、数据库、上传文件或备份。

若本文件与 `AGENTS.md` 有差异，以约束更严格者为准。
