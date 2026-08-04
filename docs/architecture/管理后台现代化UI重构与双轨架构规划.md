# IVYBM 管理后台现代化 UI 重构与模块化架构规划

版本：v3.0

日期：2026-07-30

状态：Accepted

决策依据：[ADR-0004](adr/0004-modular-admin-portal.md)

> **2026-08-02 现行交付决策：** 一个功能分支、一个 Portal V1 Draft PR、一次合并、一次经人工批准的 production 部署。本文后续所有“PR-1 / PR-2”“两个 PR”与“PR-2 才启用 Portal”的表述仅保留为历史方案，已失效。真实平台 transport、token 刷新、worker 发布 handler、平台回调、`delivery_unknown` 补偿和受控账号联调由 xuemusi 后续独立 PR 完成；Portal 首次部署保持 `ADMIN_PORTAL_PUBLISHING_ENABLED=false`。

## 1. 结论

IVYBM 管理后台采用“一个后端控制平面、一个一期运营入口、一个模块化门户基座”的架构：

- Payload CMS 继续负责数据模型、Auth、RBAC、Collections、migration、审计、媒体和 Local API；
- `/dashboard` 是根据 Digital Lattice 设计稿自研的日常运营门户；
- 第一阶段只设计、开发和验收 `/dashboard`；
- Payload 已有 `/admin` 在新版迁移验收前继续作为受限维护入口，不进 Portal 导航、不新增 UI，也不作为 Portal 业务回退；验收后再决定继续维护或下架；
- 官网和运营门户仍运行在同一个 Next.js + Payload 模块化单体中；
- 门户基座与十个业务模块在同一个 Portal V1 Draft PR 内按价值、依赖和负责人逐个 checkpoint；同一 PR 完成统一强化与生产启用配置，不再拆第二个 enablement PR。

数据库、账号、权限、领域状态机、Jobs 和外部平台接口只有一套。迁移期内部维护路径与 Portal 并行存在，
但不属于一期产品形态，也不得被 Portal UI 当作深链或错误兜底。

## 2. 第一性原理

### 2.1 真正需要解决的问题

后台改造的目标不是“把 Payload 换皮”，而是让 1–5 人团队能在一个稳定入口中：

1. 登录后立即知道现在最该处理什么；
2. 在同一上下文里完成内容、素材、客户、会话和异常任务；
3. 只执行自己有权限且领域状态允许的动作；
4. 看见真实的可用、受阻、失败和待补偿状态；
5. 让不同开发者能在统一基座上独立迭代模块。

### 2.2 必须复用的已有资产

- Payload Users Auth、session、三角色 access control；
- 英文 / 阿语 CMS、草稿、版本、多语言、媒体和 SEO；
- ConversationService、知识索引、AI Gateway、PublishingService contract、Jobs 和 Leads；
- 已有 Payload Auth、RBAC、Collections 和内部维护能力；
- PostgreSQL / pgvector、单一 production 部署和现有审计边界。

### 2.3 必须拒绝的重复建设

- 第二套用户、密码、JWT、session 或角色模型；
- 第二套数据库、CMS、媒体存储或 migration；
- 浏览器直接接触模型 key、平台 token、Job payload 或内部状态字段；
- 为尚未完成的模块创建临时 Collection、假接口或伪造成功状态；
- 为当前团队建设运行时插件市场、微前端或多服务 BFF。

## 3. 总体架构

```mermaid
flowchart TB
    STAFF["Admin / Operator / Sales"]
    MAINTAINER["受限技术维护人员"]
    VISITOR["海外客户"]

    subgraph RUNTIME["单一 Next.js 16 + Payload 3 模块化单体"]
        SITE["官网 /en /ar"]
        PORTAL["运营门户 /dashboard"]
        ADMIN["技术维护入口 /admin\n沿用 Payload UI"]

        subgraph PORTALCORE["Portal Core"]
            AUTH["Payload Session Adapter"]
            REG["Module Registry"]
            SHELL["Shell / Navigation / Header"]
            UIC["UI Contract / States / i18n"]
            FLAGS["Module Flags / Maintenance"]
        end

        PAYLOAD["Payload 控制平面\nAuth / RBAC / Collections / Local API / Audit"]
        DOMAINS["领域服务\nCMS / Knowledge / Conversation / Publishing / Jobs / Leads"]
    end

    DATA[("PostgreSQL + pgvector")]
    FILES[("Media Storage")]
    THIRD["AI Provider / Meta / TikTok / LinkedIn / 飞书"]

    STAFF --> PORTAL
    MAINTAINER --> ADMIN
    VISITOR --> SITE
    PORTAL --> PORTALCORE
    PORTALCORE --> PAYLOAD
    PORTALCORE --> DOMAINS
    ADMIN --> PAYLOAD
    SITE --> PAYLOAD
    PAYLOAD --> DATA
    PAYLOAD --> FILES
    DOMAINS --> DATA
    DOMAINS --> THIRD
```

