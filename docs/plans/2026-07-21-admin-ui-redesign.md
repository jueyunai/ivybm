# IVYBM 任务导向运营后台与视觉系统改造 Implementation Plan

> **Superseded，2026-07-29：** 本计划已完成的 Payload Nav、Operations Dashboard 和账户菜单
> 仅作为 `/admin` 内部维护遗留能力保留，不进入一期 Portal 导航、开发或验收；未开始的 Custom View Task 3–5 不再执行。
> 当前实施基线改为 [模块化运营门户计划](2026-07-29-modular-admin-portal-implementation.md)
> 和 [ADR-0004](../architecture/adr/0004-modular-admin-portal.md)。

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Payload 的原生 Collection 导航升级为一个任务导向、可审计、对中小运营团队友好的「AI 获客运营后台」，同时保留 Payload 作为 CMS、认证、权限、审计、多语言与数据模型底座。

**Architecture:** 采用「Payload Admin runtime + 项目自有 Nav / Dashboard / Custom Views + 项目自有视觉系统」三层结构。自有 Nav 只接管左侧信息架构和视觉呈现，仍从 Payload 的受限 client config 与当前权限派生链接；原生 Collection 页面继续承载低频配置和受控 CRUD。会话、审核、发布、素材等高频工作使用自定义工作台路由，并通过既有领域服务与权限规则执行命令。`payload-theme` 已在独立 worktree 完成 POC 并被拒绝；视觉语言只能作为参考，不能成为生产依赖或工作流架构基础。

**Tech Stack:** Payload CMS 3.86、Next.js 16.2、React 19、TypeScript、Payload Admin Custom Components / Custom Views、SCSS/CSS Layers、Playwright、Vitest；不引入第三方 Payload 全局主题。

---

**状态：** 架构决策已批准，2026-07-21。主题 POC 已完成并拒绝；本计划可以开始不依赖未合并发布实体的 Task 1 与 Task 2。后续工作台仍须遵守领域服务、权限和迁移边界。

## 1. 决策摘要

### 1.1 采用的路线

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| 后台底座 | 保留 Payload Admin | 现有认证、RBAC、草稿、版本、多语言、上传、审计与数据库模型已经可用，重建等于复制高风险基础设施。 |
| 导航模型 | 从 Collection/数据表改为任务/队列 | 运营人员关心「下一步处理什么」，而不是表名；内容、会话、发布和线索本质上是一条连续工作流。 |
| 视觉体系 | 项目自有语义 token + Payload 公共 UI API | 视觉可以长期可控，且不把业务 UI 锁死在第三方主题的内部 DOM/CSS 类名上。 |
| `payload-theme` | 不采用 | POC 已确认其无条件替换 Nav/Dashboard、后台国际化不足、Dashboard 查询扇出且当前 Vitest 环境存在 ESM 兼容性失败。 |
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

- `src/payload.config.ts` 已注册 Operations Dashboard 与任务导航首版；本轮把局部 `beforeNavLinks` 注入升级为 Payload 公开的 `admin.components.Nav`，完整替换导航展示层。
- `src/app/(payload)/custom.scss` 是安全的全局后台主题入口，只导入项目自有 token、shell 与导航样式。
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
│   ├── OperationsNav.tsx
│   ├── AdminHeaderActions.tsx
│   ├── StatusBadge.tsx
│   └── EmptyState.tsx
├── navigation/
│   └── getOperationsNavSections.ts
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
    ├── admin-nav.css
    ├── admin-shell.css
    └── workspaces.css
