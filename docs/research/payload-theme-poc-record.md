# payload-theme 试装 POC 记录

## 范围

- 日期：2026-07-21
- 分支：`feat/task-admin-ui-theme-poc`
- 基线：`origin/main` 的 `42a74f0`
- 试装版本：`payload-theme@0.7.0`
- 应用：Payload `3.86.0`、Next.js `16.2.6`、React `19.2.6`
- POC 只修改依赖、Payload config、Admin SCSS、生成 import map 和专属 E2E；未修改 Collection、migration、领域服务、部署配置或 secret。

## 已验证

- `pnpm install --frozen-lockfile`、`pnpm generate:importmap`、`pnpm lint`、`pnpm typecheck`、非敏感环境的 `pnpm build` 通过。
- `BASE_URL=http://localhost:3001 pnpm test:e2e -- tests/e2e/payload-theme-poc.spec.ts` 在 1600px、1280px、768px 登录页通过。
- 主题登录页的桌面/窄屏视觉和深青行动色可作为自有设计 token 的参考。

## 阻断项

| 项目 | 观察 | 结论 |
| --- | --- | --- |
| 单元测试 | 导入主题时 Vitest 无法解析其省略扩展名的 ESM 内部模块 | 不可进入现有测试基线 |
| 后台国际化 | `Welcome back`、`Search`、`Command palette` 等文案硬编码英文 | 不满足中文后台要求 |
| 全局组件所有权 | 插件无条件接管 Nav 与 Dashboard | 与项目 Custom View 设计冲突 |
| Dashboard | 23 个可读 Collection 最坏约 46 次 Local API 查询；命令面板还可跨集合搜索 | 不适合 2C4G 单机的首页预算 |
| 路由体验 | 主题在 pathname 变化时重建导航组并置换激活项 DOM，关闭预取且加入内部滚动层 | 已复现侧栏视觉闪烁，不值得 fork 修补 |

## 结论

`payload-theme@0.7.0` 不作为 IVYBM 生产依赖，也不作为后台架构基础。保留其少量视觉灵感；
当前 `/dashboard` 自研 Portal 与 `/admin` 技术后台边界按
[`ADR-0004`](../architecture/adr/0004-modular-admin-portal.md) 实施。Portal 不使用该插件。

浏览器强制刷新时的 hydration 报错来自 Immersive Translate 向 `<html>` 注入属性；这与 Payload 或主题服务端渲染无关，应对 localhost 禁用该扩展，而不是通过应用代码规避。