### 3.1 三层职责

| 层       | 入口         | 责任                                    | 不负责                                |
| -------- | ------------ | --------------------------------------- | ------------------------------------- |
| 官网     | `/en`、`/ar` | 对外内容、询盘、ChatWidget              | 内部运营与技术配置                    |
| 运营门户 | `/dashboard` | 日常工作流、跨对象上下文、业务命令      | 密钥、底层 Collection 调试、migration |
| 技术维护 | `/admin`     | 沿用 Payload 的受限配置、诊断和维护能力 | Portal 业务导航、一期新 UI 或业务回退 |

Payload 已有 `/admin` 在迁移验收前只由受限维护人员按 runbook 使用，不进入上述产品分层，也不属于
第一阶段 Portal 设计、开发或验收；迁移验收后再单独决定继续维护或下架。

### 3.2 环境拓扑与边界

```mermaid
flowchart LR
    subgraph LOCAL["本地 worktree（持久但隔离）"]
        LAPP["Portal\nNext.js :3001"]
        LDB[("PostgreSQL :55433\nivybm_portal_v1")]
        LTDB[("串行测试库\nivybm_portal_v1_test / _ci")]
        LMEDIA["本地 seed / 测试 media"]
        LAPP --> LDB
        LAPP --> LTDB
        LAPP --> LMEDIA
    end

    subgraph CI["CI Job（一次性）"]
        CIAPP["build / test / E2E"]
        CIDB[("ephemeral PostgreSQL + pgvector\n*_ci")]
        CIFIX["fixture / 专用测试账号"]
        CIAPP --> CIDB
        CIAPP --> CIFIX
    end

    subgraph PROD["production（本地/CI 不可消费）"]
        PAPP["production app / worker"]
        PDB[("production PostgreSQL")]
        PMEDIA["production media / backups / tokens"]
        PAPP --> PDB
        PAPP --> PMEDIA
    end

    LOCAL -. "禁止数据库、media、备份、URL、token 或外部副作用连接" .-x PROD
    CI -. "禁止数据库、media、备份、URL、token 或外部副作用连接" .-x PROD
```

本地、CI 与 production 不是“同库不同界面”。本地使用当前 worktree 的独立 Compose/端口/volume；
`ivybm_portal_v1_test` 仅允许串行运行，避免共享 seed 账号和 session 竞争。CI 每个 Job 使用自建自销的
PostgreSQL + pgvector service 与 `_ci` 数据库，不复用本机资源。开发验证只使用本地 seed/fixture；需要真实
账号、真实发布或 production 数据迁移的能力统一留在 PR-2 受控启用阶段。

## 4. Portal Core：真正的可插拔基座

模块化的核心不是左侧菜单本身，而是一组所有模块必须遵守的公共契约。

### 4.1 Core 能力

- Auth：读取 Payload session，处理未登录、过期、登出、角色变化；
- Guard：页面、读模型和命令的服务端角色检查；
- Registry：模块 ID、路由、菜单、负责人、成熟度、feature flag；
- Shell：侧栏、Header、账户、语言、主题、窄屏导航；
- UI Contract：按钮、表单、表格、Sheet、Dialog、Badge、状态页；
- State Contract：loading、empty、error、forbidden、blocked、dependency-gated；
- Error Contract：稳定 error code、用户提示、request ID、结构化日志；
- Quality Contract：可访问性、视觉快照、权限矩阵、性能预算；
- Governance：模块 owner、共享文件、Review 和发布边界。

### 4.2 静态模块 Manifest

