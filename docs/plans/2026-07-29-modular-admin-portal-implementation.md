# IVYBM 模块化运营门户 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不重建 Payload 后端、认证和数据模型的前提下，交付可独立挂载业务模块的 `/dashboard` 运营门户基座，并按负责人和依赖逐步迁移高价值后台工作流。

**Architecture:** Payload CMS / PostgreSQL 是唯一控制平面；第一阶段只建设和验收 `/dashboard` 运营门户。Portal Core 使用静态 TypeScript module registry 统一 Auth、RBAC、Shell、UI 状态、错误和质量契约；业务模块通过 read model 与领域 command 接入，不直接写权威字段。Payload 已有 `/admin` 只作为内部维护能力存在，本计划不新增或改造其 UI，也不把它作为 Portal 回退路径。

**Tech Stack:** Next.js 16 App Router、React 19、Payload CMS 3.86、TypeScript、Tailwind CSS 4（禁用 Preflight、Portal 范围导入）、按需 shadcn/ui 源码组件、Tabler Icons、Vitest、React Testing Library、Playwright。

---

**Canonical decisions:** [ADR-0004](../architecture/adr/0004-modular-admin-portal.md)

**Visual baseline:** [Digital Lattice Pencil](../../designs/ivybm-admin-portal-digital-lattice.pen)

**Execution rule:** 每个 Task 从最新 `origin/main` 建独立短分支/worktree；不得在本 docs worktree 实现代码。

**Review rule:** Portal Core、共享 contract、`src/payload.config.ts`、migration 和跨模块 DTO 必须由另一名开发者 review。

## 0. Scope Reduction 结论

第一阶段只交付“可用的基座”，不是空壳大后台：

- 自研登录页，但复用 Payload Users Auth 与同一 session；
- 受保护 `/dashboard` Shell、模块注册、角色导航和账户/退出；
- 复用真实四类队列的首页；
- 基础设置 Hub；未纳入 Portal 的内部配置不提供导航或深链；
- 通用 loading / empty / error / forbidden / blocked / dependency-gated 状态；
- Feature flag、Portal 维护态、CSS isolation、视觉/权限/E2E 回归。

第一阶段不做 CMS 重写、会话 Inbox、内容发布、平台 OAuth、线索 Pipeline 或任何 migration。

## 1. What Already Exists

| 能力 | 现有实现 | 计划中的处理 |
| --- | --- | --- |
| Payload Auth / session / roles | `src/collections/Users.ts`、`src/access/roles.ts` | 直接复用，不复制 |
| Payload 控制平面 | `src/app/(payload)/**`、`src/collections/**` | 复用 Auth/RBAC/数据能力；不改造已有 Admin UI |
| Dashboard 有界读模型 | `src/admin-portal/modules/overview/getPortalOverview.ts` | Portal 专用 DTO 与查询预算 |
| CMS / Media | `src/collections/**` | Portal 提供任务入口、预览和范围内命令；未完成能力诚实受阻 |
| Knowledge / AI | `src/modules/knowledge/**`、`src/modules/ai/**` | 协作者模块消费 |
| Conversations | `src/modules/conversations/**`、operator APIs | 协作者模块消费 |
| Publishing contract | `src/modules/publishing/contracts.ts` | 等正式结构后消费 |
| Jobs / Leads / Platform readiness | 既有 Collections 与 services | 按 owner 和依赖接入 |

## 2. Task / PR 顺序

| Portal Task | 交付 | Owner | 是否阻塞后续 |
| --- | --- | --- | --- |
| P0.1 | Module contract + registry + feature flags/维护态契约 | jueyunai | 是 |
| P0.2 | Design tokens + CSS isolation + UI primitives | jueyunai | 是 |
| P0.3 | Payload session adapter + 自研登录/登出 | jueyunai | 是 |
| P0.4 | Shell / navigation / settings Hub + 总开关回退 | jueyunai | 是 |
| P0.5 | 角色首页与真实队列 | jueyunai | 基座验收 |
| P0.6 | 官网内容 Hub | jueyunai | 否 |
| P0.7 | 素材库 Workspace | jueyunai | 内容/知识共同输入 |
| P0.8a | 协作者开发包 + 示例模块 | jueyunai | 阻塞协作者接入 |
| P0.8b | 知识库与 AI 调试模块 | xuemusi | 协作者接入验收；阻塞 P0.9/P1.1 |
| P0.9 | 会话与 AI 客服模块 | xuemusi | 阻塞线索会话联动 |
| P1.1 | AI 内容工作台：生产、审核与发布任务准备 | jueyunai | 等正式结构；阻塞 P1.5 |
| P1.2 | 平台账号/readiness | xuemusi | 等真实授权；阻塞 P1.5 |
| P1.3 | 线索与飞书入口 | jueyunai | 等 Feishu 与 P0.9 读模型 |
| P1.4 | Jobs 异常与人工补偿 | jueyunai + 模块 owner | 等补偿 contract；阻塞 P1.5 |
| P1.5 | 受控真实对外发布启用 | xuemusi | P1.1 + P1.2 + P1.4 |

