# IVYBM 项目代理规则

本文件适用于在本仓库工作的 Codex、Claude Code 及其他编码代理。开始任务前必须先阅读本文件、`CONTRIBUTING.md` 和当前任务对应的实施计划。

## 仓库与分支

- 仓库必须保持 private，禁止改为 public。
- `main` 是唯一长期分支，始终保持可构建、可部署。
- 只读审查可以停留在 `main`；任何文件修改前必须从最新 `origin/main` 创建短分支。
- 功能分支使用 `feat/task-<编号>-<简述>`，修复使用 `fix/<简述>`，文档使用 `docs/<简述>`。
- 禁止直接向 `main` push，禁止 force push 或改写 `main` 历史。
- 除非用户明确要求，代理不得自行 push、创建 PR、合并 PR 或部署 production。
- GitHub 免费私有仓库无法启用服务端 branch protection，因此必须安装并遵守 `.githooks/pre-push`。

## 开工流程

修改文件前依次执行：

```bash
git status --short --branch
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feat/task-<编号>-<简述>
bash scripts/install-git-hooks.sh
```

如果工作树不干净，不覆盖、不丢弃现有修改；先识别修改归属，无法安全绕开时向用户说明。

## 提交与 PR

- 一个分支只处理一个实施计划 Task 或一个紧密相关的小修复。
- 提交前运行该 Task 规定的 lint、typecheck、test、build；不能运行时明确说明原因。
- PR 标题和描述必须引用 Task 编号，并填写 `.github/pull_request_template.md`。
- 项目初始化、CI、工程配置、文档及负责人自己板块内的独立改动，在 CI 通过、完成 PR 清单并检查完整 diff 后，可由负责人自检合并；必须在 PR 中记录不涉及共享结构、跨人契约、协作者范围或一期上线验收。作者自检不等同于 GitHub 独立审批。
- 共享文件 `src/payload.config.ts`、migration、`Leads`、`Conversations`、`Messages`、`GeneratedContents`、`PublishJobs`，以及供另一人任务消费的公共接口、字段或契约，必须由另一名开发者 review。跨双方板块边界或影响另一人在途任务的改动同样不得自检合并。
- production 发布仍由 jueyunai 审批，一期上线验收必须由两人共同确认。
- `main` 上的紧急修复只能在用户明确授权后使用 `IVYBM_ALLOW_MAIN_PUSH=1` 绕过本地 hook；完成后必须补建 PR 或事故记录。

## 分工与依赖

- jueyunai：Task 1-7、10-12、14-15；官网/CMS、SEO、飞书、内容工作台、部署收尾。
- xuemusi：Task 8-9、13；知识库/AI 客服、社媒会话与发布。
- Task 9 必须等待 Task 7 的 `Leads` 合并到 `main`。
- Task 13 发布侧必须等待 Task 12 的 `PublishJobs` 合并到 `main`。
- migration 以先合并到 `main` 的历史为准；未合并分支在同步最新 `main` 后重新生成，不修改已合并 migration。

## 安全与资料边界

- 禁止提交 `.env`、云密钥、平台 token、证书私钥、客户合同、报价成品、客户原始资料、数据库、uploads 和备份。
- 发现疑似凭据时立即停止传播，提醒用户轮换；不得把凭据复制到文档、日志或 PR。
- 第三方平台连接器必须验签、幂等、限流并隐藏 token；平台审核阻塞按需求文档的 P0/P1/P2 口径处理。

## 文档和进度

- 需求基线：`docs/requirements/一期需求说明文档.md`。
- 技术基线：`docs/architecture/一期技术选型与部署架构规划.md`。
- 实施计划：`docs/plans/2026-07-16-一期开发实施计划.md`。
- 完成阶段性任务后及时更新 `docs/开发进度.md`。
- 代码、需求、架构或计划不一致时，先指出冲突并修正文档基线，再继续实施。