```ts
export type PortalRole = 'admin' | 'operator' | 'sales'
export type PortalAvailability = 'available' | 'dependency-gated' | 'blocked' | 'admin-only'

export interface PortalModuleManifest {
  id: string
  owner: 'jueyunai' | 'xuemusi'
  navGroup: 'workspace' | 'content' | 'intelligence' | 'operations' | 'system'
  href: `/dashboard/${string}`
  labelKey: string
  allowedRoles: PortalRole[]
  availability: PortalAvailability
  featureFlag: string
}
```

约束：

- Registry 是编译期 TypeScript 数据，不从数据库动态加载代码；
- Registry 决定菜单和状态，但不构成授权；
- Next.js 文件路由仍决定页面是否存在；
- manifest ID、href 和 i18n key 必须有唯一性测试；
- 模块未满足依赖时只注册受阻说明，不注册可产生副作用的命令。

### 4.3 建议目录

```text
src/
├── app/
│   └── (dashboard)/
│       └── dashboard/
│           ├── layout.tsx
│           ├── login/page.tsx
│           └── (protected)/
│               ├── layout.tsx
│               ├── page.tsx
│               ├── settings/page.tsx
│               └── <module>/page.tsx
├── admin-portal/
│   ├── core/
│   │   ├── auth/
│   │   ├── modules/
│   │   ├── navigation/
│   │   ├── i18n/
│   │   ├── ui/
│   │   ├── states/
│   │   └── styles/
│   └── modules/
│       ├── overview/
│       ├── website-content/
│       ├── media/
│       ├── knowledge/
│       ├── content-studio/
│       ├── conversations/
│       ├── leads/
│       ├── platforms/
│       └── operations/
├── admin/                 # 既有内部维护代码；本 Portal 计划不新增或改造
└── modules/               # 既有领域服务和 adapters
```

依赖方向只能是：

```text
app/dashboard
  -> admin-portal/core
  -> admin-portal/modules/<module>
  -> modules/<domain> / access / Payload Local API
```

领域模块不得反向依赖 Portal 页面；协作者模块不得直接修改 Core 私有实现。

## 5. 认证、权限和数据流

### 5.1 登录

- `/dashboard/login` 使用 Digital Lattice 登录视觉；
- 表单调用 Payload `users` login endpoint，成功后使用同一 HttpOnly session cookie；
- 不在 localStorage/sessionStorage 保存 token；
- return target 必须是本站以 `/` 开头且不以 `//` 开头的路径；
- 401 显示凭据错误，429 显示锁定/稍后再试，网络与 5xx 保留输入并允许重试；
- Portal 登录失败必须在 `/dashboard` 内提供明确错误、重试和维护状态，不切换产品入口。

### 5.2 页面读取

```mermaid
sequenceDiagram
    participant U as 用户
    participant P as Portal Page
    participant A as Payload Auth
    participant R as Read Model
    participant D as Payload / Domain

    U->>P: 请求 /dashboard/module
    P->>A: payload.auth(headers)
    alt 未登录
        A-->>P: user = null
        P-->>U: 跳转 /dashboard/login
    else 已登录
        A-->>P: user + permissions
        P->>R: user / role / query
        R->>D: 有界读取，overrideAccess=false
        alt 空结果
            D-->>R: []
            R-->>U: 业务空态
        else 上游错误
            D-->>R: typed error
            R-->>U: 局部错误 + request ID
        else 正常
            D-->>R: 最小字段
            R-->>U: Portal DTO
        end
    end
```

### 5.3 命令写入

- UI 只提交意图，不提交内部权威字段；
- Server Action / Route Handler 再次认证；
- 命令调用现有领域 Service / Port；
- 领域层处理状态机、幂等、权限、审计和事务；
- UI 根据 typed outcome 显示成功、冲突、受阻、失败或结果未知；
- 重复点击、离开页面、慢请求和 stale state 均不得伪造成功。

## 6. 视觉和前端技术栈

### 6.1 采用

- Next.js App Router + React Server Components；
- Tailwind CSS，仅 Portal route 引入；
- shadcn/ui 源码组件，按需复制并映射到 IVYBM token；
- CSS variables，基于 Digital Lattice 的颜色、间距、半径、字体和状态；
- `@tabler/icons-react`，与现有项目保持一致；
- Vitest + React Testing Library + Playwright。

### 6.2 隔离规则