```

`src/payload.config.ts` 中通过 `admin.components.Nav` 替换侧栏展示层，通过 `admin.components.views.dashboard` 替换默认 Dashboard；工作台页使用 `admin.components.views.<key> = { Component, path, exact }` 注册。`OperationsNav` 是 Client Component，只读取 Payload `useConfig`、`useAuth` 与翻译上下文来生成当前可见链接；不持有权限真相、不请求业务数据、不覆盖 Collection 页面。其他自定义组件默认是 React Server Component；只有需要浏览器状态、焦点管理、快捷键或客户端 fetch 的局部组件才使用 `'use client'`。

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
- 一期不引入 shadcn/ui 或 Tailwind reset；若二期评估独立运营端，组件体系只能落在该独立应用内，不能粗暴注入整个 Payload Admin。
- SCSS 继续使用时将 `sass` 显式声明为开发依赖，不能依赖 transitive dependency。

## 7. `payload-theme` 独立 POC 结果：Reject

POC 已在 `feat/task-admin-ui-theme-poc` 的独立 worktree 中完成；完整可复核记录见 [`docs/research/payload-theme-poc-record.md`](../research/payload-theme-poc-record.md)。本结论不是对 Payload Admin 的否定，而是对该第三方全局主题插件的拒绝。

| 结论证据 | 结果 | 对生产方案的影响 |
| --- | --- | --- |
| Nav 与 Dashboard 所有权 | 插件无条件覆盖二者，与本计划的任务导航和 OperationsDashboard 冲突 | 保留 Payload 原生壳，仅按公开 Custom Component API 扩展 |
| 导航稳定性 | 路由切换时重建整个导航组并置换激活项 DOM，视觉上出现闪烁 | 不 fork 修补插件；自有导航保持链接节点稳定并保留预取 |
| 性能 | 23 个 Collection 最坏约 46 次 Local API 查询，命令面板还会跨集合搜索 | Dashboard 改为角色感知、有界、并行的专用读模型 |
| 国际化 | 中文 Collection 名称与多处硬编码英文操作文案混排 | 新增 Admin 文案必须维护中文/英文映射 |
| 测试兼容性 | `payload-theme@0.7.0` 的 ESM 入口在现有 Vitest 环境无法解析内部模块 | 不把不兼容包引入生产依赖或测试基线 |

允许借鉴其登录页的密度、深青色行动色和小屏单栏处理，但不得复制其 Nav、Dashboard、命令面板、快速删除或依赖内部 DOM/CSS 的实现。浏览器强刷时出现的 Immersive Translate 注入 hydration 提示属于扩展行为，不是本决策的证据，也不能通过主题改动解决。

## 8. 分阶段实施计划

### Task 1: 建立后台设计 token、完整侧栏导航契约与回归基线

**Files:**

- Create: `src/admin/styles/tokens.css`
- Create: `src/admin/styles/admin-shell.css`
- Create: `src/admin/styles/admin-nav.css`
- Create: `src/admin/components/OperationsNav.tsx`
- Create: `src/admin/navigation/getOperationsNavSections.ts`
- Create: `src/admin/components/StatusBadge.tsx`
- Create: `tests/unit/admin-navigation.test.ts`
- Create: `tests/unit/admin-status-badge.test.ts`
- Create: `tests/e2e/admin-visual.spec.ts`
- Modify: `src/payload.config.ts`
- Modify: `src/app/(payload)/custom.scss`
- Modify: `tests/unit/payload-admin-i18n.test.ts`

**Step 1: Write failing navigation and token tests.**

Assert that the admin config uses the public `Nav` and Dashboard extension points; assert Chinese and English labels exist for every top-level navigation section; assert unreadable Collection / Global links are omitted, task links do not duplicate their source-of-truth Collection links, and status badges map text, icon and semantic status rather than a color-only string.

**Step 2: Run the targeted tests.**

Run: `pnpm vitest run --config ./vitest.config.mts tests/unit/admin-navigation.test.ts tests/unit/admin-status-badge.test.ts tests/unit/payload-admin-i18n.test.ts`

Expected: FAIL because the components, tokens and config registrations do not exist.

**Step 3: Implement the minimal visual foundation.**

Create semantic CSS tokens, namespaced `.ops-*` primitives, an access-aware `OperationsNav`, and a reusable `StatusBadge`. Register the public `Nav` extension point; derive each visible link from the current Payload client config and permission snapshot, while preserving generated pages and import-map ownership. The custom side bar must group workspaces, website content, knowledge / AI, operational records, and system settings without duplicating `Conversations` or `Leads`.

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
- Modify: `src/admin/components/OperationsNav.tsx`

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
- Modify: `src/admin/components/OperationsNav.tsx`
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

After each approved implementation phase, append a concise entry to `docs/开发进度.md` that names the completed work, decision evidence, tests run and known deferred dependencies. Shared config (`src/payload.config.ts`), public contracts, and any later Collection/migration changes require the other developer's review under `AGENTS.md`.

## 10. Review checklist for this design

- [ ] 「Industrial Precision」视觉方向与品牌预期一致；是否需替换暂定 accent/字体？
- [ ] 五个一级工作区是否覆盖运营人员的日常顺序？
- [ ] 会话、审核、发布、飞书仍保持以领域服务为权威边界？
- [x] `payload-theme` POC 已完成并明确拒绝，生产分支不安装该包。
- [ ] 是否按 Task 1 → Task 5 的节奏实施，且 Task 5 等待发布领域依赖完整合并？
