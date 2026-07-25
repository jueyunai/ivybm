# 协作与分支规范

本文档约定两名开发者在同一个仓库上的协作方式。板块级分工见 [`docs/requirements/一期需求说明文档.md`](docs/requirements/一期需求说明文档.md#L495) 第10节；任务级排期和负责人见 [`docs/plans/2026-07-16-一期开发实施计划.md`](docs/plans/2026-07-16-一期开发实施计划.md) 里程碑表。

## 分支策略

采用主干开发（trunk-based），不使用长期个人分支——两人各开一条贯穿全程的分支、最后合并的方式，会把所有冲突推到最后一次性爆发，改用短分支高频合并可以把冲突拆小。

- 只有一条长期分支：`main`。`main` 始终保持可构建、可部署状态，不直接 push。
- 每个开发任务从 `main` 拉一条短分支，粒度对应实施计划里的一个 Task（预计 1-4 天），完成后立即开 PR 合并回 `main`，不跨多个 Task 累积改动。
- 分支命名：`feat/task-<编号>-<简述>`，例如 `feat/task-8-knowledge-base`；修复用 `fix/...`。
- 开工前先 `git pull origin main`，确保基于最新代码开分支。

## PR 与 Review

- 仓库保持 private。当前 GitHub 免费私有仓库无法启用原生 branch protection，因此使用项目规则 + PR 流程 + CODEOWNERS + 本地 `pre-push` hook 形成多层约束。
- 每位开发者首次 clone 后运行 `bash scripts/install-git-hooks.sh`。该 hook 会阻止本机直接 push `main`；紧急绕过必须获得明确授权，并使用 `IVYBM_ALLOW_MAIN_PUSH=1`，事后补 PR 或记录。
- 不直接 push 到 `main`，一律走 PR。合并前本地运行 `pnpm lint && pnpm typecheck && pnpm test:unit`；涉及数据库 / 契约测试的任务额外运行对应命令，并把结果贴在 PR 描述中。
- GitHub 管理员仍具有平台侧绕过能力，因此本方案不能等同于服务端 branch protection；若后续升级 GitHub Pro，再启用服务端强制门禁。
- PR 分为“负责人自检合并”和“另一名开发者 review”两条路径。项目初始化、CI、工程配置、文档，以及负责人自己板块内的独立改动，在 CI 通过、PR 清单完成、作者逐项检查完整 diff，且不满足下述强制 review 条件时，可以由负责人自行合并。作者不能在 GitHub 上批准自己的 PR；这里的“自检合并”是完成自检并在 PR 中记录依据后直接合并，不伪装成独立审批。
- 出现以下任一情况时，必须等另一名开发者 review 后才能合并：修改 `src/payload.config.ts`、migration，或共享 Collection（`Leads`、`Conversations`、`Messages`、`GeneratedContents`、`PublishJobs`、`PublishLogs`）；修改供另一人任务消费的公共接口、字段或契约；跨越双方板块边界，或实质影响另一人的在途任务。拿不准是否属于共享边界时，默认走另一人 review。
- 负责人自检合并时，在 PR 描述或评论中明确记录“不涉及共享结构、跨人契约或协作者范围”，并保留对应测试与 CI 结果。CODEOWNERS 只为已列出的共享文件自动请求关注，不再为普通自有范围 PR 默认请求双方 review；公共契约、跨板块边界和对在途任务的影响无法完全依赖路径识别，PR 作者必须人工判断并请求另一名开发者 review。
- PR 描述引用对应 Task 编号，方便对照实施计划里的验证步骤。

本项目内的编码代理还必须遵守 `AGENTS.md`；Claude Code 同时读取 `CLAUDE.md`。这些文件用于阻止代理主动直推，并统一人工操作预期。

## Migration 冲突处理

Payload / PostgreSQL 的 migration 按时间线性生成，两人各自本地生成会导致历史分叉：

1. 谁的 PR 先合并到 `main`，谁的 migration 文件先进历史。
2. 另一人合并前先 `git pull origin main`；如果 migration 冲突或依赖的表结构已变化，删除本地未合并的 migration，基于最新 `main` 重新执行 `pnpm db:migrate:create`。
3. 不手动编辑已合并进 `main` 的 migration 文件。

## 共享数据结构变更

`Leads`、`Conversations` / `Messages`、`GeneratedContents` / `PublishJobs` / `PublishLogs` 是两人板块之间的接口（对应需求文档"合作开发者交接说明"提到的三个基础数据结构）。改动这些 Collection 的字段前先口头对齐，不单方面改动后直接合并。

### Task 9 / Task 12 前后端协作边界

一期平台范围冻结如下：会话仅为 Facebook Messenger、Instagram DM（企业 / 商业账号）和 TikTok 私信（商业账号）；图文发布仅为 Facebook、Instagram（企业账号）和 LinkedIn（账号类型不限制，但 API 发布权限仍需验证）。WhatsApp 不纳入一期系统 connector、Webhook、自动回复或发布能力，二期再评估网页插件等替代接入；官网静态外链不等于系统接入。

| 任务    | jueyunai                                                                                                                          | xuemusi                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Task 9  | 官网 `ChatWidget`、运营会话/接管界面、交互状态、前端 E2E；使用 `ChatService` mock                                                 | 会话/AI 服务、接管状态机/幂等/权限/审计/领域事件、`Conversations` / `Messages` / `Handoffs` 集成；提供 contract fixture |
| Task 12 | 内容工作台页面、内容生成/审核 UI、内部状态流、`PublishJobs` / `PublishLogs` 共享结构和发布任务创建；使用 `PublishingService` mock | 第三方平台 capability / publish / status API、平台 adapter、发布结果回调；不把平台 SDK / token 暴露给前端               |

跨边界开发必须先提交并 review TypeScript port/interface、请求响应 schema、错误码、状态枚举和 mock 行为。消费者先用 fake service 开发，服务提供者先用 fake repository / 官方 fixture 实现；真实数据库和平台 adapter 在对应 Collection、migration、Payload 类型和 staging 条件满足后接入。

人工接管由服务端维护权威状态，官网、运营后台和社媒连接器只能通过 `ChatService` 命令接口表达请求。前端不得直接修改 `handoffStatus`、`assignedTo` 或审计字段；服务端进入 `human_active` 后必须阻止 AI 自动回复，并通过领域事件把通知和补偿交给 Task 10 / 11。完整决策见 [`ADR-0001`](docs/architecture/adr/0001-human-handoff-domain-boundary.md)。社媒 AI 出站投递的分阶段边界见 [`ADR-0003`](docs/architecture/adr/0003-social-conversation-outbound-delivery.md)：无授权时只能持久人工接管，不能伪造已发送回复。

依赖分三个阶段处理：

1. **接口 / 纯逻辑阶段**：允许使用 TypeScript port/interface、fake repository、mock 和官方结构 fixture 并行开发。Task 9 前端先使用 `ChatService` mock，Task 12 前端先使用 `PublishingService` mock；Task 13 在这一阶段可实现连接器接口、Webhook 验签、时间戳、事件幂等、payload 归一化，以及 Facebook Messenger / Instagram DM / TikTok 私信与 Facebook / Instagram / LinkedIn 图文发布的 mock。社媒会话可额外冻结 server-only outbound port、fake 与失败注入契约，但不得发网络请求、写入“已发送”状态或创建临时 `Leads`、`Conversations`、`Messages`、`PublishJobs` 或 `PublishLogs`，不生成替代 migration。
2. **数据库集成阶段**：必须等待对应 Collection、migration、`src/payload.config.ts` 注册和 `src/payload-types.ts` 生成类型全部合并到 `main`，再从最新 `origin/main` 更新分支并实现 adapter。Task 9 服务读写 Task 7 的 `Leads`；Task 13 会话侧读写 Task 9 的 `Conversations` / `Messages`，发布侧读写 Task 12 的 `PublishJobs` / `PublishLogs`。社媒自动回复必须在入队和 worker 发送前由权威会话状态二次允许；它和真实 Webhook 异步处理、发布执行、失败重试、dead job 和人工补偿都必须等待 Task 10 的 `Jobs` Collection、worker、migration、Payload 注册和生成类型合并，且需要已合并的 `PlatformAccounts` / 凭据结构。纯连接器和 fixture 测试不依赖 Task 10。
3. **外部平台联调阶段**：需要甲方账号资产、平台授权和 production 的受控发布窗口。条件满足时实测 Facebook Messenger / Instagram DM / TikTok 私信 Webhook、入站消息和 Facebook / Instagram / LinkedIn 图文测试发布；条件缺失时以 fixture 契约测试、模拟记录、配置说明和阻塞证据按一期 P1 口径验收。WhatsApp 与其他未列平台为二期，不进入一期状态矩阵。fixture / mock 通过只代表接口契约完成，不得据此把平台标记为 `available`。

## 发布

CI/CD 与发布回滚流程见架构文档 [16.8 节](docs/architecture/一期技术选型与部署架构规划.md#L543)：CI 构建并推送 SHA tag + digest 镜像 → 负责人通过 1Panel 手动 pull / redeploy production → 健康检查与 smoke test。协作分工不改变这部分设计，production 发布审批人固定为 jueyunai；一期上线验收仍需两人共同确认，不适用负责人自检合并规则。

## 分工速查

| 板块            | 负责人                                    |
| --------------- | ----------------------------------------- |
| 官网与 CMS      | jueyunai                                  |
| SEO / GEO 基础  | jueyunai                                  |
| AI 客服与知识库 | xuemusi（服务）/ jueyunai（官网 UI）      |
| 社媒会话与发布  | xuemusi（平台服务）/ jueyunai（发布页面） |
| 飞书 CRM        | jueyunai                                  |
| 内容工作台      | jueyunai                                  |

"方案梳理与竞品调研"和"第一批部署上线、培训与试运营修复"不属于以上 6 个板块，统一由 jueyunai 收尾；上线验收需两人共同确认。
