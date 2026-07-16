# 协作与分支规范

本文档约定两名开发者在同一个仓库上的协作方式。板块级分工见 [`docs/requirements/一期需求说明文档.md`](docs/requirements/一期需求说明文档.md#L495) 第10节；任务级排期和负责人见 [`docs/plans/2026-07-16-一期开发实施计划.md`](docs/plans/2026-07-16-一期开发实施计划.md) 里程碑表。

## 分支策略

采用主干开发（trunk-based），不使用长期个人分支——两人各开一条贯穿全程的分支、最后合并的方式，会把所有冲突推到最后一次性爆发，改用短分支高频合并可以把冲突拆小。

- 只有一条长期分支：`main`。`main` 始终保持可构建、可部署状态，不直接 push。
- 每个开发任务从 `main` 拉一条短分支，粒度对应实施计划里的一个 Task（预计 1-4 天），完成后立即开 PR 合并回 `main`，不跨多个 Task 累积改动。
- 分支命名：`feat/task-<编号>-<简述>`，例如 `feat/task-8-knowledge-base`；修复用 `fix/...`。
- 开工前先 `git pull origin main`，确保基于最新代码开分支。

## PR 与 Review

- `main` 开启分支保护：禁止直接 push，合并前必须 PR + CI（lint / typecheck / test）通过。
- 两人互相 review 对方 PR；改动涉及共享 Collection（`Leads`、`Conversations`、`Messages`、`GeneratedContents`、`PublishJobs`）或 `src/payload.config.ts` 时，必须等另一人 review 后才能合并——这几个文件改动频率高，是最容易冲突的地方。
- PR 描述引用对应 Task 编号，方便对照实施计划里的验证步骤。

## Migration 冲突处理

Payload / PostgreSQL 的 migration 按时间线性生成，两人各自本地生成会导致历史分叉：

1. 谁的 PR 先合并到 `main`，谁的 migration 文件先进历史。
2. 另一人合并前先 `git pull origin main`；如果 migration 冲突或依赖的表结构已变化，删除本地未合并的 migration，基于最新 `main` 重新执行 `pnpm db:migrate:create`。
3. 不手动编辑已合并进 `main` 的 migration 文件。

## 共享数据结构变更

`Leads`、`Conversations` / `Messages`、`GeneratedContents` / `PublishJobs` 是两人板块之间的接口（对应需求文档"合作开发者交接说明"提到的三个基础数据结构）。改动这些 Collection 的字段前先口头对齐，不单方面改动后直接合并。

已知强依赖：Task 9（AI 客服与意向评分）读写 Task 7（询盘表单与线索模型）创建的 `Leads`，Task 9 必须等 Task 7 合并到 `main` 才能开始；Task 13（平台连接器）的发布侧依赖 Task 12（内容工作台）产出的 `PublishJobs`。

## 发布

CI/CD 与发布回滚流程见架构文档 [16.8 节](docs/architecture/一期技术选型与部署架构规划.md#L523)：CI 构建镜像 → staging 验证 → 人工批准 → production。协作分工不改变这部分设计，production 发布审批人固定为 jueyunai。

## 分工速查

| 板块 | 负责人 |
|---|---|
| 官网与 CMS | jueyunai |
| SEO / GEO 基础 | jueyunai |
| AI 客服与知识库 | xuemusi |
| 社媒会话与发布 | xuemusi |
| 飞书 CRM | jueyunai |
| 内容工作台 | jueyunai |

"方案梳理与竞品调研"和"第一批部署上线、培训与试运营修复"不属于以上 6 个板块，统一由 jueyunai 收尾；上线验收需两人共同确认。
