# GitHub Actions 用量优化设计

## 背景

IVYBM 是私有仓库，GitHub-hosted runner 会消耗账号的 Actions 分钟数并在超出套餐额度后计费。当前 `.github/workflows/ci.yml` 对每次 PR `opened` / `synchronize` / `reopened` 和每次 `main` push 都运行同一个完整 `Quality gate`：PostgreSQL service、依赖安装、lint、typecheck、全量 unit / contract、migration、测试库 reset、双次 seed、integration、Compose 持久化、production build、Playwright 浏览器安装与 E2E、runtime / worker 两次 Docker build、Compose 配置和 operations 测试。成功的 `main` CI 随后还会触发 `.github/workflows/build-image.yml`，再次构建并推送 runtime / worker 镜像。

2026-07-28 的近期运行显示，完整 CI 通常约 8-10 分钟，production image workflow 约 3-4 分钟。纯文档 PR 也会经历 PR CI、合并后的 main CI 和 production image build，单次可消耗约 20 分钟；需要多轮 Review 修复的代码 PR 会在每次 push 后重复完整门禁。现有 `concurrency.cancel-in-progress: true` 能取消尚未结束的旧运行，但不能避免已经完成后又因下一次 push 重新执行的全套检查。

## 目标

1. 在不降低 `main` 可构建、可部署约束的前提下，减少私有仓库 Actions 用量。
2. CI 自动根据变更路径选择必要检查，PR 作者和 AI 不手工挑选测试档次。
3. 使用 GitHub 原生 Draft / Ready for review 表达“仍在迭代”与“准备合并”，避免引入难理解的自定义标签协议。
4. 所有合并判断绑定 PR 最新 head SHA；旧 head、cancelled、skipped 或未完成的结果不能作为合并依据。
5. docs-only 合并不构建 production image；生产相关代码合并后只构建一次 runtime / worker 镜像。
6. 把 AI 提交、审核、合并 PR 的行为约束写入 `AGENTS.md`、`CLAUDE.md`、`CONTRIBUTING.md` 和 PR 模板。

## 非目标

- 不把仓库改为 public。
- 不使用 production 服务器作为 self-hosted runner。
- 不通过 `[skip ci]`、临时删除测试或降低断言来节省分钟数。
- 不取消 migration、integration、E2E、operations 或 production build 的最终门禁。
- 不让 AI 根据主观判断跳过共享结构 Review、独立开发者 Review 或 production 人工审批。
- 不在第一版实现自动生成测试依赖图、按单个 TypeScript import 精确选择测试或复杂的 PR comment bot。

## 方案比较

### 方案 A：每次 push 都运行完整门禁

优点是规则简单、风险低；缺点是当前费用问题完全不改善。现状已经证明 docs-only 和 Review 迭代会反复消耗 8-10 分钟，拒绝采用。

### 方案 B：使用 `ci:full` 标签或手动 workflow_dispatch

可精确控制完整门禁次数，但需要 PR 作者记住额外协议；标签在新提交后是否仍代表最新 head 也需要额外自动化维护。对于主要由 AI 创建和审核 PR 的两人项目，容易出现标签遗留或忘记触发，暂不采用。

### 方案 C：自动路径分级 + Draft / Ready 生命周期

这是采用方案。CI 自动分类文件；Draft PR 只运行快速反馈，Ready PR 对最新 head 自动运行完整门禁。Ready 后的新提交会再次触发门禁，确保结果不陈旧；如果需要连续大改，PR 必须重新转为 Draft。该方案使用 GitHub 原生状态，AI 和人工都容易核验。

## 工作流架构

### 1. 变更分类

新增无第三方网络依赖的 Node.js 脚本 `scripts/ci/classify-changes.mjs`。脚本只接收 Git diff 的路径列表并输出稳定布尔标记，核心分类如下：

