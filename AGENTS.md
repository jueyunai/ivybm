# IVYBM 项目代理规则

本文件适用于在本仓库工作的 Codex、Claude Code 及其他编码代理。开始任务前必须先阅读本文件、`CONTRIBUTING.md` 和当前任务对应的实施计划。

## 当前 MVP 冲刺基线（2026-08-10，最高执行优先级）

- 当前唯一冲刺计划是 [`docs/plans/2026-08-10-MVP范围冻结与交付冲刺.md`](docs/plans/2026-08-10-MVP范围冻结与交付冲刺.md)。它与旧需求、计划、ADR 或流程冲突时，以该文件为准；安全底线、共享结构 Review、production 人工审批和敏感资料边界不变。
- Payload `/admin` 的客户后台选型已判定失败，只保留为受限内部维护入口；`/dashboard` 是唯一客户后台、培训和验收入口，不得以 `/admin` 深链或操作替代 Portal 交付。
- 冲刺期只优先完成四条真实闭环：官网询盘→Lead→飞书、官网 AI 客服→人工接管→Lead→飞书、Portal CMS→公开官网、AI 内容审核→用户点击→Facebook/Instagram/LinkedIn 官方 API 发布。
- 三平台发布是用户在工作台明确点击后由服务端调用官方 API；不做无人值守/定时发布，也不得降级为人工复制粘贴。多平台分别记录结果，结果未知时停止自动重发。
- CI 架构演进已冻结，PR #64/#65 暂停。除非现有 CI 直接阻断业务 PR 合并或 production 发布且得到负责人明确批准，不得修改 `.github/workflows/**`、`scripts/ci/**`、CI policy 或可信控制面。
- checkpoint 只运行与改动直接相关的 lint/typecheck/test；现有 Ready/merge/production CI 继续生效。不得为了测试数量、跨平台视觉矩阵或非阻断边界重复执行全仓库完整门禁。
- 不建设每日自动数据库/媒体备份。只在 production migration、批量正式内容/媒体导入、高风险数据变更上线或负责人要求阶段快照时执行现有手动备份流程。
- 每名开发者同时最多推进一个功能 PR。新增工作预计超过 1 个工作日，必须先说明替换范围或日期影响；不允许以通用框架、流程优化或文档扩张填充外部依赖等待时间。

## 仓库与分支

- 仓库可根据项目阶段保持 private 或 public；切换为 public 前必须完成公开前安全审计、凭据扫描和敏感资料确认，并由负责人明确批准。
- `main` 是唯一长期分支，始终保持可构建、可部署。
- 只读审查可以停留在 `main`；任何文件修改前必须从最新 `origin/main` 创建短分支。
- 功能分支使用 `feat/task-<编号>-<简述>`，修复使用 `fix/<简述>`，文档使用 `docs/<简述>`。
- 禁止直接向 `main` push，禁止 force push 或改写 `main` 历史。
- 除非用户明确要求，代理不得自行 push、创建 PR、合并 PR 或部署 production。
- 当仓库为 private 且当前 GitHub 套餐无法启用服务端 branch protection 时，必须安装并遵守 `.githooks/pre-push`；仓库公开后仍保留本地 hook 和 PR review 约束。

## 开工流程

主工作区 `ivybm` 只用于维护最新、干净的 `main` 基线和创建 worktree，不在其中开发。修改文件前，在主工作区依次执行：

```bash
git status --short --branch
git fetch origin
git switch main
git pull --ff-only origin main
git worktree add -b feat/task-<编号>-<简述> ../ivybm-task<编号>-<简述> origin/main
bash scripts/install-git-hooks.sh
```

如果工作树不干净，不覆盖、不丢弃现有修改；先识别修改归属，无法安全绕开时向用户说明。

## 本地 worktree 管理

