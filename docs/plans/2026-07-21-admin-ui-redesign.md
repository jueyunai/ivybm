# IVYBM 任务导向运营后台与视觉系统改造 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Payload 的原生 Collection 导航升级为一个任务导向、可审计、对中小运营团队友好的「AI 获客运营后台」，同时保留 Payload 作为 CMS、认证、权限、审计、多语言与数据模型底座。

**Architecture:** 采用「Payload 原生 Admin shell + 自定义 Dashboard / Custom Views + 项目自有视觉系统」三层结构。原生 Collection 页面继续承载低频配置和受控 CRUD；会话、审核、发布、素材等高频工作使用自定义工作台路由，并通过既有领域服务与权限规则执行命令。`payload-theme` 只在独立试装分支中作为视觉 POC，不能在验证前成为生产依赖或工作流架构基础。

**Tech Stack:** Payload CMS 3.86、Next.js 16.2、React 19、TypeScript、Payload Admin Custom Components / Custom Views、SCSS/CSS Layers、Playwright、Vitest；视觉 POC 限定 `payload-theme@0.7.0`。

---

**状态：** 设计草案，待产品/视觉审核。批准本文前不安装 `payload-theme`、不改后台代码、不改变数据库结构或对外接口。

## 1. 决策摘要

### 1.1 采用的路线

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| 后台底座 | 保留 Payload Admin | 现有认证、RBAC、草稿、版本、多语言、上传、审计与数据库模型已经可用，重建等于复制高风险基础设施。 |
| 导航模型 | 从 Collection/数据表改为任务/队列 | 运营人员关心「下一步处理什么」，而不是表名；内容、会话、发布和线索本质上是一条连续工作流。 |
| 视觉体系 | 项目自有语义 token + shadcn 风格组件语言 | 视觉可以长期可控，且不把业务 UI 锁死在第三方主题的内部 DOM/CSS 类名上。 |
| `payload-theme` | 单独 POC，结果决定是否保留为基础皮肤 | 包的 peer range 与本项目技术版本兼容，但发布很新、会无条件替换 Nav/Dashboard，必须先做安全、性能、无障碍和回滚验证。 |
| 独立 Refine/React-admin | 一期不采用 | 会重复实现 Payload 的权限、登录、草稿/版本、REST 映射和领域命令，收益小于整合成本。 |

### 1.2 第一性原理

一个好后台的价值不是「表格变圆角」，而是让角色以最少的切换完成正确动作：

1. **发现任务：** 首页在 10 秒内让用户看到待自己处理的会话、审核、失败和提醒。
2. **理解上下文：** 用户不用在列表、详情、客户资料、审计记录间反复跳页。
3. **安全完成动作：** 发布、接管、重试、删除等命令显示状态、权限、结果和审计，不允许 UI 直接改权威领域字段。
4. **保留可维护性：** 视觉层不能绕过现有 access control、`ConversationService`、`PublishingService`、审计 hook 或 Payload migration 纪律。

因此，本方案将「数据管理」与「业务工作」分开：后台管理员仍可进入原生 Collection 页面处理配置；运营和销售优先进入工作台队列完成日常工作。

## 2. 现状与不可破坏约束

### 2.1 已知现状

- `src/payload.config.ts` 目前只配置了 admin user 与 import map；没有自定义 Dashboard、导航组件、品牌组件或 Admin custom view。
- `src/app/(payload)/custom.scss` 已由生成的 Payload layout 引入，但当前为空，是安全的全局后台主题入口。
- 现有后台文案为中文/英文；公开内容为英文/阿语（阿语 RTL）。后台改造不能把两套语言模型混为一谈。
- 现有 Collection 已按 Website Content、Knowledge Base、Lead Management、Conversations、AI Management、Operations 等部分分组；Media、Users、AuditLogs 仍可能落在顶层，需要重新收敛。
- 架构基线已经定义「工作台首页 = Payload 自定义 Dashboard」，并要求会话/发布使用服务端权威状态机。

### 2.2 绝对约束