---

### Task P0.1：冻结 Portal Core 模块契约

**Owner:** jueyunai

**Files:**

- Create: `src/admin-portal/core/modules/types.ts`
- Create: `src/admin-portal/core/modules/definePortalModule.ts`
- Create: `src/admin-portal/core/modules/registry.ts`
- Create: `src/admin-portal/core/modules/getVisiblePortalModules.ts`
- Create: `src/admin-portal/core/modules/getPortalFeatureState.ts`
- Create: `src/admin-portal/core/i18n/types.ts`
- Create: `src/admin-portal/core/i18n/zh.ts`
- Create: `src/admin-portal/core/i18n/en.ts`
- Test: `tests/unit/admin-portal-module-registry.test.ts`
- Test: `tests/unit/admin-portal-i18n.test.ts`

**Step 1: Write failing registry tests**

断言：

- module `id` 和 `href` 唯一；
- 每个 label key 同时存在中文与英文；
- registry 按角色过滤，但不会输出权限外模块；
- `dependency-gated` / `blocked` 不暴露 command；
- owner 只能是 `jueyunai` 或 `xuemusi`；
- 模块必须明确 `available` / `dependency-gated` / `blocked` / `admin-only` 状态；
- disabled 或依赖缺失时不得跳转内部 `/admin`，必须在 Portal 内给出维护态、责任人和下一步；
- `ADMIN_PORTAL_ENABLED` 与按模块 flag 默认 fail closed，不得绕过服务端授权。

**Step 2: Run tests and verify failure**

Run:

```bash
pnpm vitest run --config ./vitest.config.mts tests/unit/admin-portal-module-registry.test.ts tests/unit/admin-portal-i18n.test.ts
```

Expected: FAIL because Portal module contract does not exist.

**Step 3: Implement the minimal static contract**

使用 ADR-0004 中的 manifest 字段，并在 Core 首批实现总开关、模块 flag 与 Portal 维护态不变式。不要加入动态 import、数据库菜单、远程插件、模块版本协商或运行时安装。

**Step 4: Verify**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm vitest run --config ./vitest.config.mts tests/unit/admin-portal-module-registry.test.ts tests/unit/admin-portal-i18n.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/admin-portal/core tests/unit/admin-portal-*.test.ts
git commit -m "feat(admin-portal): define modular portal contract"
```

---

### Task P0.2：建立 Portal 设计系统和 CSS 隔离

**Owner:** jueyunai

**Files:**

- Create: `components.json`
- Create: `postcss.config.mjs`
- Create: `src/admin-portal/core/styles/portal.css`
- Create: `src/admin-portal/core/styles/tokens.css`
- Create: `src/admin-portal/core/ui/Button.tsx`
- Create: `src/admin-portal/core/ui/StatusBadge.tsx`
- Create: `src/admin-portal/core/ui/PortalState.tsx`
- Create: `src/admin-portal/core/ui/Surface.tsx`
- Create: `src/admin-portal/core/ui/index.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Test: `tests/unit/admin-portal-design-tokens.test.ts`
- Test: `tests/unit/admin-portal-style-boundary.test.ts`
- Test: `tests/e2e/admin-portal-css-isolation.spec.ts`

**Step 1: Write failing design contract tests**

从 `ivybm-admin-portal-digital-lattice.pen` 锁定：

- canvas `#F7F9FB`；
- sidebar `#0F172A`；
- action `#4F46E5`；
- IBM Plex Sans / Mono；
- 4px control radius、8px container radius；
- loading/empty/error/forbidden/blocked 状态同时使用文字、图标和语义色。

另断言 `portal.css` 不导入 Tailwind Preflight、不进入 `src/app/(payload)/custom.scss`。

**Step 2: Run tests and verify failure**

Run:

```bash
pnpm vitest run --config ./vitest.config.mts tests/unit/admin-portal-design-tokens.test.ts tests/unit/admin-portal-style-boundary.test.ts
```

Expected: FAIL because Portal styles do not exist.

**Step 3: Install the minimum UI dependencies**

