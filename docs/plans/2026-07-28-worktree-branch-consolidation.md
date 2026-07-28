# Worktree 与分支收敛实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不丢失未提交成果、不改变公开官网 UI、不触碰正式客户素材的前提下，把本地仓库收敛为一个干净 `main` 主工作区和至多一个有效开发 worktree，并删除已合并或已被替代的本地 / 远端分支。

**Architecture:** 先把每个 dirty worktree 的状态保存到仓库外恢复包，并为未合并分支 tip 建立隐藏 archive ref；随后只把仍有价值的治理文档、Admin 研究结论和 Admin Shell 代码迁移到从最新 `origin/main` 创建的短分支。所有旧 Task 6 前台 / seed 改动明确不进入主线；注册 worktree 只通过 `git worktree remove` 清理。

**Tech Stack:** Git worktree / refs、GitHub PR / Actions、pnpm、Payload CMS 3.86、Playwright、macOS `trash`。

---

## 0. 不变量与停止条件

- `ivybm` 最终必须绑定 `main`、与 `origin/main` 同步且 `git status --short` 为空。
- 本轮不得从旧 worktree 合入 `src/app/(frontend)`、`src/components/website`、`src/seed`、产品 E2E 或旧 Task 6 CSS；公开官网 UI 和 production 数据不变。
- `ivybm-local-data/private-materials/`、主工作区 ignored `media/`、`deliverables/`、`.env` 内容、数据库、uploads 和 production 备份不删除、不复制到 Git。
- 任何 dirty worktree 在恢复包和 SHA-256 清单成功生成前不得清理。
- 任何未合并 branch tip 在 `refs/archive/` 或既有 archive tag 可解析前不得删除。
- `src/payload.config.ts` 的 Admin Shell PR 必须等另一名开发者 review；不得负责人自检合并。
- 不运行 `git reset --hard`、`git clean -fdx`、`git gc --prune` 或 `git reflog expire`。

## Task 1：建立恢复包与 archive refs

**Files / refs:**

- Create outside Git: `/Users/zhiyun.lee/GitHub/builder/ivybm-local-data/archives/2026-07-28-worktree-consolidation/`
- Create refs: `refs/archive/2026-07-28/*`
- Inspect: all registered worktrees, local / remote branches, stash, reflog metadata

**Step 1:** 记录 `git worktree list --porcelain`、`git branch -vv`、local / remote refs、open / closed PR、每个 worktree 的 `status --porcelain=v1 -z`。

Expected: 四个既有 dirty worktree和本计划 worktree均有独立清单；清单不包含 `.env` 值。

**Step 2:** 对每个 dirty worktree保存 `git diff --binary`、staged diff（如有）和未跟踪文件 tar.gz；生成 `SHA256SUMS`。

Expected: root、Admin Shell、Dashboard concepts、CMS designer brief 四套恢复包可通过 `sha256sum -c`。

**Step 3:** 为以下未合并 / 待清理 tip 建立隐藏 archive refs：

- `feat/task-6-product-page-content`
- `feat/task-6-aluminum-content`
- `feat/task-directus-admin-poc`
- `origin/fix/task13-meta-malformed-payload`
- `origin/feat/task-8-evaluation-baseline`（同时验证既有 archive tag）

Expected: `git show-ref refs/archive/2026-07-28/...` 全部可解析。

**Step 4:** 验证恢复包不包含 `ivybm-local-data/private-materials`、ignored `media/`、`.env*` 或数据库文件。

## Task 2：合并本地 worktree 管理规范和本实施计划

**Files:**