| 领域 | 不可破坏规则 |
| --- | --- |
| 权限 | UI 隐藏不是权限控制；每个数据读取与命令仍由 Payload access control 或领域服务二次授权。 |
| 会话 | 前端不得直接写 `handoffStatus`、`assignedTo` 或审计字段；人工接管必须走 `ConversationService`。 |
| 发布 | 未审核内容不得发布；发布命令走 `PublishingService`，前端不得接触平台 token 或 SDK。 |
| AI 配置 | Provider key 继续保持加密、只写不可读；主题不能改变字段 access 或列表脱敏。 |
| 数据库 | 本次视觉改造不创建临时 Collection/migration；依赖 Task 12 的内容/发布实体未合并前，只显示受控占位或不显示。 |
| 性能 | 2C4G 单机不允许 Dashboard 为全部 Collection 顺序拉取大量记录；必须使用有上限、带权限过滤的聚合查询。 |
| 可访问性 | 按 WCAG 2.2 AA：键盘可操作、文本对比度至少 4.5:1、焦点可见、Dialog 焦点管理正确、状态不只依赖颜色。 |

## 3. 目标信息架构

### 3.1 面向角色的入口

```text
AI 获客运营后台
├── 工作台
│   ├── 待我处理
│   ├── 今日重点
│   └── 异常与失败
├── 官网内容
│   ├── 页面 / 产品 / 案例 / 文章 / 下载
│   ├── 素材库
│   └── SEO 与站点设置
├── 会话中心
│   ├── 统一 Inbox
│   ├── 人工接管
│   └── 已解决会话
├── 内容与发布
│   ├── 内容工作台
│   ├── 审核队列
│   ├── 发布排期
│   └── 发布记录 / 重试
├── 知识库与 AI
│   ├── 知识文档 / 切片 / 提示词
│   └── 模型路由（admin）
└── 系统设置（admin）
    ├── 用户与角色
    ├── 平台账号
    ├── 审计与任务
    └── 系统维护
```

### 3.2 角色可见性

| 角色 | 默认首页 | 可见任务 | 禁止项 |
| --- | --- | --- | --- |
| admin | 全局工作台 | 全部队列、系统异常、配置、审计 | 无业务级限制，但危险命令需确认。 |
| operator | 运营工作台 | 内容、知识库、会话、审核、发布任务 | 用户、密钥、平台凭据与系统级任务管理。 |
| sales | 我的会话与线索 | 已分配会话、已分配线索、客户上下文 | 认领/改派、内容发布、模型与平台配置。 |

原生 Collection 仍作为「高级/配置入口」存在，但导航将把内部实体（例如 Jobs、AuditLogs）收纳到 System/Operations，避免运营人员把它们误认为日常入口。

## 4. 视觉方向：Industrial Precision（工业精密感）

### 4.1 风格描述

视觉语言取自铝单板业务的「材料、结构、工程精度」：大面积暖白/石墨中性色提供专业和安定感；深青绿作为可访问的行动色；状态色仅用于表达状态，不承担唯一识别职责。界面避免消费级渐变、过度玻璃化和装饰性阴影，强调清晰密度、分层和可扫描性。

品牌资料确认前使用以下**暂定** token；最终不得在页面中散落硬编码色值：

| Token | 暂定值 | 用途 |
| --- | --- | --- |
| `--ops-canvas` | `#F8FAFC` | 页面背景 |
| `--ops-surface` | `#FFFFFF` | 卡片/弹层 |
| `--ops-ink` | `#0F172A` | 主文本、石墨导航 |
| `--ops-muted` | `#475569` | 次要文本 |
| `--ops-border` | `#DCE3EC` | 边界与分隔 |
| `--ops-accent` | `#0F766E` | 主要操作、键盘焦点、激活项 |
| `--ops-success` | `#047857` | 成功/已发布 |
| `--ops-warning` | `#B45309` | 待处理/风险 |
| `--ops-danger` | `#B91C1C` | 失败/删除 |
| `--ops-info` | `#1D4ED8` | 信息/进行中 |

### 4.2 组件规范