- Tailwind CSS 4 + PostCSS adapter；
- shadcn/ui 只初始化源码目录和 CSS variables；
- 禁用 Preflight；
- 配置组件前缀；
- 继续使用 `@tabler/icons-react`；
- 只加入 Button、Badge、Sheet/Dialog 所需底层依赖，不安装 chart、motion、table、DND 或 command palette。

若 shadcn CLI 生成 root/global CSS 或 Lucide，停止并手工收敛为 Portal scoped 配置，不接受全局污染。

**Step 4: Verify Portal and Payload isolation**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:e2e -- tests/e2e/admin-portal-css-isolation.spec.ts
pnpm build
```

Expected: Portal primitives match tokens; styles do not leak to the website or other routes.

**Step 5: Commit**

```bash
git add components.json postcss.config.mjs package.json pnpm-lock.yaml src/admin-portal tests
git commit -m "feat(admin-portal): add isolated design system"
```

---

### Task P0.3：复用 Payload session 并交付自研登录

**Owner:** jueyunai

**Files:**

- Create: `src/admin-portal/core/auth/getPortalSession.ts`
- Create: `src/admin-portal/core/auth/requirePortalUser.ts`
- Create: `src/admin-portal/core/auth/safeReturnTo.ts`
- Create: `src/admin-portal/core/auth/types.ts`
- Create: `src/modules/auth/payloadLogout.ts`
- Create: `src/app/(dashboard)/dashboard/layout.tsx`
- Create: `src/app/(dashboard)/dashboard/login/page.tsx`
- Create: `src/admin-portal/core/auth/PortalLoginForm.tsx`
- Create: `src/app/(dashboard)/dashboard/(protected)/layout.tsx`
- Test: `tests/unit/admin-portal-return-to.test.ts`
- Test: `tests/unit/admin-portal-auth.test.ts`
- Test: `tests/unit/admin-portal-login.test.tsx`
- Test: `tests/e2e/admin-portal-auth.spec.ts`

**Step 1: Write failing auth tests**

覆盖：

- 未登录访问受保护页跳 `/dashboard/login`；
- 已登录三角色读取同一 Payload session；
- `https://evil.example`、`//evil.example`、反斜杠和控制字符 return target 被拒绝；
- login 401、429、503、网络失败分别有稳定反馈；
- login pending 防重复；
- 登出只有在 Payload 返回 2xx 后清本地用户；
- `/dashboard` 登出成功后清理 Portal 用户态，失败时保持会话并允许重试。

**Step 2: Run tests and verify failure**

Run:

```bash
pnpm vitest run --config ./vitest.config.mts tests/unit/admin-portal-return-to.test.ts tests/unit/admin-portal-auth.test.ts tests/unit/admin-portal-login.test.tsx
```

Expected: FAIL because Portal auth adapter does not exist.

**Step 3: Implement session adapter**

- Server Component 使用 `headers()` + `getPayload()` + `payload.auth()`；
- 只接受 `collection === 'users'` 的用户；
- 不创建第二套 JWT/cookie；
- 登录调用 Payload Users REST auth；
- 密码不写日志、不进入 URL、不持久到浏览器 storage；
- 角色守卫使用 `getRoleUser` / `resolveRoleAccess`。

**Step 4: Verify**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:e2e -- tests/e2e/admin-portal-auth.spec.ts
pnpm build
```

Expected: Portal login/logout/session-expiry works without redirect loops or a second identity system.

**Step 5: Commit**

```bash
git add src/admin-portal/core/auth src/modules/auth src/app tests
git commit -m "feat(admin-portal): reuse Payload authentication"
```

---

### Task P0.4：实现 Shell、角色导航和基础设置 Hub

**Owner:** jueyunai

**Files:**

- Create: `src/admin-portal/core/navigation/PortalSidebar.tsx`
- Create: `src/admin-portal/core/navigation/PortalHeader.tsx`
- Create: `src/admin-portal/core/navigation/PortalAccountMenu.tsx`
- Create: `src/admin-portal/core/navigation/PortalMobileNav.tsx`
- Create: `src/admin-portal/core/navigation/PortalShell.tsx`
- Create: `src/admin-portal/core/modules/resolvePortalAvailability.ts`
- Create: `src/admin-portal/modules/settings/manifest.ts`
- Create: `src/admin-portal/modules/settings/SettingsHub.tsx`
- Create: `src/app/(dashboard)/dashboard/(protected)/settings/page.tsx`
- Test: `tests/unit/admin-portal-navigation.test.tsx`
- Test: `tests/unit/admin-portal-settings.test.tsx`
- Test: `tests/e2e/admin-portal-shell.spec.ts`

**Step 1: Write failing shell tests**

覆盖：

- Admin/Operator/Sales 导航差异；
- registry unavailable/blocked 状态；
- 当前路由、折叠、移动 Sheet、Escape、焦点恢复；
- 未授权配置入口不显示；
- Site Settings 的公开 read 不会被误解为全员可 update；
- AI/provider/platform token 不出现在 Portal 导航、链接或响应中。
- 总开关关闭时，`/dashboard` 显示明确维护态，不渲染任何业务模块。

**Step 2: Run tests and verify failure**

Run:

```bash
pnpm vitest run --config ./vitest.config.mts tests/unit/admin-portal-navigation.test.tsx tests/unit/admin-portal-settings.test.tsx
```

Expected: FAIL.

**Step 3: Implement Shell and Portal settings**

Settings Hub 第一阶段只提供 Portal 内经服务端过滤且已实现的设置：

- 本人账户；
- 语言、主题与可访问性偏好；
- Site Settings 的安全只读摘要或已实现的受保护字段；
- 模块可用状态、责任人和下一步。

用户管理、模型密钥和平台凭据属于内部维护范围，不进入第一阶段 Portal。

**Step 4: Verify**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:e2e -- tests/e2e/admin-portal-shell.spec.ts
pnpm build
```

