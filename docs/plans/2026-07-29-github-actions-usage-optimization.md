# GitHub Actions 用量优化实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 IVYBM 私有仓库 CI 改为自动路径分级、Draft Fast CI、Ready Full Gate 和按生产影响发布镜像，在保留最终质量门禁的前提下降低 Actions 用量。

**Architecture:** 使用一个无外部依赖、fail-safe 的 Node.js 路径分类器生成 workflow job outputs；PR 的 Draft / Ready 状态决定快速反馈或完整门禁，路径分类决定数据库、E2E、容器和镜像步骤。稳定的 `CI policy` 汇总 job 绑定最新 head，production image job 只在生产相关 `main` 提交且 policy 成功后执行。

**Tech Stack:** GitHub Actions、Node.js 24、pnpm 10、Vitest、PostgreSQL 18.4 + pgvector、Playwright、Docker Buildx、GHCR。

---

### Task 1：冻结用量基线和分类契约

**Files:**

- Create: `scripts/ci/classify-changes.mjs`
- Create: `tests/unit/ci-change-classifier.test.ts`
- Modify: `docs/开发进度.md`

**Step 1: 记录基线**

在 `docs/开发进度.md` 记录 2026-07-28 近期观察值：完整 CI 约 8-10 分钟，production images 约 3-4 分钟，docs-only PR 会重复经历 PR CI、main CI 和 image build。只记录汇总，不提交 GitHub usage CSV、账号账单或截图。

**Step 2: 写分类器失败测试**

为纯函数 `classifyChangedFiles(paths)` 写表驱动测试，至少覆盖：

- `docs/guide.md` -> `docsOnly=true`，其余重型标记 false；
- `src/modules/platforms/types.ts` -> code / contract / production build；
- `src/payload.config.ts`、`src/migrations/*` -> database / integration / production image；
- `src/admin/**`、`src/app/**`、`tests/e2e/**` -> UI E2E；
- `Dockerfile`、`compose.prod.yaml`、`tests/operations/**` -> operations / container；
- `.github/workflows/ci.yml`、`scripts/ci/**` -> code / operations，但不发布业务镜像；
- 未知根文件 -> `fullFallback=true` 并视为镜像候选；
- 空数组、非法绝对路径、`../` traversal -> fail closed。

Run:

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/unit/ci-change-classifier.test.ts
```

Expected: FAIL，分类器文件尚不存在。

**Step 3: 实现纯分类器和 CLI**

`scripts/ci/classify-changes.mjs` 必须：

- 导出 `classifyChangedFiles(paths)`；
- 规范化 POSIX 仓库相对路径；
- 拒绝绝对路径、空路径和 traversal；
- 输出 `docs_only`、`code`、`database`、`ui_e2e`、`operations`、`production_image`、`full_fallback`；
- 支持从 stdin 读取 NUL 分隔的路径；
- 在 `GITHUB_OUTPUT` 存在时写入小写字符串布尔值；
- 任何解析异常输出完整 fallback 并以非零退出。

**Step 4: 运行分类测试**

Run:

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/unit/ci-change-classifier.test.ts
pnpm lint
pnpm typecheck
```

Expected: PASS；分类器不访问网络和 secret。

**Step 5: Commit**

```bash
git add scripts/ci/classify-changes.mjs tests/unit/ci-change-classifier.test.ts docs/开发进度.md
git commit -m "test(ci): define change classification policy"
```

### Task 2：重构 PR Draft / Ready 门禁

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `tests/unit/ci-change-classifier.test.ts`

**Step 1: 扩展 pull_request 事件**

将触发器显式设置为：

```yaml
pull_request:
  types: [opened, synchronize, reopened, ready_for_review, converted_to_draft]
push:
  branches: [main]
```

保留按 PR 编号 / ref 分组的 concurrency 和 `cancel-in-progress: true`。

**Step 2: 新增 changes job**

`changes` job 使用 full-history checkout 或显式 fetch base/head：