- **排版：** 后台使用 `Inter, Noto Sans SC, Noto Sans Arabic, system-ui, sans-serif` 回退栈；数字与状态字段使用等宽数字特性；正文不小于 14px。
- **空间：** 4px 基础间距，常用 8/12/16/24/32px；页面区块 24px；不要用任意 magic number。
- **形状：** 输入/按钮 8px，卡片 12px；避免 20px 以上的大圆角造成消费级 App 观感。
- **层级：** 白色 Surface + 细边框为主，仅浮层/抽屉使用低扩散阴影；不使用不必要的 `backdrop-filter`。
- **状态：** 每个 badge 同时提供文字、颜色和可访问图标；发布状态、接管状态、同步状态都有一致映射。
- **动效：** 120–180ms，支持 `prefers-reduced-motion`；加载优先骨架而不是无限 spinner。
- **深色模式：** 使用语义 token 单独定义，而非简单反相；在浅/深色下分别回归表格、表单、图片预览和错误态。

### 4.3 文案与国际化

- 所有新增 Admin 文案进入现有中文/英文后台翻译层；不得把中文字符串硬编码在 React 组件。
- 英文/阿语是内容 locale，不等同于后台 UI locale。编辑阿语内容时，字段可以支持 RTL 预览；后台导航不因内容 locale 自动翻转。
- 使用 CSS logical properties（`margin-inline`、`padding-inline`、`inset-inline`），并对可镜像图标显式处理 RTL。

## 5. 关键页面体验规范

### 5.1 工作台首页

首页只回答「今天要做什么」，不展示原生 Collection Card 墙。

1. 顶部：欢迎语、当前用户、日期/时区、全局搜索/命令面板、通知入口。
2. 第一屏：待我处理会话、待审核内容、待发布内容、新增高意向线索、失败任务五个可点击队列；每张卡给出数量、变化、最紧急一条摘要和深链。
3. 第二屏：今日排期、近期发布、需要人工补偿的失败列表；图表最多三张，均可降级为数字摘要。
4. 所有数量必须服从角色 access，不能因为 Dashboard 聚合泄露别人的会话、用户或密钥配置。

### 5.2 会话中心

采用三栏 Inbox，而不是直接把 `Conversations` 当作表格编辑：

- 左栏：可保存的筛选（待我处理 / 待接管 / 进行中 / 已解决）、渠道、SLA、负责人、更新时间；URL 可复现筛选条件。
- 中栏：消息流、AI 摘要、知识引用、发送/重试状态；长会话按需分页/虚拟化。
- 右栏：客户与线索上下文、意向等级、接管状态、审计时间线和允许的下一步命令。
- 高风险状态转换显示目标、操作者和结果；失败给出可恢复说明，不能乐观伪造成功。

### 5.3 内容、审核与发布

采用「列表 + 详情抽屉/页面 + 状态时间线」而不是只做 Kanban：

- 审核人需要比较原始素材、生成内容、事实来源和平台格式。
- 发布页显示 `draft → review → approved → scheduled → published / failed`，并在失败时提供原因、日志摘要和有权限的重试入口。
- 日历仅用于已排期内容；表格用于比较批次、平台、状态和时间；每种呈现匹配用户的决策任务。
- 这部分依赖 Task 12 的 `GeneratedContents`、`ContentReviews`、`PublishJobs`、`PublishLogs` 完整合并。依赖未满足时不创建替代 Collection 或 migration。

### 5.4 素材库与 CMS

截图中的媒体文件名表格应升级为「网格优先、表格可切换」：缩略图、文件类型、尺寸、版权/来源、公开状态、最后使用位置和批量操作为主；长文件名不应成为视觉主体。原生 Payload 编辑页继续用于复杂元数据，素材工作台只提供受控的浏览、筛选、预览与跳转。

## 6. 技术设计

### 6.1 Admin 组件结构

```text
src/admin/
├── components/
│   ├── BrandMark.tsx
│   ├── TaskNavLinks.tsx
│   ├── AdminHeaderActions.tsx
│   ├── StatusBadge.tsx
│   └── EmptyState.tsx
├── dashboard/
│   ├── getDashboardSummary.ts
│   ├── types.ts
│   └── DashboardQueueCard.tsx
├── views/
│   ├── OperationsDashboard.tsx
│   ├── MediaWorkspace.tsx
│   ├── ConversationWorkspace.tsx
│   └── ContentPublishingWorkspace.tsx
└── styles/
    ├── tokens.css
    ├── admin-shell.css
    └── workspaces.css
```

`src/payload.config.ts` 中通过 `admin.components.views.dashboard` 替换默认 Dashboard；工作台页使用 `admin.components.views.<key> = { Component, path, exact }` 注册。自定义组件默认是 React Server Component；只有需要浏览器状态、焦点管理、快捷键或客户端 fetch 的局部组件才使用 `'use client'`。