- 不在 root layout 或 Payload `custom.scss` 中导入 Tailwind；
- 禁用 Tailwind Preflight；Portal 不依赖浏览器全局 reset；
- shadcn 配置使用组件前缀，主题变量放在 `.portal-shell` 下；
- 不使用 Payload 内部 DOM class 或私有 UI API；
- Portal CSS 只能作用于 `.portal-shell`，不得污染官网或其他应用路由。

### 6.3 暂缓引入

- Framer Motion：基础 CSS transition 足够；
- Recharts/Tremor：真实指标和决策场景出现后再加；
- TanStack Table：只有高复杂 Data Grid 模块确认需要时再加；
- DND/Kanban：只有领域转换守卫稳定后再加；
- Cmd+K：只有搜索索引、权限过滤和查询预算明确后再加；
- WebSocket：一期使用普通请求/刷新，不为内部小团队提前增加连接复杂度。

## 7. 责任边界

### 7.1 架构图

可单独维护和渲染的源文件：
[管理后台模块化架构与责任边界](管理后台模块化架构与责任边界.mermaid)。
责任边界以本次用户校正为准：AI 内容工作台归 jueyunai；箭头表示数据或业务依赖，不改变模块所有权。

```mermaid
flowchart TB
    subgraph J["jueyunai：平台基座与自有模块"]
        CORE["Portal Core\n登录 / 首页 / Shell / Registry / UI Contract"]
        CMS["官网 CMS\n产品 / 案例 / 图册 / 文章 / SEO"]
        ASSET["素材库\n图片 / PDF / 视频索引"]
        LEAD["线索与飞书入口\n客户档案 / 跟进摘要 / 同步状态"]
        STUDIO["AI 内容工作台\n生成 / 审核 / 发布任务准备"]
        SYS["基础设置 / 本人账户 / 通用异常外壳"]
        DESIGN["整体 IA / Digital Lattice / 视觉验收"]
        SLOT["协作者模块挂载点\n由 Portal Core 提供公共出口"]
    end

    subgraph X["xuemusi：知识、会话与平台服务"]
        KNOW["业务知识库与 AI 调试"]
        PUB["海外平台发布服务\ncapability / publish / status"]
        CHAT["AI 客服公共能力"]
        INBOX["统一会话入口"]
        SOCIAL["海外社媒账号与连接器"]
    end

    CORE --> CMS
    CORE --> ASSET
    CORE --> LEAD
    CORE --> STUDIO
    CORE --> SYS
    CORE --> SLOT
    SLOT --> KNOW
    SLOT --> PUB
    SLOT --> CHAT
    SLOT --> INBOX
    SLOT --> SOCIAL
    ASSET --> CMS
    ASSET --> STUDIO
    KNOW --> STUDIO
    KNOW --> CHAT
    STUDIO --> PUB
    SOCIAL --> PUB
    SOCIAL --> CHAT
    CHAT --> INBOX
    INBOX --> LEAD
    DESIGN -. "设计规范与集成验收" .-> SLOT

    classDef owner fill:#e0f2fe,stroke:#0369a1,stroke-width:2px,color:#0c4a6e
    classDef collaborator fill:#fee2e2,stroke:#dc2626,stroke-width:2px,color:#7f1d1d
    class CORE,CMS,ASSET,LEAD,STUDIO,SYS,DESIGN,SLOT owner
    class KNOW,PUB,CHAT,INBOX,SOCIAL collaborator
    style J fill:#f0f9ff,stroke:#0369a1,stroke-width:2px
    style X fill:#fff1f2,stroke:#dc2626,stroke-width:4px
```

### 7.2 协作规则

- jueyunai 先交付 Core、示例模块、开发指南和 UI contract，并负责 AI 内容工作台；
- jueyunai 负责内容工作台页面、生成/人工审核流程、状态机和 Generated/Review/Publish 共享结构；
- xuemusi 负责知识/AI 调试、统一会话/AI 客服、平台账号/连接器/readiness 和真实发布服务；
- jueyunai 对协作者模块做 IA、视觉一致性和集成验收，不接管平台或会话领域逻辑；
- 共享 Core 变更必须由双方 review；
- 模块只能依赖 Core 公共出口，禁止跨模块导入私有组件；
- 共享 Collection、migration、`src/payload.config.ts` 和跨模块 contract 继续强制另一人 review。

## 8. 模块优先级