- 永久工作区只有 `ivybm`，且必须保持在 `main`、状态干净并与 `origin/main` 同步。功能、修复、文档、PoC 和 PR 审查都在独立 worktree 中进行。
- 开发目录与分支用途一一对应：`ivybm-task<编号>-<简述>` 对应 `feat/task-<编号>-<简述>`，`ivybm-fix-<简述>` 对应 `fix/<简述>`，`ivybm-docs-<简述>` 对应 `docs/<简述>`；本地分支与远程 upstream 必须同名，禁止把相似名称的远程分支误设为 upstream。
- 协作者 PR 使用临时 `ivybm-review-pr-<编号>`，默认 detached HEAD，只读审查，不在协作者分支上提交或 push。需要修复时由作者更新原 PR，或经明确授权后另建短分支。
- PoC 使用临时 `ivybm-poc-<简述>` 和 `poc/<简述>`；PoC 不直接合并，确认采用后从最新 `origin/main` 建正式 Task 分支，只迁移选定改动。
- 每人本地同时最多保留 1 个主工作区、2 个开发类 worktree（PoC / hotfix 计入）和 2 个审查 worktree。不为 `develop`、integration、release、production 或每条协作者远程分支建立长期 worktree。
- 每个并行 worktree 必须隔离应用端口、Compose project name 和开发 / 测试数据库；`.env`、`node_modules`、`.next`、media 和其他可变运行时目录不得跨 worktree 共享。无法隔离时，同一时间只运行一个本地栈。
- PR 合并或审查结束后先确认 worktree 干净；开发分支还要确认提交已进入 `origin/main`，再用 `git worktree remove` 清理。禁止用文件系统强删 Git worktree，禁止自动删除 dirty 或未合并分支。
- 每周执行 `git fetch --prune origin`、`git worktree list` 和 `git worktree prune --dry-run` 审计。远程分支由 PR 作者或仓库负责人在合并后删除。
- 完整目录、创建、PR 审查、环境隔离和清理命令见 `CONTRIBUTING.md` 的“本地 worktree 规范”。

## 提交与 PR

- 一个分支只处理一个实施计划 PR 批次或一个紧密相关的小修复；Task 是批次内的 commit / 验收检查点，不自动等于独立 PR，禁止混入批次外的无关任务。
- 同一目标、同一实施计划、同一 Review 边界且可一起回滚 / 发布的紧密相关改动，默认使用一个 Draft PR 和分阶段 commit，保持 diff 可审；禁止仅为流程形式把方案、实现和验证记录机械拆成多个 PR。只有独立任务、不同负责人或强制 Review 边界、需要独立回滚 / 发布，或完整 diff 已明显超出可审规模时才拆分。
- 管理后台现代化按 ADR-0004 使用一个功能分支、一个 Portal V1 Draft PR、一次合并和一次人工批准的 production 部署；P0.1–P1.4、发布启用配置、测试与文档都在该 PR 内按 checkpoint commit 保持可审。真实平台 transport、token 刷新、worker 发布 handler、平台回调和受控账号联调由 xuemusi 后续独立 PR 完成，不是 Portal V1 完成条件。合并 PR 不改变模块 owner、共享文件强制 review 或 production 审批。
- 提交前运行该 Task 规定的 lint、typecheck、test、build；不能运行时明确说明原因。
- PR 标题和描述必须引用 Task 编号，并填写 `.github/pull_request_template.md`。
- 项目初始化、CI、工程配置、文档及负责人自己板块内的独立改动，在 CI 通过、完成 PR 清单并检查完整 diff 后，可由负责人自检合并；必须在 PR 中记录不涉及共享结构、跨人契约、协作者范围或一期上线验收。作者自检不等同于 GitHub 独立审批。
- 共享文件 `src/payload.config.ts`、migration、`Leads`、`Conversations`、`Messages`、`GeneratedContents`、`ContentReviews`、`PublishJobs`、`PublishLogs`，以及供另一人任务消费的公共接口、字段或契约，必须由另一名开发者 review。跨双方板块边界或影响另一人在途任务的改动同样不得自检合并。
- production 发布仍由 jueyunai 审批，一期上线验收必须由两人共同确认。
- `main` 上的紧急修复只能在用户明确授权后使用 `IVYBM_ALLOW_MAIN_PUSH=1` 绕过本地 hook；完成后必须补建 PR 或事故记录。

### 本地验证与证据诚实

- PR 应交付已经稳定的结果；探索、E2E 失败定位和本地联调优先在独立 worktree 完成。每个 checkpoint 选择与本次 diff 直接相关的最小测试层，不强制为每个 checkpoint 新增或重复运行 E2E。
- 失败后区分测试定位 / 断言问题、环境 blocker 和生产代码缺陷；生产缺陷必须与能证明修复的回归测试一起提交。
- 缺少真实账号、数据库或受控环境时，记录 blocker 和已有本地 / fixture 证据；不得把未运行、skipped、fake 或 fixture 结果描述为真实平台联调通过。