Expected: role-safe navigation, no overflow at 1440/1280/768/390.

**Step 5: Commit**

```bash
git add src/admin-portal src/app tests
git commit -m "feat(admin-portal): add modular shell and settings hub"
```

---

### Task P0.5：复用真实队列交付角色首页

**Owner:** jueyunai

**Files:**

- Create: `src/admin-portal/modules/overview/manifest.ts`
- Create: `src/admin-portal/modules/overview/getPortalOverview.ts`
- Create: `src/admin-portal/modules/overview/OverviewPage.tsx`
- Create: `src/app/(dashboard)/dashboard/(protected)/page.tsx`
- Test: `tests/unit/admin-portal-overview.test.ts`
- Test: `tests/integration/admin-portal-overview-access.test.ts`
- Test: `tests/e2e/admin-portal-overview.spec.ts`

**Step 1: Write failing shared read-model tests**

断言：

- query budget 不超过 7；
- 所有 Local API 用户读取 `overrideAccess: false`；
- Admin 看失败/Dead Jobs，Operator 不看，Sales 只看分配给自己；
- DTO 不含 transcript、联系方式、Job payload、secret；
- read model 不带内部维护路径或 UI href；
- 内容审核/今日发布没有正式结构时是 `dependency-gated`，不是数字 0。

**Step 2: Run tests and verify failure**

Run:

```bash
pnpm vitest run --config ./vitest.config.mts tests/unit/admin-portal-overview.test.ts
pnpm test:integration -- tests/integration/admin-portal-overview-access.test.ts
```

Expected: FAIL because the Portal-specific bounded read model does not exist.

**Step 3: Reuse domain queries, do not couple to Admin UI**

复用现有领域服务和安全查询约束，但在 Portal 模块中映射独立 DTO，不修改 `src/admin/**`。Portal 首页只显示：

- 待人工接管；
- 人工服务中；
- 新增 A 类高意向；
- Admin 的失败/Dead Jobs；
- 依赖受限说明。

**Step 4: Verify**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration -- tests/integration/admin-portal-overview-access.test.ts
pnpm test:e2e -- tests/e2e/admin-portal-overview.spec.ts
pnpm build
```

Expected: `/dashboard` shows real bounded queues and preserves role boundaries without depending on Admin UI code.

**Step 5: Commit**

```bash
git add src/admin-portal src/app tests
git commit -m "feat(admin-portal): add permission-safe overview"
```

---

### Task P0.6：官网内容 Hub

**Owner:** jueyunai

**Files:**

- Create: `src/admin-portal/modules/website-content/manifest.ts`
- Create: `src/admin-portal/modules/website-content/getContentSummary.ts`
- Create: `src/admin-portal/modules/website-content/ContentHub.tsx`
- Create: `src/app/(dashboard)/dashboard/(protected)/content/page.tsx`
- Test: `tests/unit/admin-portal-content-summary.test.ts`
- Test: `tests/integration/admin-portal-content-access.test.ts`
- Test: `tests/e2e/admin-portal-content.spec.ts`

**Step 1: Write failing role/access tests**

覆盖页面、产品、分类、案例、文章、下载资料的安全数量、最近更新、草稿/发布、EN/AR 完整度、范围内编辑动作和未实现能力受阻态。

**Step 2: Run failing tests**

Run:

```bash
pnpm vitest run --config ./vitest.config.mts tests/unit/admin-portal-content-summary.test.ts
pnpm test:integration -- tests/integration/admin-portal-content-access.test.ts
```

Expected: FAIL.

**Step 3: Implement Hub, not a second CMS**

第一版提供任务总览、筛选、状态、完整度、预览和明确纳入范围的编辑命令；复杂 localized rich text、
版本和 SEO 编辑未实现时显示 `dependency-gated`，不通过内部入口深链冒充完成。只有真实高频痛点证明价值后再扩展编辑器。

**Step 4: Verify**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration -- tests/integration/admin-portal-content-access.test.ts
pnpm test:e2e -- tests/e2e/admin-portal-content.spec.ts
pnpm build
```