| 阶段   | 模块                                     | 价值                           | 前置条件                                       | 负责人                |
| ------ | ---------------------------------------- | ------------------------------ | ---------------------------------------------- | --------------------- |
| P0-1   | Portal Core、登录、Shell、首页、设置 Hub | 建立所有后续模块基座           | 现有 Payload Auth/RBAC/Dashboard               | jueyunai              |
| P0-2   | 官网内容 Hub、产品/案例/文章入口         | 支撑已上线官网日常维护         | CMS 已完成                                     | jueyunai              |
| P0-3   | 素材库 Workspace                         | 支撑官网和 AI 内容的共同资料源 | Media 已完成                                   | jueyunai              |
| P0-4   | 协作者开发指南与示例模块                 | 冻结 Core 公共出口和接入契约   | P0-1 基座稳定                                  | jueyunai              |
| P0-5   | 知识库与 AI 调试                         | AI 客服和内容生产共同基础      | 知识/AI 后端 + P0-4                            | xuemusi               |
| P0-6   | 统一会话与 AI 客服                       | 直接支撑询盘接待和人工接管     | P0-5 + ConversationService                     | xuemusi               |
| P1-1   | AI 内容工作台：生产、审核与发布任务准备  | 建立可追溯的内容流             | 素材/知识 + 正式 Generated/Review/Publish 结构 | jueyunai              |
| P1-2   | 海外社媒账号与 readiness                 | 支撑连接器和发布               | 真实账号/授权/受控联调                         | xuemusi               |
| P1-3   | 线索、飞书同步与提醒                     | 形成销售跟进闭环               | Task 11 Feishu + P0-6 会话 read model          | jueyunai              |
| P1-4   | Jobs 异常与人工补偿                      | 提升可运营性                   | 各模块补偿 contract                            | jueyunai + 模块 owner |
| P1-5   | 受控真实对外发布                         | 在不伪造成功的前提下闭环       | P1-1 + P1-2 + P1-4                             | xuemusi               |
| Future | Pipeline、Cmd+K、Copilot、复杂图表       | 提升效率                       | 真实使用数据证明价值                           | 按模块归属            |

## 9. 分阶段交付

### 9.0 历史状态（2026-07-30，验收口径纠正前）

- D0 已通过：`ivybm-task-p0-p1-admin-portal-v1` / `feat/task-p0-p1-admin-portal-v1`、本地端口 `3001`、Compose project `ivybm-portal-v1`、PostgreSQL `127.0.0.1:55433` 和开发库 `ivybm_portal_v1` 已形成独立闭环；
- P0.1 模块契约与 P0.2 设计系统已完成并通过定向测试、lint、typecheck 和 build；
- P0.3 Payload session、自研登录/登出和受保护 `/dashboard` 已完成定向单元、E2E、lint、typecheck 和 build 验证；
- P0.4 Shell、角色导航、账户菜单和基础设置 Hub 已完成定向单元/E2E、完整 unit、lint、typecheck、build 和 1440/390 视觉核验；
- P0.5 角色安全首页和真实队列已完成，四类队列均提供 Portal 内可复现筛选深链；P0.6 官网内容 Hub 已完成六类内容安全摘要、筛选、状态、真实发布字段与图片 alt 的 EN/AR 完整度、英文/阿语公开预览、角色访问和桌面/移动响应式验证；复杂编辑继续明确受依赖限制；
- P0.7 素材库已完成网格/列表、图片/PDF 安全预览、角色访问和桌面/移动响应式验证；P0.8a 协作者模块包已完成本地契约验证；
- P0.8b 知识/AI 已完成：manifest、read model、index client、Workspace、受保护路由、i18n/CSS、权限集成、桌面/移动 E2E 和视觉检查均已闭环，index client 与后端 `created | duplicate` 契约一致；
- 已完成的读取、权限、索引与视觉测试只证明首批页面 checkpoint，不再等同于业务功能闭环；负责人复核确认五个菜单模块缺页，官网内容、素材和知识仍缺真实 CRUD；
- 允许继续本地开发，不授权连接 production、真实平台副作用、push、PR、合并或部署。