## AI 与 CI 门禁

- AI 创建 PR 时，只有本地完整门禁、PR 描述、风险 / 回滚和 Review 边界全部完成，并得到当前任务级明确授权，才可以直接创建 Ready PR。否则必须创建 Draft，并保持 Draft 到真实 Ready 检查点；禁止 Draft 创建后几十秒内立即转 Ready。
- push 前必须运行对应 Task 的本地定向检查；GitHub CI 不是调试器。同一轮小修改必须集中完成后一次 push，禁止逐提交触发 Actions 调试。
- AI 和 PR 作者不手工选择 CI 档次，不使用 `[skip ci]`；由变更路径分类器自动决定。无法识别路径、无法解析 diff 或分类器异常时必须 fail closed，运行完整门禁。
- Draft 代码只把 Fast CI 作为开发反馈，不是合并授权。Ready 后如需连续或较大修改，先转回 Draft；Ready 状态下任何新提交都必须针对最新 head 重新运行对应门禁。
- Portal V1 本地功能跑通期允许只运行当前 checkpoint 的定向验证；完整回归可以后置到转 Ready 前，但不得后置服务端 Auth/RBAC、数据/migration 完整性、凭据隔离、外部副作用幂等、feature flag、`delivery_unknown` 和发布 kill switch。
- 审核时记录 base SHA、head SHA、mergeability、完整 diff、Review 状态和 `CI policy`。只有与当前 head SHA 一致的成功 `CI policy` 可作为门禁证据；Draft Fast CI、旧 head，以及 pending、neutral、skipped、cancelled 或 failure 均不能授权合并。
- `.github/workflows/**`、`scripts/ci/**`、CI policy 或 production image 触发边界的修改必须由另一名开发者独立 Review，不适用负责人自检合并。
- docs-only 轻量门禁不改变共享结构、跨人契约和协作者边界的人工 Review 规则。production image 构建成功也不代表 production 部署授权；部署仍需 jueyunai 人工审批和既有 smoke / rollback 流程。

## 分工与依赖