组件路径变化后只能执行 `pnpm generate:importmap`，不得手改生成的 `src/app/(payload)/admin/importMap.js` 或生成的 `(payload)` 路由文件。

### 6.2 受控数据读取与命令

Dashboard 的读模型必须是一个小、可测试、角色感知的服务，不是浏览器拼接多个 Payload REST 请求。目标契约如下：

```ts
export type OperatorDashboardSummary = {
  queues: {
    assignedConversations: number
    handoffRequested: number
    newQualifiedLeads: number
    failedJobs: number
    reviewReady?: number
    scheduledForToday?: number
  }
  urgentItems: Array<{
    id: string
    kind: 'conversation' | 'lead' | 'job'
    label: string
    href: string
    updatedAt: string
    severity: 'info' | 'warning' | 'danger'
  }>
}
```

- 使用 server-side Local API 且明确 `overrideAccess: false` 与当前 user/request context；不可默认绕过 access control。
- 会话首页仅读取摘要和状态，不能把完整 transcript 放到 Dashboard。
- 对 `Conversations`（`handoffStatus`/`assignedTo`/`lastMessageAt`）、`Leads`（`status`/`assignedTo`）和 `Jobs`（`status`）建立有界筛选，取最多必要的记录。
- 接管、解决、发布、重试等变更仍调既有 HTTP/domain command；工作台只调用服务端 command adapter。

### 6.3 样式接入

- `src/app/(payload)/custom.scss` 只负责导入项目的 Admin token 与 shell/workspace 样式；必要时在 Payload 官方 `@layer payload-default` 中覆盖稳定的视觉 token。
- 新的工作台组件优先使用 CSS Modules 或自有 class namespace（例如 `.ops-*`），避免选择 Payload 深层内部 BEM/DOM 结构。
- 如果采用 shadcn/ui，仅把组件源码和 token 引入自定义工作台；禁止把 Tailwind preflight/reset 粗暴注入整个 Payload Admin。
- SCSS 继续使用时将 `sass` 显式声明为开发依赖，不能依赖 transitive dependency。

## 7. `payload-theme` 独立 POC 计划（在本文审核通过后才执行）

### 7.1 POC 边界

- 单独新建 `feat/task-admin-ui-theme-poc` 分支，基于最新 `origin/main`；不与本文档分支混合。
- 精确固定 `payload-theme@0.7.0`，提交 lockfile；不跟随 npm `latest`。
- 仅改 `package.json`/lockfile、`src/payload.config.ts`、`src/app/(payload)/custom.scss`、生成 import map 和 POC 专属测试；不得修改 Collection schema、migration、服务 contract 或生产部署。
- POC 不部署 production，不更新生产 secret/CSP；截图、测试和本地构建是决策证据。

### 7.2 已知风险与验证项

| 风险 | 验证或约束 |
| --- | --- |
| 主题无条件替换 Nav 与 Dashboard | 与未来任务导向自定义 Nav/Dashboard 的冲突必须明确；不允许两个实现重复注册。 |
| Dashboard 对多个 Collection 顺序 count/find | 记录 TTFB、查询数量和内存；超出本项目预算即拒绝。 |
| 命令面板每次输入跨集合查询 | 验证请求扇出、索引、节流和权限，不把它当作生产全局搜索。 |
| List quick delete | 测试 access、CSRF、审计 hook、删除确认和 URL 编码 ID；任一失败则禁用或拒绝主题。 |
| CSS 依赖 Payload 内部类 | 用浅/深色、桌面/移动、Media/表单/关系字段、升级后截图回归守护。 |
| CSS variable 原样注入 | `cssVariables` 只写死在受版本控制的可信 config，禁止来自 CMS 或用户输入。 |
| 无障碍不足 | 键盘、Escape、焦点、屏幕阅读器语义和 reduced-motion 通过后才可继续评估。 |

### 7.3 POC 通过条件