| 决策 Gate                   | 当前结论  | 架构含义                                                        |
| --------------------------- | --------- | --------------------------------------------------------------- |
| 继续本地模块开发            | **GO**    | 本地数据库与 production 完全隔离，按最小 checkpoint 门禁推进    |
| 首批只读页面 checkpoint     | **GO**    | 权限、索引契约、E2E 和桌面/移动读取体验已闭环                   |
| Portal V1 功能闭环          | **NO-GO** | 缺统一会话、线索、内容工作台、平台、异常补偿及三类真实 CRUD     |
| PR-1 Ready / 合并           | **NO-GO** | 还需 xuemusi review、Portal 浏览器 CI 覆盖和最新 head CI policy |
| production 数据、平台与部署 | **NO-GO** | 必须等待 PR-2 的备份恢复、补偿、灰度、回滚、真实授权和人工审批  |

### 9.1 Portal V1 本地功能闭环（2026-07-30，最新）

- 左侧十项导航均已接入真实 `/dashboard` 页面：运营首页、统一会话、线索管理、官网内容、素材库、AI 内容工作台、知识库与 AI 调试、平台状态、异常与补偿、基础设置；`/admin` 仍可独立访问，但没有被 Portal 导航或命令依赖；
- 官网内容已覆盖 Pages、Products、Product Categories、Projects、Posts、Downloads 的 EN/AR 新增、编辑、草稿/发布或启停、预览和引用保护删除；素材库已支持单文件上传、alt/source/公开状态编辑、安全预览与引用保护删除；
- 知识库已支持文档新增、编辑、审核、归档、删除、索引与 Admin-only AI 调试；会话复用 `ConversationService` 完成列表、详情、接管、人工回复和解决；线索按角色范围提供列表、详情、筛选及受保护写入；
- 内容工作台使用正式 `GeneratedContents`、`ContentReviews`、`PublishJobs` 和 `PublishLogs` 完成草稿、人工审核、内部 assisted 排期与时间线。自动对外发布仍被 `ADMIN_PORTAL_PUBLISHING_ENABLED` 关闭，LinkedIn 仅提供本地辅助素材包；
- 平台模块只读取脱敏 readiness，异常模块只展示安全 Job DTO 和已注册的类型化补偿动作。二者都不回显 token、payload、客户正文或完整堆栈；
- 所有 Portal 读写再次认证并经服务端角色与模块开关约束；面向当前用户的 Payload 查询维持 `overrideAccess: false` 和当前 request。当前已具备 mutation-specific 幂等键、版本令牌和 pending UI；统一持久 command receipt / 原子 CAS 是 PR-1 Ready 前的强化项，不影响本地功能运行结论。

| 决策 Gate | 当前结论 | 架构含义 |
| --- | --- | --- |
| Portal V1 本地功能闭环 | **GO** | 十个入口与核心管理任务均可在隔离本地环境完成 |
| PR-1 Ready / 合并 | **NO-GO** | 仍需 xuemusi 对 Portal Core / 知识及共享边界 review、最终 head 的远程 Browser CI / `CI policy`，并完成统一命令幂等与原子冲突处理强化 |
| production 数据、真实平台与部署 | **NO-GO** | 仍需 PR-2 的账号授权、受控发布、补偿、备份恢复、灰度和人工审批 |

正式交付仍只保留两个 PR 边界，但不再把页面编号作为完成边界：PR-1 Portal V1 在本地完成十个导航模块和
可执行的核心管理工作流；PR-2 只负责真实平台、production enablement、受控账号联调和上线。架构表中的
粗粒度阶段编号只表达业务顺序，执行编号和验收命令以 Implementation Plan 为准。

### 阶段 A：基线和基座

交付新 ADR、Portal 路由骨架、设计 token、模块 registry、登录、权限守卫、Shell、首页、
设置 Hub、通用状态和第一批视觉回归。本阶段不新增数据库 migration；项目基线已有 migration 继续按原历史使用。

### 阶段 B：jueyunai 自有业务模块

官网内容 Hub 和素材库已完成 Portal 原生写流程：内容覆盖六类对象的双语编辑与状态管理，素材覆盖上传、
元数据编辑和引用守卫删除。Portal 不通过内部维护入口深链冒充业务完成。

### 阶段 C：协作者模块接入

PR-1 由 jueyunai 交付模块开发指南、示例 manifest、权限/状态测试工具和 UI primitive，并在同一分支接入
知识/AI 与统一会话工作区；xuemusi 在 PR-1 Ready 前完成 Portal Core、知识模块和共享边界 review。

### 阶段 D：依赖受限模块

