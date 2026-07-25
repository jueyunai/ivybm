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
- 共享文件 `src/payload.config.ts`、migration、`Leads`、`Conversations`、`Messages`、`GeneratedContents`、`PublishJobs`、`PublishLogs`，以及供另一人任务消费的公共接口、字段或契约，必须由另一名开发者 review。跨双方板块边界或影响另一人在途任务的改动同样不得自检合并。
- production 发布仍由 jueyunai 审批，一期上线验收必须由两人共同确认。
- `main` 上的紧急修复只能在用户明确授权后使用 `IVYBM_ALLOW_MAIN_PUSH=1` 绕过本地 hook；完成后必须补建 PR 或事故记录。

## 高风险 PR 审查

- 审查涉及异步 Jobs / worker、AI Gateway / RAG 向量检索、Payload Collection、PostgreSQL migration、Docker Compose 或 production 发布步骤的 PR 前，必须阅读并遵守 [`skills/ivybm-fault-model-review/SKILL.md`](skills/ivybm-fault-model-review/SKILL.md)。不得只以 CI 通过或 happy-path 测试作为可合并结论。

## 分工与依赖

- jueyunai：Task 1-7、10-12、14-15；官网/CMS、SEO、飞书、内容工作台、部署收尾。Task 9 由 jueyunai 负责官网 ChatWidget 前端；Task 12 由 jueyunai 负责内容工作台前端、内容生成/审核工作流，以及 `PublishJobs` / `PublishLogs` 共享结构和发布任务创建。
- xuemusi：Task 8-9、13；知识库/AI 客服、社媒会话与发布。Task 9 由 xuemusi 负责会话/AI 服务，以及人工接管状态机、转换守卫、幂等、权限、审计、领域事件和数据库集成；Task 12 由 xuemusi 负责第三方平台 capability、publish、status 接口、平台 adapter 和发布结果回调。
- 一期平台范围冻结：入站会话仅为 Facebook Messenger、Instagram DM（企业 / 商业账号）和 TikTok 私信（商业账号）；图文发布仅为 Facebook、Instagram（企业账号）和 LinkedIn（账号类型不限制，但 API 发布权限仍需验证）。WhatsApp 不纳入一期系统 connector、Webhook、自动回复或发布能力，二期再评估网页插件等替代接入；官网静态链接不等于系统接入。
- Task 9 的官网前端可以先依赖 `ChatService` mock 开发；其后端服务和数据库集成必须等待 Task 7 的 `Leads` 合并到 `main`，并消费 Task 8 的 AI 网关 contract。
- Task 12 的内容工作台前端和内部内容/审核/发布任务流程可以先依赖 `PublishingService` mock 开发；第三方平台发布接口由 xuemusi 提供，不能在前端直接接入平台 SDK 或 token。
- Task 9 / Task 12 的跨人接口必须先冻结 TypeScript port/interface、请求响应 schema、错误码、状态枚举和 fixture；双方各自用 fake service / fake repository 完成测试后再替换真实 adapter。
- 人工接管以前端体验与领域服务分层：jueyunai 负责 ChatWidget 和运营接管界面，xuemusi 负责服务端权威状态机；前端不得直接写 `handoffStatus`、`assignedTo` 或审计字段。服务端产生领域事件，Task 10 / 11 处理飞书通知、重试和补偿。
- Task 13 会话侧数据库集成必须等待 Task 9 的 `Conversations` / `Messages`；发布侧数据库集成必须等待 Task 12 的 `PublishJobs` / `PublishLogs`；真实 Webhook 异步处理、发布执行、失败重试和人工补偿必须等待 Task 10 的 `Jobs`、worker 及其 migration 合并到 `main`。纯连接器接口和 fixture 契约测试不依赖 Task 10。
- 依赖未合并时，Task 13 可并行开发连接器接口、Webhook 验签、事件幂等、payload 归一化，以及 Facebook Messenger / Instagram DM / TikTok 私信和 Facebook / Instagram / LinkedIn 图文发布的官方 fixture 契约测试与 mock；必须使用 TypeScript port/interface 与 fake repository，不得创建临时替代 Collection 或替代 migration。
- 任何数据库 adapter 开发都必须等待对应 Collection、migration、`src/payload.config.ts` 注册和 `src/payload-types.ts` 生成类型全部合并到 `main`，仅有接口定义或 Collection 代码不视为依赖已满足。
- 外部平台联调需要对应账号、授权和 staging；条件不足时以官方 fixture 契约测试、配置说明和阻塞记录按一期 P1 口径验收。WhatsApp 与其他未列平台作为二期项，不进入一期验收。
- migration 以先合并到 `main` 的历史为准；未合并分支在同步最新 `main` 后重新生成，不修改已合并 migration。

## 安全与资料边界

- 禁止提交 `.env`、云密钥、平台 token、证书私钥、客户合同、报价成品、客户原始资料、数据库、uploads 和备份。
- 发现疑似凭据时立即停止传播，提醒用户轮换；不得把凭据复制到文档、日志或 PR。
- 第三方平台连接器必须验签、幂等、限流并隐藏 token；平台审核阻塞按需求文档的一期 P1 条件交付与二期范围口径处理。

## 文档和进度

- 需求基线：`docs/requirements/一期需求说明文档.md`。
- 技术基线：`docs/architecture/一期技术选型与部署架构规划.md`。
- 实施计划：`docs/plans/2026-07-16-一期开发实施计划.md`。
- 完成阶段性任务后及时更新 `docs/开发进度.md`。
- 代码、需求、架构或计划不一致时，先指出冲突并修正文档基线，再继续实施。