- Create: `docs/plans/2026-07-27-local-worktree-collaboration-design.md`
- Create: `docs/plans/2026-07-28-worktree-branch-consolidation.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `CONTRIBUTING.md`
- Modify: `README.md`
- Modify: `.github/pull_request_template.md`
- Modify: `docs/开发进度.md`

**Step 1:** 在当前 `docs/worktree-branch-consolidation` 分支重放 `7b6ea7e` 的治理改动，不覆盖最新 `docs/开发进度.md`。

**Step 2:** 追加一条 2026-07-28 进度记录，说明计划、恢复边界和公开官网零变更约束。

**Step 3:** 运行 `git diff --check`、`pnpm lint`、`pnpm typecheck`。

**Step 4:** 提交、push、创建 docs-only PR；CI 通过后按负责人自检路径合并并删除远端短分支。

Expected: `origin/main` 包含 worktree 生命周期规范与本计划；不含运行时代码变更。

## Task 3：收敛 Admin 研究与设计文档

**Files:**

- Create: `docs/research/directus-admin-poc-record.md`
- Create: `docs/IVYBM-CMS管理后台UI重设计-设计师背景简报.md`
- Modify: `docs/开发进度.md`
- Archive outside Git: `designs/admin-dashboard/*.pen`、`*.png`

**Step 1:** 从最新 `origin/main` 创建 `docs/admin-ui-research-consolidation` 和临时 docs worktree。

**Step 2:** 从 root 恢复包 / dirty 文件摘取 Directus POC 结论；仅记录实验结果，不合入 Directus Compose、脚本或依赖。

**Step 3:** 以 CMS designer brief 为唯一 handoff，合并 A / B / C 视觉方向摘要并修正以下口径：

- 当前一期是 Payload `/admin` runtime + 自有 Nav / Dashboard / Custom Views；
- 独立 `/dashboard`、shadcn / Tailwind 是 Future proposal，不是已实现契约；
- TikTok 标记为 `blocked`；待审核 / 今日发布等指标标记为 dependency-gated。

**Step 4:** 将三组 `.pen` / PNG 复制到仓库外设计归档并生成 SHA-256；Git 中不提交 PNG，未选中的 `.pen` 不进入主线。

**Step 5:** 追加一条最新进度记录，运行文档 diff 检查、lint、typecheck，创建 docs-only PR；CI 成功后负责人自检合并。

Expected: 主线只有一份 canonical 设计师简报和一份 Directus 决策记录；没有生成型设计二进制。

## Task 4：恢复固定主工作区 `ivybm → main`

**Files / worktree:**

- Worktree: `/Users/zhiyun.lee/GitHub/builder/ivybm`
- Branch to retire: `feat/task-6-product-page-content`

**Step 1:** 确认 Task 1 恢复包和 Task 3 摘取文件均已落地 / 合并。

**Step 2:** 对 root dirty 文件逐项与 `origin/main` 复核，确认不再有待摘取成果。

**Step 3:** 使用 `git restore` 恢复 tracked 文件；使用 macOS `trash` 移走已归档的 untracked 文件，不处理 ignored `.env`、`media/`、`deliverables/`。

**Step 4:** 切换 `main` 并 `git pull --ff-only origin main`。

**Step 5:** 验证 `git status --short --branch` 为 `main...origin/main` 且无修改。

Expected: `ivybm` 恢复为永久控制入口；公开官网代码与最新 main 完全一致。

## Task 5：基于最新 main 重建 Admin Shell PR

**Files:**

- Create: `src/admin/components/AdminAccountMenu.tsx`
- Create: `src/admin/styles/admin-account-menu.css`
- Modify: `src/admin/components/OperationsNav.tsx`
- Modify: `src/admin/styles/admin-nav.css`
- Modify: `src/app/(payload)/custom.scss`
- Modify: `src/payload.config.ts`
- Regenerate: `src/app/(payload)/admin/importMap.js`
- Modify: `tests/unit/admin-navigation.test.ts`
- Modify: `tests/e2e/admin-visual.spec.ts`
- Modify: `docs/开发进度.md`

**Step 1:** 从最新 `origin/main` 创建 `fix/admin-shell-account-menu` 和新 worktree。

**Step 2:** 只迁移旧 Admin Shell 的九个代码 / 测试文件和两个新增文件；不迁移旧版整份进度文档。

**Step 3:** 重新生成 Payload import map；修复旧测试的字符串断言，补充账户菜单 Escape、outside click、焦点恢复和退出失败 / pending 行为测试（能够在当前组件边界实现的最小集合）。

**Step 4:** 运行 `pnpm generate:importmap`、lint、typecheck、定向 unit、完整 unit、production build 和可运行的 Admin E2E。

**Step 5:** 创建 PR，在描述中明确 `src/payload.config.ts` 为共享文件并请求另一名开发者 review。

Expected: CI 通过且取得独立 review 后合并；若 review 未到，保留此唯一开发 worktree并报告阻塞，不越权合并。

## Task 6：删除已合并 / 已替代分支和旧 worktree

**Step 1:** 删除六条已合并且无 open PR 的远端分支：

- `docs/task-5-production-media-record`
- `docs/task13-social-outbound-decision`
- `feat/task-13-platform-readiness`
- `feat/task-13-publishing-adapter`
- `feat/task-13-publishing-fake`
- `feat/task-5-product-gallery`

**Step 2:** 在 archive refs / tags 验证成功后删除已替代分支：

- local + remote `feat/task-6-aluminum-content`
- remote `fix/task13-meta-malformed-payload`
- remote `feat/task-8-evaluation-baseline`
- local `feat/task-directus-admin-poc`
- local `feat/task-6-product-page-content`

**Step 3:** 保留仍有独立未合并价值的远端分支：

- `docs/fault-model-review-skill`
- `docs/task13-platform-account-workbook`
- `feat/task-13-integration`（仅 `4caf000` Platform Operations Center 尚未进入主线）

**Step 4:** 在对应 PR 合并 / 资料外置后，用 `git worktree remove` 删除：

- `ivybm-admin-dashboard-concepts`
- `ivybm-cms-ui-designer-brief`
- 旧 `ivybm-admin-shell`
- 本计划和 Admin docs 临时 worktree
- Admin Shell 新 worktree（仅 PR 已合并时）

**Step 5:** 删除未注册且只剩空 `.next/` 的 `ivybm-task6-oldsite-content` 目录；不删除 `ivybm-local-data/private-materials`。

## Task 7：缓存、安全权限与最终审计

**Step 1:** 删除已移除 worktree 的 `.next`、`node_modules` 和 Playwright 临时产物；主工作区保留 `node_modules`，按需清理 `.next`。

**Step 2:** 将主工作区 `.env` / `.env.local` 权限收紧为 `600`，不读取、不输出内容；旧 Admin Shell 的共享 symlink 随 worktree 删除。

**Step 3:** 运行：

```bash
git fetch --prune origin
git worktree list --porcelain
git branch -vv
git branch --merged origin/main
git worktree prune --dry-run
git status --short --branch
```

**Step 4:** 输出最终报告：保留 worktree、保留分支、删除分支、archive refs、PR / CI 状态、磁盘回收量、未解决 review 阻塞。

Expected: `ivybm` 为干净 main；除 Admin Shell 等明确活跃任务外无多余 worktree；不存在已合并远端短分支；正式素材和 production 不受影响。