内容生产、审核、内部排期、平台 readiness 和安全补偿已完成本地工作流；真实账号 readiness、平台 adapter、
回调与类型化外部补偿就绪后，才启用对外发布命令。飞书实际同步与提醒仍等待其领域依赖，不伪造同步成功。

### 阶段 E：效率增强

基于真实使用频率决定 Cmd+K、Pipeline、复杂 Data Grid、图表和 AI Copilot，不提前承诺。

## 10. 失败模式和用户反馈

| 场景         | Portal 行为            | 服务端行为                        | 记录                |
| ------------ | ---------------------- | --------------------------------- | ------------------- |
| 未认证/过期  | 安全跳转登录           | Payload auth 返回 unauthenticated | 不记录密码/token    |
| 无角色权限   | 403 页面或隐藏模块     | 服务端 guard 拒绝                 | actor/module/route  |
| 依赖未完成   | dependency-gated       | 不调用命令                        | dependency code     |
| 模块读取失败 | 局部重试，不拖垮 Shell | typed read error                  | request ID + module |
| stale state  | 提示状态已变化并刷新   | 领域服务拒绝非法 transition       | domain error code   |
| 重复点击     | 按钮 pending/禁用      | 幂等 command                      | idempotency/result  |
| 外部结果未知 | 停止盲目重发           | delivery_unknown                  | correlation ID      |
| CSS/构建回归 | CI 阻止发布            | 无运行副作用                      | visual/build report |

禁止使用“吞掉异常后显示空列表”的降级方式。空数据与读取失败必须是不同状态。

## 11. 安全与性能

- 所有 Portal 页面都在服务端认证；Client Context 只用于展示；
- Local API 对用户读取必须 `overrideAccess: false`；
- 首页不展示完整 transcript、联系方式、Job payload、模型 key 或平台 token；
- 密钥继续由受限内部维护流程写入且不可回显；Portal 不提供入口或深链；
- 查询必须分页、字段选择和确定排序；首页查询预算不超过现有 7 次；
- 结构化日志使用稳定内部 ID，不记录客户消息正文和凭据；
- Portal 总开关和模块开关支持分钟级切换到 Portal 维护态或模块受阻态；
- Core 不引入新数据库表、缓存服务或异步 worker。

### 11.1 开发环境与生产数据边界

- 本地只允许连接当前 worktree 的独立 PostgreSQL/Compose：使用独立应用端口、Compose project、PostgreSQL host port、开发库、volume/network；应用测试库必须显式使用 `_test` / `_ci` 后缀，本地固定测试库串行使用；
- CI 每个 Job 使用自建自销的 PostgreSQL 18.4 + pgvector 0.8.5 service 和 `_ci` 数据库，不复用本机 `127.0.0.1:55433`、Compose project、volume 或 `.env`；
- 任何本地 app、migration、seed、E2E、worker 或脚本都不得读取或写入 production 数据、media/uploads、备份、真实 token 或 production URL；
- 当前实际 `.env` 已核验指向 `postgres://127.0.0.1:55433/ivybm_portal_v1`，被 Git 忽略且权限为 `0600`；本地开发不依赖 production 数据；
- 数据库测试按命令从已核验的本地 URL 显式派生 `ivybm_portal_v1_test` 或 `_ci`；`db:reset:test` 内建 PostgreSQL 协议、loopback host 和 `_test` / `_ci` 后缀保护，外层 worktree/CI preflight 再校验预期端口；Portal 门禁不调用未受这些保护的 `db:migrate:fresh`，不得依赖隐式 production 连接或并发共享测试库；
- development `GO` 只表示允许在隔离环境开发和受控预览，不等于允许真实平台发布、production 数据迁移或 production 部署；
- 线上数据和外部平台操作只能按 PR-2 runbook 在经批准的受控环境与时间窗口执行。

## 12. 质量门禁

开发期采用最小 checkpoint 门禁：当前模块 failing-first 测试、`pnpm typecheck`、必要的角色/access 定向集成、
有写命令时的授权/状态/幂等测试、`git diff --check`，以及一个主桌面和一个窄屏视口的人工检查。纯静态
UI/manifest 不强制启动数据库；不要求每个 checkpoint 重跑完整 suite 或 production build。

PR-1 Portal V1 转 Ready 前必须统一补齐，合并只接受最新 head 的成功 `CI policy`：

