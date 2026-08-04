# Admin Portal Module Guide

本文档是 `/dashboard` 业务模块的公共接入契约。Payload CMS / PostgreSQL 继续是唯一 Auth、RBAC、数据、migration、审计和领域控制平面；Portal 模块只负责安全 read model、领域 command 适配和 UI。

## 1. 目录与公共出口

每个模块放在 `src/admin-portal/modules/<module-id>/`，至少包含：

- `manifest.ts`：owner、角色、导航分组、feature flag、可用状态和 command ID；
- `get<Name>Page.ts`：服务端有界 read model；
- `<Name>Workspace.tsx`：只消费安全 DTO 的页面；
- 对应 unit/contract、integration 和 E2E 测试。

模块定义只从 `@/admin-portal/core/modules` 导入，UI primitive 只从 `@/admin-portal/core/ui` 导入。Never import another business module 的组件、read model 或私有 helper；跨模块协作必须先冻结领域 port/interface 或提升为 Core 公共契约。

## 2. Manifest 与功能开关

```ts
import { definePortalModule } from '@/admin-portal/core/modules'

export const SAMPLE_MODULE = definePortalModule({
  id: 'sample',
  owner: 'xuemusi',
  navGroup: 'intelligence',
  href: '/dashboard/sample',
  labelKey: 'sample',
  allowedRoles: ['admin', 'operator'],
  availability: 'available',
  featureFlag: 'ADMIN_PORTAL_SAMPLE_ENABLED',
  commands: ['sample:refresh'],
  maintenance: { responsibleOwner: 'xuemusi', nextStepKey: 'sample' },
})
```

总开关和模块 feature flag 只有精确字符串 `true` 才启用。缺失、拼写错误、`false` 或空白一律 fail closed。`dependency-gated` / `blocked` 模块不得注册 command；模块 flag 关闭时 resolver 必须清空 commands，页面也不得预加载副作用 handler。

Portal 路由必须位于 `/dashboard`，不得导航或 deep-link 到 `/admin`。内部维护入口是否保留不改变模块契约。

## 3. Auth、RBAC 与 read model

页面先调用 `requirePortalUser`，再用当前 Payload 用户构造 `req`。读取用户可见数据必须同时满足：

- `overrideAccess: false`；
- 传入当前 `req`；
- `depth: 0` 或明确关系展开；
- 显式 `select` 安全字段；
- 有界分页和确定排序；
- DTO 不含凭据、token、内部 owner、Job payload、完整客户正文或内部维护 href。

Sales 数据范围由 Collection access 或领域服务决定，Client Component 不得自行模拟权限。模块 flag、角色或依赖未满足时，必须在执行 read/command 前返回明确状态。

## 4. Command 与状态守卫

UI 只表达用户意图。任何写操作必须调用既有领域 service 或受保护 route，不能直接写权威状态、owner、revision、审计字段或 worker 字段。

Command 必须定义：

- 稳定 command ID 与模块命名空间；
- 服务端角色授权；
- 当前状态/revision 守卫；
- idempotency key 和重复提交语义；
- pending 防重复；
- 稳定错误码与可重试策略；
- 外部结果未知时停止盲重试。

没有正式 command contract 时，使用 `dependency-gated`，不要用临时 Collection、浏览器直写或假成功绕过。

## 5. UI 状态与错误

每个模块必须区分 loading、empty、error、forbidden、blocked、dependency-gated、portal-disabled、module-disabled 和 available。禁止吞掉异常后显示空列表。

错误文案只暴露稳定错误码和下一步；structured log 使用 module、operation、request/correlation ID、actor ID 和安全资源 ID，不记录 token、密码、客户消息正文或第三方响应原文。

## 6. 测试与验收

最小 checkpoint 需要：

1. unit 或 contract test 先红后绿；
2. 角色、flag、状态和 command 裁剪测试；
3. 读取 Payload 用户数据时，用 `_test` / `_ci` 数据库验证 `overrideAccess: false`；
4. 写命令覆盖授权、状态守卫、idempotency 和重复点击；
5. E2E 覆盖成功、空、失败、无权限和 disabled 状态；
6. 1440px 桌面与 390px 窄屏人工检查；
7. lint、typecheck、Prettier 和 `git diff --check`。

PR Ready 前统一运行完整 unit、contract test、integration、E2E、operations 和 production build，并由公共契约 reviewer 复核最新 head。

## 7. 最小示例

`src/admin-portal/modules/example/` 展示 manifest、角色/flag 解析、公共 UI primitive 和显式状态。它不注册到生产 registry、不访问领域数据、不提供真实 command handler，只作为接入 contract test 的固定 fixture。