Expected: content workflow improves without duplicating drafts/versions/locales.

**Step 5: Commit**

```bash
git add src/admin-portal/modules/website-content src/app tests
git commit -m "feat(admin-portal): add website content hub"
```

---

### Task P0.7：素材库 Workspace

**Owner:** jueyunai

**Files:**

- Create: `src/admin-portal/modules/media/manifest.ts`
- Create: `src/admin-portal/modules/media/getMediaPage.ts`
- Create: `src/admin-portal/modules/media/MediaWorkspace.tsx`
- Create: `src/admin-portal/modules/media/MediaGrid.tsx`
- Create: `src/admin-portal/modules/media/MediaPreview.tsx`
- Create: `src/app/(dashboard)/dashboard/(protected)/media/page.tsx`
- Test: `tests/unit/admin-portal-media.test.ts`
- Test: `tests/integration/admin-portal-media-access.test.ts`
- Test: `tests/e2e/admin-portal-media.spec.ts`

**Step 1: Write failing tests**

覆盖 URL 可序列化筛选、分页、长文件名、图片/PDF 安全预览、公开状态、alt/source、权限和未实现编辑受阻态。

**Step 2: Run failing tests**

Run:

```bash
pnpm vitest run --config ./vitest.config.mts tests/unit/admin-portal-media.test.ts
pnpm test:integration -- tests/integration/admin-portal-media-access.test.ts
```

Expected: FAIL.

**Step 3: Implement grid-first workspace**

复用唯一 `Media` Collection。第一版不做批量写、不做视频转码、不建平行存储表。