- registry/guard/DTO 单元测试；
- 当前角色与 Collection access 的集成测试；
- 成功、空、失败、无权限、受阻状态；
- 重复点击、慢请求、stale state 和返回导航测试；
- 1440、1280、768、390 视觉回归；
- 键盘、焦点返回、44px 触控目标、reduced motion；
- Portal CSS 作用域、官网路由与全局样式隔离回归；
- lint、typecheck、完整 unit/contract/integration/E2E/operations、production build 和 `git diff --check`。

当前 PR-1 本地实现与测试结论为 `GO`：P0.8b E2E/视觉已收口，`db:reset:test` 已内建本地 host/后缀保护，
并已在全新 `_ci` 空库证明 16 条 migration 与连续两次 seed；本地完整门禁也已通过。PR-1 Ready/合并仍为
`NO-GO`，剩余边界是 xuemusi 对 Portal Core/知识模块的 review、远程 CI 对 Portal 浏览器套件的实际覆盖，
以及与最终 head SHA 对齐的成功 `CI policy`。这些阻塞项不否定继续本地开发 `GO`。

开发期可以后补完整回归、全视口视觉矩阵、慢请求、少见错误、完整键盘路径、性能/可观测性优化、体验精修
和非关键通用抽象；只读页面允许先用真实空态、错误态和 `dependency-gated` 跑通流程。不能后补服务端
Auth/RBAC、用户数据 access、错误与空数据区分、测试库防误删、数据/migration 完整性、凭据隔离、外部副作用
幂等、`delivery_unknown`、总开关/模块开关和发布 kill switch。
PR-2 生产启用前必须对最新 head 再次执行同一完整门禁，并在一次性 production-like 演练环境（不设常驻
staging）或经批准的 production 维护窗口追加受控外部平台、类型化补偿、灰度、镜像/数据库回滚、
`/admin` 共存 smoke、外部备份可用性、RPO/RTO 和 restore rehearsal；本地功能跑通或 PR-1 合并均不
构成 production 授权。

## 13. 明确不在首轮范围

- 一次性重做全部 Payload 表单；
- 动态插件市场或微前端；
- 全局 Cmd+K、跨 Collection 搜索；
- Kanban 拖拽与系统不存在的“已成交”状态；
- AI Copilot、自动开发信和自动事实承诺；
- 完整 CRM、提成、复杂审批和多租户；
- WhatsApp 接入、LinkedIn 私信、TikTok 发布；
- 未经人工审核的全自动内容发布；
- 任何临时发布 Collection、伪平台成功或测试 fixture 冒充可用。

## 14. 验收标准

1. 用户只登录一次即可在 `/dashboard` 完成第一阶段日常运营；
2. 关闭 Portal 总开关后可以无数据迁移地进入明确维护态；
3. Admin、Operator、Sales 看见不同模块和数据范围，且服务端测试证明不是仅隐藏菜单；
4. Portal Core 加入一个示例模块不需要修改 Shell 私有代码；
5. 协作者能按文档独立挂载知识库模块并通过统一视觉、权限和状态测试；
6. 官网 CMS、素材、知识、会话等模块只消费已有后端，不复制 Collection；
7. 未完成/受阻模块不会显示伪造数量、伪成功或可点击危险动作；
8. Digital Lattice 设计在桌面和窄屏无溢出，官网与其他路由未被 Portal 样式污染；
9. production 部署拓扑、数据库、媒体和 worker 不因 Portal Core 增加新服务；
10. 文档中不把迁移期 `/admin` 维护能力描述成一期产品入口、交付物或 Portal 回退路径，并明确迁移验收后的继续维护/下架决策 Gate。

## 15. 关联文档

- [ADR-0004：Payload 控制平面与模块化运营门户架构](adr/0004-modular-admin-portal.md)
- [模块化管理后台实施计划](../plans/2026-07-29-modular-admin-portal-implementation.md)
- [CMS 管理后台 UI 重设计设计师简报](../IVYBM-CMS管理后台UI重设计-设计师背景简报.md)
- [一期技术选型与部署架构规划](一期技术选型与部署架构规划.md)
- [一期需求说明文档](../requirements/一期需求说明文档.md)
- [Digital Lattice Pencil 设计稿](../../designs/ivybm-admin-portal-digital-lattice.pen)