- PR 使用 `base.sha...head.sha`；
- main push 使用 `before..sha`；
- `before` 为全零、base 不可解析或 diff 失败时设置 full fallback；
- 将 NUL 分隔路径传给分类器；
- job 不安装项目依赖、不启动数据库。

Expected: docs-only 也只消耗最小 runner 启动时间。

**Step 3: 新增 docs-check job**

当 `docs_only == 'true'` 时运行：

```bash
git diff --check <base> <head>
```

同时确认仓库没有新提交 `.env`、数据库、uploads 或备份路径。不得因为 docs-only 自动认定可负责人自检；Review 路径仍由变更内容决定。

**Step 4: 新增 fast job**

当 `code == 'true'` 或 `full_fallback == 'true'` 时运行：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
```

Draft 与 Ready 都必须跑 Fast CI。该 job 不声明 PostgreSQL service。

**Step 5: 新增 full-gate job**

只在以下条件运行：

- PR 且 `github.event.pull_request.draft == false`；或
- `push` 到 `main`；
- 并且不是 docs-only，或启用了 full fallback。

保留当前临时 PostgreSQL service 和无真实 secret 的 CI 环境。按分类执行：

- database / fallback：migration、reset、双次 seed、integration、Compose persistence；
- production code / fallback：`pnpm build`；
- ui_e2e / fallback：安装 Chromium并运行目标 E2E；
- operations / fallback：Compose config、operations 测试和 PR container validation。

Ready 的未知路径必须跑完整现有门禁。

**Step 6: 新增 CI policy 汇总**

`CI policy` 使用 `if: always()` 和 `needs` 结果验证：

- 应运行 job 必须为 `success`；
- 合法不适用 job 可为 `skipped`；
- failure、cancelled、缺失分类输出或意外 skipped 以非零退出；
- Draft 运行必须在 summary 标明“Fast CI only; not merge-ready”；
- summary 记录 event、Draft / Ready、head SHA 和启用分类，不记录 secret。

**Step 7: 本地静态验证**

Run:

```bash
pnpm exec prettier --check .github/workflows/ci.yml
pnpm exec vitest run --config ./vitest.config.mts tests/unit/ci-change-classifier.test.ts
git diff --check
```

Expected: PASS；YAML 缩进、表达式和分类测试有效。

**Step 8: Commit**

```bash
git add .github/workflows/ci.yml tests/unit/ci-change-classifier.test.ts
git commit -m "ci: split draft and ready quality gates"
```

### Task 3：消除重复镜像构建并限制 main 发布

**Files:**

- Modify: `.github/workflows/ci.yml`
- Delete: `.github/workflows/build-image.yml`
- Modify: `scripts/ci/classify-changes.mjs`
- Modify: `tests/unit/ci-change-classifier.test.ts`

**Step 1: 写 production image 路径测试**

覆盖以下行为：

- `docs/**`、测试记录、PR 模板不发布镜像；
- `tests/**` 单独变化不发布镜像；
- `src/**`、`src/migrations/**`、`package.json`、`pnpm-lock.yaml`、`Dockerfile`、Next / Payload 构建配置发布镜像；
- workflow / classifier 自身变化触发 operations / full policy，但不发布业务镜像；
- 未知运行时根文件 fail closed 为发布候选。

**Step 2: 把 publish job 并入 CI**

新增 `publish-production-images` job：

- 只允许 `github.event_name == 'push' && github.ref == 'refs/heads/main'`；
- 需要 `changes` 和 `CI policy` 成功；
- 需要 `production_image == 'true'`；分类器必须把真正未知的 full fallback 同时设为 production image 候选；
- job-level permissions 为 `contents: read`、`packages: write`；
- checkout 当前已验证 SHA；
- 使用固定 SHA 的 Docker Actions；
- runtime / worker 使用同一 GHA Buildx cache scope；
- 记录 SHA tag 和 digest summary。

**Step 3: 删除重复构建**

- 普通 Ready PR 不再无条件构建 runtime / worker 两次；
- Dockerfile / Compose 相关 PR 仍运行不 push 的 container validation；
- main 发布 job 本身是最终镜像构建，不在 full-gate 里先重复 `docker build`；
- 删除 `.github/workflows/build-image.yml`，避免 docs-only main 也被 `workflow_run` 捕获。

**Step 4: 验证权限边界**

确认 PR job 无 `packages: write`，publish job 不接受 PR-controlled secret，不使用 `pull_request_target`，且 fork / collaborator PR 无法进入发布条件。

**Step 5: 静态验证与 Commit**

Run:

```bash
pnpm exec prettier --check .github/workflows/ci.yml
pnpm exec vitest run --config ./vitest.config.mts tests/unit/ci-change-classifier.test.ts
git diff --check
```

Expected: PASS。

```bash
git add .github/workflows/ci.yml scripts/ci/classify-changes.mjs tests/unit/ci-change-classifier.test.ts
git rm .github/workflows/build-image.yml
git commit -m "ci: publish images only for production changes"
```

### Task 4：把 AI PR 行为写入规则文档

**Files:**

- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `CONTRIBUTING.md`
- Modify: `.github/pull_request_template.md`
- Modify: `docs/开发进度.md`

**Step 1: 更新 AGENTS.md**

新增“AI 与 CI 门禁”章节，强制：

- AI 默认创建 Draft PR；
- push 前本地定向验证并合并同轮小修改；
- 不手工挑选档次、不使用 `[skip ci]`；
- PR 描述 / Review 路径齐全后才 Ready；
- Ready 后大改先转回 Draft；
- 审核绑定 base/head SHA，只接受最新 head 的成功 CI policy；
- Draft Fast CI、旧 head、skipped / cancelled 不能作为合并依据；
- workflows / classifier / policy / image trigger 必须独立 Review；
- production image 不代表 production 部署授权。
- 同一目标、同一实施计划和同一 Review 边界的紧密相关改动默认放在一个 Draft PR，用分阶段 commit 保持可审；禁止把方案、实现和验证记录机械拆成多个非必要 PR，也禁止把无关任务塞进同一 PR。只有独立任务、不同负责人或强制 Review 边界、需要独立回滚 / 发布，或完整 diff 已明显超出可审规模时才拆分。

**Step 2: 同步 CLAUDE.md**

只复制最关键的执行约束，并继续声明冲突时以更严格规则为准。

**Step 3: 更新 CONTRIBUTING.md**

为人工与 AI 说明 Draft -> Ready -> Review -> merge 流程、路径自动分类、main image 边界、Ready 后新提交重跑规则和故障 fallback。

**Step 4: 更新 PR 模板**

新增检查项：

- PR 初始为 Draft；
- Ready 前已完成描述、本地测试和 Review 请求；
- 当前 head SHA；
- CI policy 是否为 Fast-only / Full；
- 如 Ready 后发生新提交，已重新核对最新 head；
- 是否修改 CI policy / workflow，需要独立 Review；
- 是否会触发 production image，并说明依据。

**Step 5: 更新进度并 Commit**

记录设计、实施范围、安全边界和预计节省，不记录账单截图或账户信息。

```bash
git add AGENTS.md CLAUDE.md CONTRIBUTING.md .github/pull_request_template.md docs/开发进度.md
git commit -m "docs: define AI pull request CI rules"
```

### Task 5：本地累计质量门禁

**Files:**

- Verify all changed files

**Step 1: 安装 hooks 和依赖**

Run:

```bash
bash scripts/install-git-hooks.sh
pnpm install --frozen-lockfile
```

Expected: hooks 启用；lockfile 不变化。

**Step 2: 运行累计检查**

Run:

```bash
git diff --check origin/main...HEAD
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:operations
pnpm build
docker compose -f compose.yaml -f compose.staging.yaml config >/dev/null
```

Expected: 全部 PASS。数据库、E2E 和镜像发布在 PR 在线验证阶段执行；不得连接 production。

**Step 3: 审查完整 diff**

确认：

- 没有 `.env`、账单、usage CSV、客户资料或缓存进入 Git；
- PR 48 Admin 文件未修改；
- docs-only 不发布镜像；
- PR 不能获得 packages write；
- 未知分类 fail closed；
- 当前完整门禁仍可由 Ready / main 触发。

**Step 4: Commit 验证记录**

如进度文档尚未记录最终命令结果，追加记录后提交：

```bash
git add docs/开发进度.md
git commit -m "docs: record CI optimization verification"
```

### Task 6：创建 Draft PR 并在线验证生命周期

**Files / GitHub state:**

- Branch: `fix/github-actions-usage-optimization`
- PR: Draft by default

**Step 1: 在单一修复分支完成方案、实现和验证**

保留已基于最新 `origin/main` 创建的方案提交，将分支和 worktree 原地改名为 `fix/github-actions-usage-optimization` 与 `ivybm-fix-github-actions-usage-optimization`。分类器、workflow、规则文档和验证记录都属于同一 CI 优化目标、同一强制独立 Review 边界，因此使用一个 Draft PR 和分阶段 commit，不额外创建 docs-only 方案 PR。

**Step 2: 实施完成后 Push 并创建唯一 Draft PR**

PR 描述引用本设计和计划，明确 `.github/workflows/**` 属于仓库门禁，必须请求 `xuemusi` 独立 Review。除非后续出现可独立回滚 / 发布的不同目标，不再拆分新的 CI 子 PR。

Expected: Draft PR 只运行 Fast CI，不启动数据库、Playwright、Docker 或 publish。

**Step 3: 转为 Ready**

在本地累计检查、PR 描述和 Review 请求完成后转为 Ready。

Expected: 同一 head 自动运行完整路径门禁；`CI policy` summary 标记 Ready 和 head SHA。

**Step 4: 验证 synchronize**

只在确有必要的最终文档 / 测试修正后 push 新提交，不为测试 CI 制造空提交。

Expected: 同一 PR 旧运行被 concurrency 取消或不再作为依据；新 head 自动重跑 Fast 和必要 Full Gate。

**Step 5: 验证安全和 Review**

确认 publish job 在 PR 上 skipped 且无 packages write；等待另一名开发者审核 workflow、分类边界和 AI 规则。不得负责人自检合并。

### Task 7：合并后验证和用量复盘

**Files:**

- Modify later: `docs/开发进度.md`

**Step 1: 合并前确认**

记录最终 head SHA、独立 Review、CI policy 成功和完整 diff。用户明确授权后才合并。

**Step 2: 验证 main 行为**

CI 优化提交包含 workflow / scripts / docs，但不改变业务 runtime；按分类策略应运行 main operations / 完整 policy，同时不发布业务镜像。若实际运行错误触发镜像发布，记录为分类缺陷并在后续独立 PR 修复，不能为了避免一次构建临时跳过 CI。

**Step 3: 用后续真实 PR 验证矩阵**

分别观察而不制造无意义 PR：

- 下一次 docs-only PR；
- PR 48 或后续 Admin/UI PR；
- 下一次 migration / Payload PR；
- 下一次 Docker / operations PR。

发现漏检立即回退全量门禁。

**Step 4: 一个月后复盘**

从 GitHub usage report 只提取汇总：PR 数、workflow runs、平均分钟、cancelled 数、production image builds 和费用趋势。目标 Actions 用量下降 50% 以上，质量事故和漏检为 0。

**Step 5: 更新进度**

记录实际节省、误分类和规则调整；不提交含账号计费细节的原始报告。

---

## 完成定义

1. Draft docs-only、Draft code、Ready code、main docs-only、main runtime 五类路径有自动化证据。
2. `CI policy` 始终出现并绑定当前 head；AI 规则禁止用 Fast-only 或旧 head 合并。
3. 当前 migration、integration、build、E2E、operations 和容器验证没有被删除，只改变触发条件。
4. docs-only main 不构建 production images；生产相关 main SHA 只构建一次 runtime / worker。
5. PR workflow 无写 packages 权限，不使用 `pull_request_target`，不读取 production secret。
6. `AGENTS.md`、`CLAUDE.md`、`CONTRIBUTING.md` 和 PR 模板已约束 AI 提交、审核与合并行为。
7. CI 优化 PR 获得另一名开发者独立 Review，用户明确授权后才合并。