**Step 4: Verify**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration -- tests/integration/media.test.ts tests/integration/admin-portal-media-access.test.ts
pnpm test:e2e -- tests/e2e/admin-portal-media.spec.ts
pnpm build
```

Expected: existing MIME/size/public policy remains authoritative.

**Step 5: Commit**

```bash
git add src/admin-portal/modules/media src/app tests
git commit -m "feat(admin-portal): add media workspace"
```

---

### Task P0.8a：交付协作者开发包和示例模块

**Owner:** jueyunai；公共 contract review：xuemusi

**Files:**

- Create: `docs/development/admin-portal-module-guide.md`
- Create: `src/admin-portal/modules/example/manifest.ts`
- Create: `src/admin-portal/modules/example/ExampleModule.tsx`
- Test: `tests/contract/admin-portal-module-contract.test.ts`

**Precondition:** P0.1–P0.5 merged。

**Steps:**

1. 写明 module manifest、公共 UI 出口、授权、状态、错误、维护态、日志和测试契约；
2. 用不访问真实领域数据的 example 模块证明新模块不需修改 Shell 私有代码；
3. 验证跨模块私有 import 被禁止，disabled/blocked 模块不会暴露副作用命令；
4. Commit: `docs(admin-portal): add collaborator module kit`。

---

### Task P0.8b：接入知识库与 AI 调试模块

**Owner:** xuemusi；Portal contract/视觉 review：jueyunai

**Files:**

- Create: `src/admin-portal/modules/knowledge/manifest.ts`
- Create: `src/admin-portal/modules/knowledge/getKnowledgePage.ts`
- Create: `src/admin-portal/modules/knowledge/KnowledgeWorkspace.tsx`
- Create: `src/app/(dashboard)/dashboard/(protected)/knowledge/page.tsx`
- Test: `tests/integration/admin-portal-knowledge-access.test.ts`
- Test: `tests/e2e/admin-portal-knowledge.spec.ts`

**Precondition:** P0.8a merged；知识索引/AI route/Jobs 已在 main。

**Steps:**

1. 先写 module contract、角色、review/index 双状态和 index command 失败测试；
2. 运行并确认缺少模块实现；
3. manifest 使用 `ADMIN_PORTAL_KNOWLEDGE_ENABLED`；关闭时显示 Portal 维护态且不注册索引命令；
4. 只通过知识 read model 和受保护 index command 接入，禁止直接写 index owner/status；
5. 验证 Admin/Operator/Sales、模型缺失、维度不匹配、索引失败、关闭 flag 和重试；
6. Commit: `feat(admin-portal): add knowledge workspace module`。

本 Task 是“基座可由协作者独立使用”的验收，不是由 jueyunai 代写知识领域逻辑。

---

### Task P0.9：统一会话与 AI 客服模块

**Owner:** xuemusi；Portal contract/视觉 review：jueyunai

**Files:**

- Create: `src/admin-portal/modules/conversations/manifest.ts`
- Create: `src/admin-portal/modules/conversations/ConversationInbox.tsx`
- Create: `src/admin-portal/modules/conversations/ConversationThread.tsx`
- Create: `src/admin-portal/modules/conversations/ConversationContext.tsx`
- Create: `src/app/(dashboard)/dashboard/(protected)/conversations/page.tsx`
- Test: `tests/contract/admin-portal-conversation-contract.test.ts`
- Test: `tests/e2e/admin-portal-conversations.spec.ts`

**Precondition:** P0.8b merged，知识 read model 与 AI route 可用；operator summary/detail/command APIs 与 ConversationService contract 已合并。

**Steps:**

1. 写失败测试：角色范围、接管、回复、解决、重复点击、stale revision、AI 在 human_active 停止；
2. manifest 使用 `ADMIN_PORTAL_CONVERSATIONS_ENABLED`；关闭时显示受阻态且不暴露接管/回复/解决命令；
3. 复用 operator API / ConversationService，禁止直接 Payload update；
4. 实现三栏桌面和窄屏列表→对话→上下文；
5. 验证 delivery_unknown、限流、过期、关闭 flag、失败重试和焦点；
6. Commit: `feat(admin-portal): add conversation workspace module`。

---

### Task P1.1：AI 内容工作台、审核与发布任务准备模块

**Owner:** jueyunai；平台发布 contract review：xuemusi

**Precondition:** P0.7 素材 read model 与 P0.8b 知识 read model 已合并。先在本 Task 的结构子任务中完成 `GeneratedContents`、`ContentReviews`、`PublishJobs`、`PublishLogs`、migration、Payload 注册和生成类型；这些结构合并后，才实现工作台写命令和 PublishingService persistence adapter。

**Files:**

- Create: `src/admin-portal/modules/content-studio/**`
- Create: `src/app/(dashboard)/dashboard/(protected)/content-studio/page.tsx`
- Create/Modify: `src/collections/GeneratedContents.ts`
- Create/Modify: `src/collections/ContentReviews.ts`
- Create/Modify: `src/collections/PublishJobs.ts`
- Create/Modify: `src/collections/PublishLogs.ts`
- Test: `tests/contract/admin-portal-content-studio-contract.test.ts`
- Test: `tests/integration/admin-portal-content-studio.test.ts`
- Test: `tests/e2e/admin-portal-content-studio.spec.ts`

**Required tests:**

- 未审核内容没有发布命令；
- `accepted` 不等于 `published`；
- `delivery_unknown` 不自动重发；
- LinkedIn assisted package 不泄露临时 URL；
- fixture/mock 永远不显示 `available`；
- 内容事实来源可追溯。
- P1.2 readiness 和 P1.4 补偿 contract 未就绪时，真实对外发布命令为 `dependency-gated`；仅允许草稿、审核、预览、内部任务和 assisted package。
- manifest 使用 `ADMIN_PORTAL_CONTENT_STUDIO_ENABLED`；关闭时显示 Portal 维护态，不创建内容或发布任务。
- 工作台只消费双方冻结的 `PublishingService` capability/publish/status contract，不导入平台 SDK 或 token。

依赖未满足时不开始实现，不创建替代结构。

---

### Task P1.2：平台账号与 readiness 模块

**Owner:** xuemusi；IA/视觉/集成 review：jueyunai

**Precondition:** `PlatformAccounts`、migration、Payload 注册和生成类型已合并；Task 13 capability/readiness contract、官方结构 fixture 和受控测试结果可用。

**Files:**

- Create: `src/admin-portal/modules/platforms/manifest.ts`
- Create: `src/admin-portal/modules/platforms/getPlatformReadiness.ts`
- Create: `src/admin-portal/modules/platforms/PlatformReadinessPage.tsx`
- Create: `src/app/(dashboard)/dashboard/(protected)/platforms/page.tsx`
- Test: `tests/contract/admin-portal-platform-readiness-contract.test.ts`
- Test: `tests/integration/admin-portal-platform-readiness.test.ts`
- Test: `tests/e2e/admin-portal-platform-readiness.spec.ts`

第一版 Portal 只显示无凭据 readiness、责任人、下一步和受控测试状态；token 写入继续走受限内部维护流程，
Portal 不提供入口、深链或回显。只有经过单独安全评审后才考虑 Portal 配置命令。

必须覆盖：action-required、ready-for-controlled-test、blocked、available；TikTok DM 保持 blocked；
WhatsApp、LinkedIn DM、TikTok publish 不进入一期。
只有受控真实环境完成目标操作才能标记 `available`；fixture/mock 只能得到 `action-required` / `ready-for-controlled-test` / `blocked`。manifest 使用 `ADMIN_PORTAL_PLATFORMS_ENABLED`，关闭时显示 Portal 受阻态且不读取或回显 token。

---

### Task P1.3：线索与飞书入口

**Owner:** jueyunai

**Precondition:** Feishu mapping/sync handler、Jobs 和权限 contract 合并；P0.9 会话 read model contract 可用。共享会话/线索 contract 变更由 xuemusi review。

第一版提供列表、筛选、详情、相关会话、意向、负责人、同步状态和飞书记录深链。Pipeline、拖拽和“已成交”
必须等待正式领域状态，不在首版创建。

---

### Task P1.4：Jobs 异常与人工补偿

**Owner:** jueyunai 负责仅 admin 角色可见的 Portal 通用外壳；每个模块 owner 负责自己的补偿命令。

**Files:**

- Create: `src/modules/jobs/compensation/contracts.ts`
- Create: `src/admin-portal/modules/operations/getSafeJobPage.ts`
- Create: `src/admin-portal/modules/operations/JobCompensationPage.tsx`
- Create: `docs/operations/admin-portal-compensation.md`
- Test: `tests/contract/job-compensation-contract.test.ts`
- Test: `tests/operations/admin-portal-compensation.test.ts`

通用列表只显示 type/status/attempt/nextRun/安全错误摘要/关联业务 ID，不显示 payload、ownerToken、客户消息、
平台 token 或完整堆栈。手工重试前必须再次校验幂等和外部结果；`delivery_unknown` 不进入普通重试。

完成门槛：每个可失败的模块 owner 必须在共享 compensation port 中注册类型化动作、权限、幂等规则、结果未知处理和对应 runbook；通用外壳只调用已注册动作。contract/operations 测试覆盖知识索引、会话投递、内容生成、平台发布、飞书同步和其他已注册 Job；未有类型化补偿的任务不显示通用“重试”。

---

### Task P1.5：启用受控真实对外发布

**Owner:** xuemusi；上线与集成验收：jueyunai

**Precondition:** P1.1 的正式内容/审核/发布持久化、P1.2 对应平台 `available`、P1.4 对应任务的类型化补偿命令与 runbook 全部就绪。

只对通过受控真实环境测试的 Facebook / Instagram / LinkedIn 能力打开发布命令。发布前再次校验审核状态、账号 readiness、幂等键和补偿责任；`delivery_unknown` 停止自动重发并进入平台模块 runbook。`ADMIN_PORTAL_PUBLISHING_ENABLED` 是独立 command kill switch；关闭时保留已有状态可读，禁止新建/重试对外发布，并由 operations 测试与 runbook 验证。

---

### Task P2：全局质量、灰度与回滚

**Files:**

- Create: `tests/e2e/admin-portal-roles.spec.ts`
- Create: `tests/e2e/admin-portal-responsive.spec.ts`
- Create: `tests/e2e/admin-portal-visual.spec.ts`
- Create: `tests/operations/admin-portal-config.test.ts`
- Modify: `.env.example`
- Modify: `docs/operations/部署手册.md`
- Modify: `docs/开发进度.md`

**Steps:**

1. 在 P0.1/P0.4 合并后，验证 `ADMIN_PORTAL_ENABLED`、按模块 flags 和 Portal 维护态；
2. 覆盖三角色、四视口、键盘、深链、浏览器返回、慢请求和模块失败；
3. 证明 Portal 失败不影响官网、worker、数据库和既有内部维护能力；
4. 完成 production build、smoke、rollback 演练和 runbook。

## 3. Error & Rescue Registry

| Codepath | Error code | 触发 | Portal 处理 | 日志 |
| --- | --- | --- | --- | --- |
| getPortalSession | `unauthenticated` | 无/过期 session | 跳登录 | route + request ID |
| requirePortalRole | `forbidden` | 角色不允许 | 403 | actor ID + module |
| safeReturnTo | `invalid_return_to` | 外域/非法路径 | 回首页 | 不记录恶意完整 URL |
| login | `invalid_credentials` | 401 | 原位错误 | 不记录密码 |
| login | `account_locked` | 429/锁定 | 稍后重试 | user ID/email hash |
| read model | `read_failed` | DB/adapter 错误 | 局部重试 | module + query name |
| registry | `dependency_unavailable` | 依赖未合并/未配置 | 受阻态 | dependency code |
| domain command | `state_conflict` | stale/非法 transition | 刷新状态 | entity ID + revision |
| domain command | `rate_limited` | 业务限流 | 倒计时/稍后重试 | command + actor |
| provider | `delivery_unknown` | 已越过发送边界但结果未知 | 停止自动重试 | correlation ID |
| logout | `logout_failed` | 非 2xx/网络 | 保持登录并重试 | status + request ID |

禁止把 `read_failed` 转成空列表；禁止只 `console.error(error.message)` 后吞掉。

## 4. Failure Modes Registry

| Codepath | Failure mode | Rescued | Test | User sees | Logged |
| --- | --- | --- | --- | --- | --- |
| Portal layout | session 过期 | 是 | auth E2E | 登录页 | 是 |
| Registry | 重复 ID/href | CI 阻止 | unit | 不发布 | 测试报告 |
| CSS | 逃逸 `.portal-shell` 并污染官网/其他路由 | CI 阻止 | visual E2E | 不发布 | screenshot diff |
| Overview | 一项查询失败 | 局部失败 | integration | 错误态 | 是 |
| Module | 依赖缺失 | 是 | unit/E2E | dependency-gated | 是 |
| Command | 双击/重复提交 | 领域幂等 | contract/E2E | 处理中/既有结果 | 是 |
| Command | 页面离开后完成 | 是 | E2E | 返回后读取权威状态 | 是 |
| Provider | 结果未知 | 是 | contract | 人工补偿 | 是 |
| Feature rollout | Portal Core 回归 | 总开关 | operations | Portal 维护态 | 是 |

## 5. Test Diagram

```text
Unit
  Module registry / i18n / guards / returnTo / DTO / state mapping
        |
        v
Integration
  Payload auth + role access + Local API overrideAccess=false + read models
        |
        v
Contract
  Knowledge / Conversation / Publishing / Platform / Jobs commands
        |
        v
E2E
  Login -> Shell -> Module -> Command -> Result
  Admin / Operator / Sales
  1440 / 1280 / 768 / 390
        |
        v
Operations
  feature flags / build / CSS isolation / rollback / smoke
```

## 6. NOT in Scope

- 动态插件市场：静态 registry 足够；
- 第二套 Auth/DB/CMS：安全风险和维护成本无收益；
- 全部 Payload 表单重写：先解决高频任务；
- Cmd+K：等搜索和权限预算；
- Kanban/DND：等状态转换 contract；
- AI Copilot：等知识质量和评测；
- 图表大屏：没有决策价值的数据不展示；
- 完整 CRM：飞书继续承载详细跟进；
- 多租户/复杂审批：一期不存在；
- 平台范围外能力：不伪造。

## 7. Dream State Delta

```text
CURRENT
Payload 控制平面已有数据能力，但运营流程分散
    |
    v
THIS PLAN
共享 Payload 控制平面 + 模块化 /dashboard + 明确 ownership
    |
    v
12-MONTH IDEAL
90% 日常任务在 Portal 完成；内部维护入口不对运营用户暴露；
模块 owner 可独立发布；所有状态、权限、失败和审计一致
```

## 8. Global Verification

每个 Task 至少运行定向检查；Portal Core Ready 前运行：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm test:operations
pnpm build
git diff --check
```

数据库测试必须使用隔离 PostgreSQL 18.4 + pgvector 0.8.5；E2E 必须使用专用测试账号；
不得连接 production、复制真实 token 或正式客户资料。

## 9. Definition of Done

- Portal Core 的 public API 有文档、contract test 和双方 review；
- `/dashboard` 复用 Payload session，且没有第二套身份数据；
- 添加示例模块不修改 Shell 私有代码；
- 首页只展示真实且角色安全的数据；
- 总开关能无 migration 切换到 Portal 维护态；
- 协作者独立完成知识模块接入，证明 ownership 模型可运行；
- P1/Future 依赖全部显式记录，不以占位 UI 冒充已实现；
- 每个阶段完成后更新 `docs/开发进度.md`。