| 分类 | 典型路径 | 作用 |
| --- | --- | --- |
| `docs_only` | `docs/**`、根目录 Markdown、设计说明、PR 模板 | 只运行文档 / diff 检查 |
| `code` | `src/**`、`tests/**`、运行脚本、项目配置 | 运行 Fast CI |
| `database` | Collections、migrations、Payload config/types、数据库脚本和 integration 测试 | 启用数据库完整门禁 |
| `ui_e2e` | App、components、admin、样式、Playwright / E2E | 安装 Chromium 并运行相关 E2E |
| `operations` | Dockerfile、Compose、`docker/**`、workflows、CI / operations / smoke 脚本 | 运行 CI policy、容器或 operations 检查 |
| `production_image` | runtime / worker 会包含的源码、依赖、Dockerfile、构建配置和 migration | main 成功后构建生产镜像 |
| `full_fallback` | 未识别且可能影响运行时的路径 | 保守运行完整门禁并视为镜像候选 |

分类器必须是纯函数并有单元测试。空 diff、无法确定 base、未知路径或分类器异常一律设置 `full_fallback=true`，不能静默降级为轻量 CI。

### 2. PR Draft 阶段

AI 和人工默认创建 Draft PR。每次 push 自动运行：

- checkout 和 `git diff --check`；
- docs-only 时只运行轻量检查；
- 代码变更运行依赖安装、lint、typecheck、unit 和 contract；
- 保留以 PR 编号为 key 的 concurrency，新 push 取消尚未结束的旧运行。

Draft 阶段不启动 PostgreSQL、不执行 seed / integration、不安装 Chromium、不构建 production、不构建 Docker image。Fast CI 用来提供开发反馈，不是合并授权。

### 3. PR Ready 阶段

PR 描述、测试记录、自检和 Review 请求齐全后，作者或负责 AI 将 PR 转为 Ready for review。`ready_for_review` 和之后的 `synchronize` 都会针对最新 head 运行：

- Fast CI；
- database / integration（数据库相关或 fail-safe）；
- production build（生产代码和构建配置相关）；
- E2E（UI、Admin、路由、Playwright 相关）；
- Docker / Compose / operations（容器和运维相关）；
- 一个稳定命名的 `CI policy` 汇总检查。

若 Ready 后需要多轮大改，应先转回 Draft。若保持 Ready，任何新 push 都会自动重跑相应完整门禁；这样更贵，但保证最新 head 的安全性。

### 4. main 与 production images

`main` push 继续运行自动分类和必要的最终验证。docs-only main 提交只运行轻量检查，不启动数据库或构建镜像。生产相关提交在 `CI policy` 成功后构建并推送一次 runtime / worker SHA tag + digest。

production image job 合并进同一受控 workflow，使用 job-level `packages: write`，PR job 始终只有只读权限。删除“PR / main Quality gate 先本地 Docker build 两次，随后 workflow_run 再重新 build / push 两次”的重复路径。Dockerfile / Compose 相关 Ready PR 仍需执行不 push 的镜像验证。已识别的 workflow / CI 分类器修改会运行 operations 和完整 policy，但不会仅因修改门禁文档或 YAML 发布业务镜像；只有生产路径或真正未知的 fail-safe 路径是镜像候选。

Buildx 使用 GitHub Actions cache，runtime 与 worker 共享稳定 scope。cache 只能优化构建速度，不能作为发布证据；发布摘要仍记录不可变 head SHA 和两个 digest。

### 5. 稳定的 CI policy

新增始终出现的汇总 job `CI policy`。它根据事件、Draft 状态和路径分类验证应运行的 job 是否成功：

- docs-only：轻量检查成功即可；
- Draft 代码：Fast CI 成功，但 PR 仍不可合并；
- Ready 代码：Fast CI 和所有必需的重型 job 成功；
- main：当前路径要求的最终验证成功；
- cancelled、failure、意外 skipped 或缺失输出均 fail closed。

当前私有仓库无法启用完整服务端 branch protection，因此 `CI policy` 由项目规则和 AI 审核流程强制执行。未来升级 GitHub 套餐后，可把该稳定 check 名称设为 required status check，而无需重新设计工作流。

## AI 与协作规则

### AI 创建和更新 PR

