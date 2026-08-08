# 协作与分支规范

本文档约定两名开发者在同一个仓库上的协作方式。板块级分工见 [`docs/requirements/一期需求说明文档.md`](docs/requirements/一期需求说明文档.md#L495) 第10节；总体任务排期和负责人见 [`docs/plans/2026-07-16-一期开发实施计划.md`](docs/plans/2026-07-16-一期开发实施计划.md) 里程碑表。管理后台 Portal 的任务顺序、PR 批次、owner、依赖和门禁以 [`docs/plans/2026-07-29-modular-admin-portal-implementation.md`](docs/plans/2026-07-29-modular-admin-portal-implementation.md) 为准；与总体计划冲突时以 Portal 专项计划和 ADR-0004 为准。

## 分支策略

采用主干开发（trunk-based），不使用长期个人分支——两人各开一条贯穿全程的分支、最后合并的方式，会把所有冲突推到最后一次性爆发，改用短分支高频合并可以把冲突拆小。

- 只有一条长期分支：`main`。`main` 始终保持可构建、可部署状态，不直接 push。
- 每个实施计划 PR 批次从 `main` 拉一条短分支；同一目标、Owner、Review 和回滚边界内的多个 Task 以分阶段 commit 累积在同一个 Draft PR，批次完成后合并回 `main`。Task 不自动等于独立 PR。
- 管理后台现代化按 ADR-0004 使用一个 Portal V1 Draft PR，覆盖 Portal Core、十个导航模块、内部数据库工作流、生产开关配置、测试和文档；通过 review 与当前 head 门禁后一次合并，再由 jueyunai 人工批准一次 production 部署。真实平台 transport 与受控账号联调保留为 xuemusi 后续独立 PR，不阻塞 Portal V1，且不改变共享边界强制 review。
- 分支命名：`feat/task-<编号>-<简述>`，例如 `feat/task-8-knowledge-base`；修复用 `fix/...`。
- 开工前先 `git pull origin main`，确保基于最新代码开分支。

## 本地 worktree 规范

### 工作区拓扑

worktree 是本地检出环境，不是新的分支层级。远程有多少协作者分支，不等于本地需要多少 worktree。默认拓扑如下：

| 目录                                     | 生命周期         | Git 状态                     | 用途                                                                   |
| ---------------------------------------- | ---------------- | ---------------------------- | ---------------------------------------------------------------------- |
| `ivybm`                                  | 永久             | `main`                       | 同步可信基线、创建/审计 worktree、必要的 post-merge 验证；禁止日常开发 |
| `ivybm-task<编号>-<简述>`                | PR 批次周期      | `feat/task-<编号>-<简述>`    | 一个计划批次内的分阶段 Task 开发                                       |
| `ivybm-fix-<简述>` / `ivybm-docs-<简述>` | PR 周期          | `fix/<简述>` / `docs/<简述>` | 独立修复或文档改动                                                     |
| `ivybm-review-pr-<编号>`                 | 一次 PR 审查     | 默认 detached HEAD           | 审查协作者 PR、运行测试、验证合并风险                                  |
| `ivybm-poc-<简述>`                       | 最长一个决策周期 | `poc/<简述>`                 | 有明确问题和退出条件的实验，不直接合入 `main`                          |

每人同时最多保留 1 个主工作区、2 个开发类 worktree（PoC / hotfix 计入）和 2 个审查 worktree。无需长期 `develop`、integration、release、production 或“某协作者专用”工作区；`main` + GitHub PR + CI 是唯一集成基线。

### 创建开发 worktree

所有新工作从主工作区的最新 `origin/main` 创建。以下命令中的路径和分支必须保持一一对应：

```bash
cd /path/to/ivybm
git status --short --branch
git fetch --prune origin
git switch main
git pull --ff-only origin main
git worktree add -b feat/task-<编号>-<简述> ../ivybm-task<编号>-<简述> origin/main
bash scripts/install-git-hooks.sh
```

创建后在新 worktree 执行 `pnpm install --frozen-lockfile`，再配置该工作区自己的本地环境。首次 push 使用 `git push -u origin HEAD`，并确认 `git branch -vv` 显示的 upstream 与本地分支同名。禁止因为远程存在近似名称就复用错误 upstream。

PR 批次被依赖阻塞时可以保留第二个开发 worktree，但不能在一个分支中混入批次外的无关 Task。hotfix 也从最新 `origin/main` 创建 `fix/<简述>`，不设置长期 hotfix 工作区。

独立修复和文档改动沿用同一创建流程，只把目录 / 分支组合替换为 `ivybm-fix-<简述>` + `fix/<简述>` 或 `ivybm-docs-<简述>` + `docs/<简述>`。

### 创建 PR 审查 worktree

审查协作者 PR 时获取 GitHub PR head 并用 detached HEAD 创建临时工作区，避免污染作者分支或本地分支列表：

```bash
cd /path/to/ivybm
git fetch --prune origin
git fetch origin pull/<PR编号>/head:refs/review/pr-<PR编号>-head
git worktree add --detach ../ivybm-review-pr-<PR编号> refs/review/pr-<PR编号>-head
git merge-tree --write-tree origin/main refs/review/pr-<PR编号>-head
```

审查 worktree 只用于读取、测试和生成审查证据。默认不提交、不 push、不改写协作者分支；需要修复时由作者更新原 PR，或在明确授权后从 PR head 创建单独短分支。作者推送新提交后，移除并按最新 head 重建审查 worktree，避免使用强制 reset 掩盖本地残留。

审查至少核对：PR base/head、完整 diff、共享结构和跨人契约、migration 线性历史、对应测试、CI、回滚边界。涉及 migration 的测试使用一次性数据库，不连接 production 或其他开发 worktree 的数据库。

### 运行时隔离

- 每个并行 worktree 使用唯一的应用端口、Compose project name、数据库名和测试数据库名；不具备这些隔离条件时，同一时间只运行一个本地栈。
- 每个 worktree 还必须使用唯一的 PostgreSQL host port；local/CI migration、seed、E2E 和脚本禁止连接 production 数据库、uploads、备份或真实外部 token。
- 每个 worktree 单独维护被 Git 忽略的 `.env`；密钥只能来自受控本地来源，不复制到文档、日志或 PR。不得让 worktree 共享可写 `.env`、`.next`、media、uploads 或数据库目录。
- pnpm 的全局内容寻址 store 可以复用，但每个 worktree 单独安装自己的 `node_modules`，避免 lockfile 或依赖状态串扰。
- 开发服务器、worker 和 Compose 服务启动后要能从目录名或 project name 识别归属；结束任务时停止对应进程和容器，不影响其他 worktree。

### 合并后的清理

开发分支只有在 worktree 干净且提交已进入 `origin/main` 时才清理：

```bash
git -C ../ivybm-task<编号>-<简述> status --short
git fetch --prune origin
git merge-base --is-ancestor feat/task-<编号>-<简述> origin/main
git worktree remove ../ivybm-task<编号>-<简述>
git branch -d feat/task-<编号>-<简述>
git worktree prune
```

任何一步不满足都停止清理并人工确认。禁止用 `rm -rf`、Finder 或文件管理器直接删除已注册 worktree；禁止自动删除 dirty、未 push 或未合并分支。远程分支由 PR 作者或仓库负责人确认 PR 已合并后删除。

PR 审查结束或 PR 关闭后立即清理临时工作区和本地 review ref：

```bash
git -C ../ivybm-review-pr-<PR编号> status --short
git worktree remove ../ivybm-review-pr-<PR编号>
git update-ref -d refs/review/pr-<PR编号>-head
git worktree prune
```

每周从 `ivybm` 执行一次只读审计：

```bash
git fetch --prune origin
git worktree list
git branch -vv
git branch --merged origin/main
git worktree prune --dry-run
```

审计发现目录用途、分支名和 upstream 不一致时，先停止 push 和清理，核对提交归属后再处理。

## PR 与 Review

- 仓库保持 private。当前 GitHub 免费私有仓库无法启用原生 branch protection，因此使用项目规则 + PR 流程 + CODEOWNERS + 本地 `pre-push` hook 形成多层约束。
- 每位开发者首次 clone 后运行 `bash scripts/install-git-hooks.sh`。该 hook 会阻止本机直接 push `main`；紧急绕过必须获得明确授权，并使用 `IVYBM_ALLOW_MAIN_PUSH=1`，事后补 PR 或记录。
- 不直接 push 到 `main`，一律走 PR。合并前本地运行 `pnpm lint && pnpm typecheck && pnpm test:unit`；涉及数据库 / 契约测试的任务额外运行对应命令，并把结果贴在 PR 描述中。
- GitHub 管理员仍具有平台侧绕过能力，因此本方案不能等同于服务端 branch protection；若后续升级 GitHub Pro，再启用服务端强制门禁。
- PR 分为“负责人自检合并”和“另一名开发者 review”两条路径。项目初始化、CI、工程配置、文档，以及负责人自己板块内的独立改动，在 CI 通过、PR 清单完成、作者逐项检查完整 diff，且不满足下述强制 review 条件时，可以由负责人自行合并。作者不能在 GitHub 上批准自己的 PR；这里的“自检合并”是完成自检并在 PR 中记录依据后直接合并，不伪装成独立审批。
- 出现以下任一情况时，必须等另一名开发者 review 后才能合并：修改 `src/payload.config.ts`、migration，或共享 Collection（`Leads`、`Conversations`、`Messages`、`GeneratedContents`、`ContentReviews`、`PublishJobs`、`PublishLogs`）；修改供另一人任务消费的公共接口、字段或契约；跨越双方板块边界，或实质影响另一人的在途任务。拿不准是否属于共享边界时，默认走另一人 review。
- 负责人自检合并时，在 PR 描述或评论中明确记录“不涉及共享结构、跨人契约或协作者范围”，并保留对应测试与 CI 结果。CODEOWNERS 只为已列出的共享文件自动请求关注，不再为普通自有范围 PR 默认请求双方 review；公共契约、跨板块边界和对在途任务的影响无法完全依赖路径识别，PR 作者必须人工判断并请求另一名开发者 review。
- PR 描述引用该批次覆盖的全部 Task 编号，方便对照实施计划里的验证步骤。

### PR 粒度、Draft / Ready 与自动 CI

- PR 以“一个业务 / 工程目标 + 一个实施计划 + 一致的 Review 边界 + 可一起回滚 / 发布”为默认边界。满足这四项的方案、实现、测试和验证记录放在一个 Draft PR，用分阶段 commit 保持可审，不额外拆成方案 PR、代码 PR、验证 PR。
- 只有变更属于独立任务、负责人或强制 Review 边界不同、需要独立回滚 / 发布，或完整 diff 已明显超出一次有效 Review 的规模时才拆分。反向约束同样成立：不得为减少 PR 数量把无关 Task、临时清理或顺手重构塞入当前 PR。
- 本地完整门禁、PR 描述、测试记录、风险 / 回滚、共享边界和 Review 请求全部完成，并得到当前任务级明确授权时，人工和 AI 可以直接创建 Ready PR。否则必须从 Draft 开始并保持到真实 Ready 检查点，禁止 Draft 创建后几十秒内立即转 Ready；Ready 后需要连续大改时先转回 Draft。
- 每次 push 前先运行本地定向验证，同一轮细小修改必须集中完成后一次 push；不要用 GitHub Actions 逐提交试错。
- CI 自动按路径分类，作者不选择 Fast / Full 档次，也不得使用 `[skip ci]`。Draft 代码运行 Fast CI；Ready 和 `main` 针对当前 head 运行数据库、build、E2E、operations 等适用门禁；未知路径或 diff / 分类失败走完整 fallback。
- 稳定的 `CI policy` 汇总 job 必须由 base-owned 的 `pull_request_target` workflow 负责核对预期 job；候选分支 `pull_request` 运行只能提供诊断，不能授权合并。Review 与合并前必须记录并复核当前 base / head SHA，只接受当前 head 的成功 policy；Draft Fast-only、旧 head、pending、neutral、skipped、cancelled 或 failure 都不是合并证据。Ready 后的新提交会使旧结论失效并重新运行门禁。
- `.github/workflows/**`、`scripts/ci/**`、policy 和 production image 触发边界必须由另一名开发者独立 Review。docs-only 轻量检查不豁免共享结构 / 跨人边界 Review；镜像成功只提供不可变 SHA + digest，不授权 production 部署。

本项目内的编码代理还必须遵守 `AGENTS.md`；Claude Code 同时读取 `CLAUDE.md`。这些文件用于阻止代理主动直推，并统一人工操作预期。

## Migration 冲突处理

Payload / PostgreSQL 的 migration 按时间线性生成，两人各自本地生成会导致历史分叉：

1. 谁的 PR 先合并到 `main`，谁的 migration 文件先进历史。
2. 另一人合并前先 `git pull origin main`；如果 migration 冲突或依赖的表结构已变化，删除本地未合并的 migration，基于最新 `main` 重新执行 `pnpm db:migrate:create`。
3. 不手动编辑已合并进 `main` 的 migration 文件。

## 共享数据结构变更

`Leads`、`Conversations` / `Messages`、`GeneratedContents` / `ContentReviews` / `PublishJobs` / `PublishLogs` 是两人板块之间的接口（对应需求文档"合作开发者交接说明"提到的三个基础数据结构）。改动这些 Collection 的字段前先口头对齐，不单方面改动后直接合并。

### Task 9 / Task 12 前后端协作边界

一期平台范围冻结如下：会话仅为 Facebook Messenger、Instagram DM（企业 / 商业账号）和 TikTok 私信（商业账号）；图文发布仅为 Facebook、Instagram（企业账号）和 LinkedIn（账号类型不限制，但 API 发布权限仍需验证）。WhatsApp 不纳入一期系统 connector、Webhook、自动回复或发布能力，二期再评估网页插件等替代接入；官网静态外链不等于系统接入。

| 任务    | jueyunai                                                                                                                                                              | xuemusi                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Task 9  | 官网 `ChatWidget`、Portal Core 公共交互契约、整体 IA/视觉/集成验收；使用 `ChatService` mock                                                                           | 统一会话/接管界面、会话/AI 服务、接管状态机/幂等/权限/审计/领域事件、`Conversations` / `Messages` / `Handoffs` 集成和 contract fixture |
| Task 12 | AI 内容工作台页面、内容生成/人工审核流程、状态机、`GeneratedContents` / `ContentReviews` / `PublishJobs` / `PublishLogs`，以及 Portal Core、素材/CMS 读模型和整体集成 | 平台 capability / publish / status、账号 readiness、第三方 adapter、结果回调和真实发布执行                                             |

跨边界开发必须先提交并 review TypeScript port/interface、请求响应 schema、错误码、状态枚举和 mock 行为。消费者先用 fake service 开发，服务提供者先用 fake repository / 官方 fixture 实现；真实数据库和平台 adapter 在对应 Collection、migration、Payload 类型和 production 或等价受控真实环境条件满足后接入。

人工接管由服务端维护权威状态，官网、运营后台和社媒连接器只能通过 `ChatService` 命令接口表达请求。前端不得直接修改 `handoffStatus`、`assignedTo` 或审计字段；服务端进入 `human_active` 后必须阻止 AI 自动回复，并通过领域事件把通知和补偿交给 Task 10 / 11。完整决策见 [`ADR-0001`](docs/architecture/adr/0001-human-handoff-domain-boundary.md)。社媒 AI 出站投递的分阶段边界见 [`ADR-0003`](docs/architecture/adr/0003-social-conversation-outbound-delivery.md)：无授权时只能持久人工接管，不能伪造已发送回复。

依赖分三个阶段处理：

1. **接口 / 纯逻辑阶段**：允许使用 TypeScript port/interface、fake repository、mock 和官方结构 fixture 并行开发。jueyunai 的官网 ChatWidget 先使用 `ChatService` mock，xuemusi 的 Task 9 统一会话使用对应 fake service/repository；jueyunai 的 Task 12 内容工作台消费双方冻结的 `PublishingService` mock；Task 13 在这一阶段可实现连接器接口、Webhook 验签、时间戳、事件幂等、payload 归一化，以及 Facebook Messenger / Instagram DM / TikTok 私信与 Facebook / Instagram / LinkedIn 图文发布的 mock。社媒会话可额外冻结 server-only outbound port、fake 与失败注入契约，但不得发网络请求、写入“已发送”状态或创建临时 `Leads`、`Conversations`、`Messages`、`PublishJobs` 或 `PublishLogs`，不生成替代 migration。
2. **数据库集成阶段**：必须等待对应 Collection、migration、`src/payload.config.ts` 注册和 `src/payload-types.ts` 生成类型全部合并到 `main`，再从最新 `origin/main` 更新分支并实现 adapter。Task 9 服务读写 Task 7 的 `Leads`；Task 13 会话侧读写 Task 9 的 `Conversations` / `Messages`，发布侧读写 Task 12 的 `PublishJobs` / `PublishLogs`。社媒自动回复由 `ConversationService` 创建稳定内部回复身份和 delivery intent；在入队和 worker 发送前由权威会话状态二次允许。delivery intent / outbox 持有 `queued`、`retrying`、`blocked`、`failed`、`dead`、`delivery_unknown` 等业务状态，adapter 结果只能回到权威服务归并。它和真实 Webhook 异步处理、发布执行、失败重试、dead job 和人工补偿都必须等待 Task 10 的 `Jobs` Collection、worker、migration、Payload 注册和生成类型合并，且需要已合并的 `PlatformAccounts` / 凭据结构。纯连接器和 fixture 测试不依赖 Task 10。
   Portal V1 同一 Draft PR 内可以在前置 checkpoint 已完成完整 Collection、migration、Payload 注册、生成类型和定向测试后继续实现消费者，不为制造 main gate 机械拆 PR；跨 PR、Task 13、worker 或真实外部执行仍严格遵守上述 main gate，且共享结构与 adapter 必须由另一人 review。
3. **外部平台联调阶段**：需要甲方账号资产、平台授权和 production 的受控发布窗口。条件满足时实测 Facebook Messenger / Instagram DM / TikTok 私信 Webhook、入站消息和 Facebook / Instagram / LinkedIn 图文测试发布；条件缺失时以 fixture 契约测试、模拟记录、配置说明和阻塞证据按一期 P1 口径验收。WhatsApp 与其他未列平台为二期，不进入一期状态矩阵。fixture / mock 通过只代表接口契约完成，不得据此把平台标记为 `available`。

## 发布

CI/CD 与发布回滚流程见架构文档 [16.8 节](docs/architecture/一期技术选型与部署架构规划.md#L543)：CI 构建并推送 SHA tag + digest 镜像 → 负责人通过 1Panel 手动 pull / redeploy production → 健康检查与 smoke test。协作分工不改变这部分设计，production 发布审批人固定为 jueyunai；一期上线验收仍需两人共同确认，不适用负责人自检合并规则。

## 分工速查

| 板块                   | 负责人                                         |
| ---------------------- | ---------------------------------------------- |
| 官网与 CMS             | jueyunai                                       |
| SEO / GEO 基础         | jueyunai                                       |
| AI 客服与知识库        | xuemusi；jueyunai 只负责官网 ChatWidget 与基座 |
| 社媒会话与平台发布服务 | xuemusi                                        |
| 飞书 CRM               | jueyunai                                       |
| AI 内容工作台          | jueyunai；平台发布服务由 xuemusi 提供          |
| Portal Core/素材/设置  | jueyunai                                       |

"方案梳理与竞品调研"和"第一批部署上线、培训与试运营修复"不属于以上 6 个板块，统一由 jueyunai 收尾；上线验收需两人共同确认。