- jueyunai 负责 Portal Core、登录、首页、Shell、模块 Registry、UI contract、基础设置、官网/CMS/SEO、素材库、AI 内容工作台、内容生成/人工审核流程、`GeneratedContents` / `ContentReviews` / `PublishJobs` / `PublishLogs`、线索/飞书入口、通用 Jobs 异常外壳、整体 IA/Digital Lattice 和集成验收。Task 9 中 jueyunai 只负责官网 ChatWidget 与 Portal 公共基座，不负责统一会话工作区。
- xuemusi 负责业务知识库与 AI 调试、AI 客服公共能力、统一会话入口、海外社媒账号/连接器/readiness，以及第三方平台 capability / publish / status、adapter、结果回调和真实发布执行。责任覆盖这些模块的页面或服务、读模型、命令、领域状态机、幂等、权限和审计；不负责 AI 内容工作台 UI、内容生成/审核流程或其共享结构。
- 责任边界以 [`ADR-0004`](docs/architecture/adr/0004-modular-admin-portal.md) 和 [管理后台模块化架构与责任边界](docs/architecture/管理后台模块化架构与责任边界.mermaid) 为准。依赖箭头不改变 owner；共享 Core、Collection、migration、`src/payload.config.ts` 和跨模块 contract 继续强制另一人 review。
- 一期平台范围冻结：入站会话仅为 Facebook Messenger、Instagram DM（企业 / 商业账号）和 TikTok 私信（商业账号）；图文发布仅为 Facebook、Instagram（企业账号）和 LinkedIn（账号类型不限制，但 API 发布权限仍需验证）。三平台发布由用户在 AI 内容工作台点击一次后触发服务端官方 API 调用，不是无人值守/定时发布，也不接受人工复制粘贴作为交付替代。WhatsApp 不纳入一期系统 connector、Webhook、自动回复或发布能力，二期再评估网页插件等替代接入；官网静态链接不等于系统接入。
- Task 9 的官网前端可以先依赖 `ChatService` mock 开发；其后端服务和数据库集成必须等待 Task 7 的 `Leads` 合并到 `main`，并消费 Task 8 的 AI 网关 contract。
- Task 12 的 AI 内容工作台由 jueyunai 负责，可先依赖共同冻结的 `PublishingService` mock 开发；范围包括页面、内容生成/人工审核流程、状态机和 `GeneratedContents` / `ContentReviews` / `PublishJobs` / `PublishLogs`。xuemusi 提供平台 capability / publish / status、账号 readiness、adapter、结果回调和真实发布执行。任何前端都不能直接接入平台 SDK 或 token。
- Task 9 / Task 12 的跨人接口必须先冻结 TypeScript port/interface、请求响应 schema、错误码、状态枚举和 fixture；双方各自用 fake service / fake repository 完成测试后再替换真实 adapter。
- 人工接管以官网入口、Portal 模块与领域服务分层：jueyunai 负责官网 ChatWidget 和 Portal 公共交互契约，xuemusi 负责运营会话/接管界面与服务端权威状态机；所有前端都不得直接写 `handoffStatus`、`assignedTo` 或审计字段。服务端产生领域事件，Task 10 / 11 处理飞书通知、重试和补偿。
- Task 13 会话侧数据库集成必须等待 Task 9 的 `Conversations` / `Messages`；发布侧数据库集成必须等待 Task 12 的 `PublishJobs` / `PublishLogs`；真实 Webhook 异步处理、社媒 AI 自动出站、发布执行、失败重试和人工补偿必须等待 Task 10 的 `Jobs`、worker 及其 migration 合并到 `main`，并要求 `PlatformAccounts`、migration、Payload 注册和生成类型已合并。纯连接器接口和 fixture 契约测试不依赖 Task 10。
- 依赖未合并时，Task 13 可并行开发连接器接口、Webhook 验签、事件幂等、payload 归一化，以及 Facebook Messenger / Instagram DM / TikTok 私信和 Facebook / Instagram / LinkedIn 图文发布的官方 fixture 契约测试与 mock；也可按 [ADR-0003](docs/architecture/adr/0003-social-conversation-outbound-delivery.md) 冻结 server-only 社媒会话出站 port / fake / 失败注入测试。必须使用 TypeScript port/interface 与 fake repository，不得创建临时替代 Collection 或替代 migration；fake 结果不得被标为平台已发送或 `available`。
- 任何数据库 adapter 开发都必须等待对应 Collection、migration、`src/payload.config.ts` 注册和 `src/payload-types.ts` 生成类型全部合并到 `main`，仅有接口定义或 Collection 代码不视为依赖已满足。
- 上条对跨分支/跨 PR 的数据库依赖保持不变。Portal V1 同一 Draft PR 内的生产者与消费者可以在前置 checkpoint 已完成完整 Collection、migration、Payload 注册、生成类型和定向测试后继续，不为制造 main gate 机械拆 PR；相关结构和 adapter 仍必须由另一名开发者 review 后才能合并。
- 外部平台联调需要对应账号、授权和 production 或等价受控真实环境；条件不足时以官方 fixture 契约测试、配置说明和阻塞记录按一期 P1 口径验收。WhatsApp 与其他未列平台作为二期项，不进入一期验收。
- migration 以先合并到 `main` 的历史为准；未合并分支在同步最新 `main` 后重新生成，不修改已合并 migration。

## 安全与资料边界

- 禁止提交 `.env`、云密钥、平台 token、证书私钥、客户合同、报价成品、客户原始资料、数据库、uploads 和备份。
- 发现疑似凭据时立即停止传播，提醒用户轮换；不得把凭据复制到文档、日志或 PR。
- 第三方平台连接器必须验签、幂等、限流并隐藏 token；平台审核阻塞按需求文档的一期 P1 条件交付与二期范围口径处理。

## 文档和进度

- 需求基线：`docs/requirements/一期需求说明文档.md`。
- 技术基线：`docs/architecture/一期技术选型与部署架构规划.md`。
- 当前冲刺计划：`docs/plans/2026-08-10-MVP范围冻结与交付冲刺.md`。
- 历史总体实施计划为 `docs/plans/2026-07-16-一期开发实施计划.md`；Portal 历史计划为
  `docs/plans/2026-07-29-modular-admin-portal-implementation.md` 和 ADR-0004。与当前冲刺计划冲突时，以当前冲刺计划为准。
- 完成阶段性任务后及时更新 `docs/开发进度.md`。
- 代码、需求、架构或计划不一致时，先指出冲突并修正文档基线，再继续实施。