1. 默认使用 Draft PR；除非用户明确要求且本地验证、PR 描述与 Review 请求已经完成，不直接创建 Ready PR。
2. push 前运行 Task 对应的本地定向测试；GitHub CI 不是调试器。
3. 合并同一轮小修复后再 push，避免为每个细小编辑触发一次 Actions。
4. 不手工选择 CI 档次，不使用 `[skip ci]`；由路径分类器 fail-safe 决定。
5. PR 准备审核时更新测试记录、风险、回滚、共享结构边界和 Review 路径，再转为 Ready。
6. Ready 后需要连续修改时转回 Draft；完成后再次 Ready。
7. `.github/workflows/**`、CI 分类器或 CI policy 的修改必须由另一名开发者独立 Review。
8. 同一目标、实施计划、Review 边界和回滚 / 发布单元一致的方案、实现与验证默认放在一个 Draft PR，以分阶段 commit 保持可审；只有独立任务、不同负责人 / 强制 Review、独立回滚 / 发布或明显超出可审规模时才拆分，同时禁止把无关任务混入同一 PR。

### AI 审核和合并 PR

1. 记录审核时的 base、head SHA、mergeability、完整 diff、Review 状态和 CI policy。
2. 不批准 Draft PR，不把 Draft Fast CI 当成完整门禁。
3. 只接受与当前 PR head SHA 一致的成功结果；PR 更新后旧审批结论和旧 Full Gate 均需重新核对。
4. cancelled、skipped、pending、neutral 或旧 head 的检查不能当作成功。
5. docs-only 轻量门禁不改变共享结构、跨人契约和协作者边界的人工 Review 规则。
6. CI workflow、分类规则、required policy 或 production image 触发边界的修改不得负责人自检合并。
7. production image 成功不等于 production 部署授权；部署仍需 jueyunai 人工审批和既有 smoke / rollback 流程。

## 安全与故障处理

- 分类器不读取 secret、`.env`、数据库或客户资料，只处理仓库相对路径。
- 2026-08-09 起，PR 授权门禁按 [`CI 可信锚两阶段迁移计划`](2026-08-09-ci-trusted-bootstrap-plan.md) 改为 base-owned `pull_request_target`。该 workflow 只使用只读权限、无 secrets、无共享 main cache，并把 trusted control 与候选代码隔离；候选 `pull_request` 结果只能作为 diagnostics。
- PR job 不授予 `packages: write`；发布 job 只在可信 `main` push 且 policy 成功后运行。
- 无法获取 base SHA、Git 历史不足或路径超过分类能力时运行完整门禁。
- 工作流自身修改必须在 Draft PR 中先通过 Fast CI，再转 Ready 触发新 workflow 的完整验证。
- 如果线上验证发现分类器漏检，立即回退到全量 Quality gate，并通过独立 PR 修正规则。

## 验证矩阵

| 场景 | 预期 |
| --- | --- |
| Draft docs-only | 轻量检查；无 pnpm install、DB、Playwright、Docker、image publish |
| Ready docs-only | 轻量 policy 成功；仍无 production image |
| Draft TypeScript | Fast CI；无 DB / E2E / Docker |
| Draft 转 Ready | 当前 head 触发路径要求的完整门禁 |
| Ready 后 push | 旧运行取消或作废；新 head 重新运行 |
| migration / Payload config | DB、integration、build；并要求独立 Review |
| Admin / UI | build 与目标 E2E |
| Docker / Compose | container validation 与 operations |
| docs-only merge main | 轻量 main CI；不发布镜像 |
| runtime merge main | policy 成功后只发布一次 runtime / worker 镜像 |
| 未知路径 / diff 失败 | full fallback，不允许轻量通过 |

## 成功指标

- docs-only PR + main 从约 20 分钟降到 2-4 个 billable runner minutes，且不触发 production images。
- 多轮代码 Review 在 Draft 阶段只消耗 Fast CI，完整门禁主要发生在 Ready 最新 head。
- production runtime / worker 对每个生产相关 main SHA 只构建一次。
- 一个月后从 GitHub usage report 对比 PR 数量、CI runs、平均 billable minutes、cancelled runs 和 image builds；目标总 Actions 用量下降 50% 以上。
- `main` 仍满足现有 migration、integration、build、E2E、operations 与不可变镜像发布要求。