1. `pnpm generate:importmap && pnpm lint && pnpm typecheck && pnpm build` 全部通过。
2. admin/operator/sales 的登录、退出、可见菜单和 direct URL 权限与当前行为一致。
3. AI key 写入/脱敏、内容草稿、Media 上传、关系字段、中文/英文后台、英文/阿语内容编辑均无回归。
4. 浅色/深色在 1600px、1280px、768px 宽度的截图可读，键盘焦点和关键 Dialog 可操作。
5. Dashboard 与列表性能不劣于现状可接受阈值；出现明显 N+1 / fan-out 时判定失败。
6. 可通过一次 commit 回滚：移除 plugin、CSS import，重新生成 import map 后恢复原生 Admin。

## 8. 分阶段实施计划（待批准后）

### Task 1: 建立后台设计 token、导航契约与回归基线

**Files:**

- Create: `src/admin/styles/tokens.css`
- Create: `src/admin/styles/admin-shell.css`
- Create: `src/admin/components/TaskNavLinks.tsx`
- Create: `src/admin/components/StatusBadge.tsx`
- Create: `tests/unit/admin-navigation.test.ts`
- Create: `tests/unit/admin-status-badge.test.ts`
- Create: `tests/e2e/admin-visual.spec.ts`
- Modify: `src/payload.config.ts`
- Modify: `src/app/(payload)/custom.scss`
- Modify: `tests/unit/payload-admin-i18n.test.ts`

**Step 1: Write failing navigation and token tests.**

Assert that the admin config registers only approved custom navigation/view component paths; assert Chinese and English labels exist for every new task-oriented item; assert status badges map text, icon and semantic status rather than a color-only string.

**Step 2: Run the targeted tests.**

Run: `pnpm vitest run --config ./vitest.config.mts tests/unit/admin-navigation.test.ts tests/unit/admin-status-badge.test.ts tests/unit/payload-admin-i18n.test.ts`

Expected: FAIL because the components, tokens and config registrations do not exist.

**Step 3: Implement the minimal visual foundation.**

Create semantic CSS tokens, namespaced `.ops-*` primitives, localized task navigation links, and a reusable `StatusBadge`. Register only `beforeNavLinks`/`afterNavLinks` needed for the new IA; preserve generated pages and import-map ownership.

**Step 4: Generate the import map and verify.**

Run: `pnpm generate:importmap && pnpm lint && pnpm typecheck && pnpm test:unit`

Expected: PASS; no generated Payload file has a manual diff.

**Step 5: Commit.**

```bash
git add src/admin src/payload.config.ts "src/app/(payload)/custom.scss" tests
git commit -m "feat: establish task-oriented admin visual foundation"
```

### Task 2: Replace the default Dashboard with a permission-safe operations dashboard

**Files:**

- Create: `src/admin/dashboard/types.ts`
- Create: `src/admin/dashboard/getDashboardSummary.ts`
- Create: `src/admin/dashboard/DashboardQueueCard.tsx`
- Create: `src/admin/views/OperationsDashboard.tsx`
- Create: `tests/unit/admin-dashboard-summary.test.ts`
- Create: `tests/integration/admin-dashboard-access.test.ts`
- Modify: `src/payload.config.ts`
- Modify: `tests/e2e/admin-visual.spec.ts`

**Step 1: Write failing summary tests.**

Fixture Conversations with each handoff state, Leads with assigned/unassigned statuses, and Jobs with `failed`/`dead`. Assert admin sees permitted global counts, operator sees permitted operational counts, sales sees only assigned summaries, and no transcript/API key appears in summary output.

**Step 2: Run the targeted tests.**

Run: `pnpm vitest run --config ./vitest.config.mts tests/unit/admin-dashboard-summary.test.ts && pnpm test:integration -- tests/integration/admin-dashboard-access.test.ts`

Expected: FAIL because the read model and Dashboard view do not exist.

**Step 3: Implement a bounded server-side read model.**

Use Local API with `overrideAccess: false`, current user and request context. Query only required fields and bounded urgent lists. Configure `admin.components.views.dashboard` to point to `OperationsDashboard`; do not use the experimental modular dashboard widget API as the primary foundation.

**Step 4: Verify role, screenshot and performance behavior.**

Run: `pnpm generate:importmap && pnpm test:unit && pnpm test:integration -- tests/integration/admin-dashboard-access.test.ts && pnpm test:e2e -- tests/e2e/admin-visual.spec.ts`

Expected: PASS; each role sees only permitted cards and the Dashboard has a documented bounded-query budget.

**Step 5: Commit.**

```bash
git add src/admin src/payload.config.ts tests
git commit -m "feat: add permission-safe operations dashboard"
```

### Task 3: Add a task-oriented media workspace without replacing the Media model

**Files:**

- Create: `src/admin/views/MediaWorkspace.tsx`
- Create: `src/admin/media/getMediaWorkspacePage.ts`
- Create: `src/admin/media/MediaGrid.tsx`
- Create: `src/admin/media/MediaTable.tsx`
- Create: `tests/unit/media-workspace.test.ts`
- Create: `tests/e2e/admin-media-workspace.spec.ts`
- Modify: `src/payload.config.ts`
- Modify: `src/admin/components/TaskNavLinks.tsx`

**Step 1: Write failing workspace tests.**

Assert a viewer can only see Media allowed by collection access, filters are URL-serializable, a long file name does not hide file type/source/public state, and every open/edit action links back to a valid native Media document.

**Step 2: Run the tests.**

Run: `pnpm vitest run --config ./vitest.config.mts tests/unit/media-workspace.test.ts && pnpm test:e2e -- tests/e2e/admin-media-workspace.spec.ts`

Expected: FAIL because the route and view do not exist.

**Step 3: Implement grid-first navigation.**

Register a custom `/admin/workspaces/media` view and a task-navigation entry. Provide grid/table density toggle, filters and image/PDF-safe preview. Keep native `/admin/collections/media` as the source-of-truth edit fallback; do not add a parallel storage table.

**Step 4: Verify upload and permission regression.**

Run: `pnpm generate:importmap && pnpm test:unit && pnpm test:e2e -- tests/e2e/admin-media-workspace.spec.ts`

Expected: PASS; upload validation, source metadata and public visibility remain enforced.

**Step 5: Commit.**

```bash
git add src/admin src/payload.config.ts tests
git commit -m "feat: add media operations workspace"
```

### Task 4: Build the Conversation Inbox on top of the existing command/service boundary

**Files:**

- Create: `src/admin/views/ConversationWorkspace.tsx`
- Create: `src/admin/conversations/ConversationInbox.tsx`
- Create: `src/admin/conversations/ConversationDetail.tsx`
- Create: `src/admin/conversations/ConversationContextPanel.tsx`
- Create: `tests/e2e/admin-conversation-workspace.spec.ts`
- Modify: `src/payload.config.ts`
- Modify: `src/admin/components/TaskNavLinks.tsx`
- Modify: `tests/contract/chat-service.test.ts` only if a read/command contract gap is confirmed

**Step 1: Write failing command-guard E2E tests.**

Cover operator request/claim/resolve flow, sales scoped visibility, duplicate click idempotency, AI reply blocked during `human_active`, visible audit outcome, and denied direct state-field mutation.

**Step 2: Run the targeted tests.**

Run: `pnpm test:contract -- tests/contract/chat-service.test.ts && pnpm test:e2e -- tests/e2e/admin-conversation-workspace.spec.ts`

Expected: FAIL because the inbox UI and test fixtures do not exist.

**Step 3: Implement the three-pane workspace.**

Consume the existing operator session API/ChatService read model for list summaries. Route all mutations through the existing service commands. Do not query/render message bodies in a global dashboard card and do not write Conversation authority fields from the UI.

**Step 4: Verify accessibility and role boundaries.**

Run: `pnpm test:contract && pnpm test:e2e -- tests/e2e/admin-conversation-workspace.spec.ts`

Expected: PASS; keyboard navigation, focus return, status messaging and role scopes are correct.

**Step 5: Commit.**

```bash
git add src/admin src/payload.config.ts tests
git commit -m "feat: add task-oriented conversation inbox"
```

### Task 5: Add content review and publishing workspaces after their shared dependencies merge

**Files:**

- Create: `src/admin/views/ContentPublishingWorkspace.tsx`
- Create: `src/admin/publishing/ContentReviewQueue.tsx`
- Create: `src/admin/publishing/PublishSchedule.tsx`
- Create: `src/admin/publishing/PublishFailurePanel.tsx`
- Create: `tests/e2e/admin-content-publishing.spec.ts`
- Modify: `src/payload.config.ts`
- Modify: `src/admin/dashboard/getDashboardSummary.ts`
- Modify: `src/modules/publishing/contracts.ts` only through a separately reviewed contract PR if new UI information is truly missing

**Precondition:** `GeneratedContents`, `ContentReviews`, `PublishJobs`, `PublishLogs`, their migration, registration, generated Payload types and PublishingService contract are all merged into `main`.

**Step 1: Write failing state-machine tests.**

Assert that draft/review/approved/scheduled/published/failed are rendered with stable labels; unapproved items have no publish command; failed items expose a retry only to authorized roles; platform capability remains conditional/blocked when the provider says so.

**Step 2: Run the targeted tests.**

Run: `pnpm test:unit -- tests/unit/publish-state.test.ts && pnpm test:e2e -- tests/e2e/admin-content-publishing.spec.ts`

Expected: FAIL because the workspace has not been added.

**Step 3: Implement queue, detail and schedule views.**

Use PublishingService for capability, submit, status and retry. Present source/fact review, platform formatting, review decisions and release history in the detail view. Do not import platform SDKs or read tokens in the browser.

**Step 4: Verify integration and accessibility.**

Run: `pnpm test:unit && pnpm test:integration -- tests/integration/content-workbench.test.ts && pnpm test:e2e -- tests/e2e/admin-content-publishing.spec.ts`

Expected: PASS; unreviewed content cannot become a publish job.

**Step 5: Commit.**

```bash
git add src/admin src/payload.config.ts tests
git commit -m "feat: add content review and publishing workspaces"
```

### Task 6: Run the isolated `payload-theme` POC and make the adopt/reject decision

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/payload.config.ts`
- Modify: `src/app/(payload)/custom.scss`
- Modify: generated `src/app/(payload)/admin/importMap.js` only via command
- Create: `tests/e2e/payload-theme-poc.spec.ts`
- Create: `docs/research/payload-theme-poc-record.md`

**Step 1: Create the dedicated POC branch from current `origin/main`.**

Do not run this task on the implementation branch. Record the exact package version, npm integrity, package author/repository, license, and peer versions in the POC record.

**Step 2: Write the failing visual/security test matrix.**

Cover login/logout, per-role navigation visibility, denied/direct destructive delete, Media table/grid, list/edit form, relation field, locale switch, dark mode, 1600/1280/768 screenshots, keyboard command palette and rollback build.

**Step 3: Install only the pinned plugin and configure it.**

Run:

```bash
pnpm add payload-theme@0.7.0
pnpm add -D sass
pnpm generate:importmap
```

Import its CSS in `custom.scss`, register the plugin in Payload config with a trusted hard-coded accent, and do not use untrusted `cssVariables` or undocumented `preset` options.

**Step 4: Execute acceptance and benchmark.**

Run: `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e -- tests/e2e/payload-theme-poc.spec.ts && pnpm build`

Expected: PASS; a before/after screenshot pack and Dashboard/query measurements are attached to `docs/research/payload-theme-poc-record.md`.

**Step 5: Decide and cleanly revert or retain.**

If any security, accessibility, performance or architectural conflict fails, revert the single POC commit. If it passes, retain only the supported visual layer and document the decision before integrating it with custom task views.

## 9. Global verification and delivery criteria

Before each merge:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm build
git diff --check
```

The exact subset is selected by the completed task, but no UI PR may skip typecheck, targeted role/access tests, visual screenshots, keyboard testing, and build/import-map generation.

After each approved implementation phase, append a concise entry to `docs/开发进度.md` that names the completed work, decision evidence, tests run, known deferred dependencies and whether the POC was accepted or reverted. Shared config (`src/payload.config.ts`), public contracts, and any later Collection/migration changes require the other developer's review under `AGENTS.md`.

## 10. Review checklist for this design

- [ ] 「Industrial Precision」视觉方向与品牌预期一致；是否需替换暂定 accent/字体？
- [ ] 五个一级工作区是否覆盖运营人员的日常顺序？
- [ ] 会话、审核、发布、飞书仍保持以领域服务为权威边界？
- [ ] 先试装主题、再决定主题是否留下的顺序是否认可？
- [ ] 是否接受 POC 中不连接 production、不改变数据库与对外 contract 的范围？
- [ ] 是否按 Task 1 → Task 6 的节奏实施，且 Task 5 等待发布领域依赖完整合并？

