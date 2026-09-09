# Implementation Plan: Website/CMS v1.7

- [ ] 1. 冻结内容模型与生成类型
  - [ ] 修改 `[MODIFY] src/collections/Posts.ts`，增加向后兼容的 `contentType`/等价标识，保留现有 News 值。
  - [ ] 新增 migration、更新 `[MODIFY] src/payload-types.ts`（由生成命令产生），补充 Posts 内容类型契约测试。
  - [ ] 共享 Collection、migration、Payload 注册必须由 xuemusi review。
  - _Requirement: Knowledge 与 News 隔离_

- [ ] 2. 更新网站数据查询、缓存和 sitemap
  - [ ] 修改 `[MODIFY] src/lib/website-data.ts` 的 Posts 查询签名，增加内容类型过滤和 Payload 英文回退。
  - [ ] 修改 `[MODIFY] src/hooks/revalidateContent.ts`，按内容类型刷新 News/Knowledge 列表和详情。
  - [ ] 修改 `[MODIFY] src/app/sitemap.ts`，按内容类型分流 URL，并实现阿语最小完整度索引门槛。
  - [ ] 修改/新增 `[MODIFY] src/app/(frontend)/[locale]/knowledge/page.tsx`、`[NEW] src/app/(frontend)/[locale]/knowledge/[slug]/page.tsx` 及其测试。
  - _Requirement: 缓存、sitemap、公开路由_

- [ ] 3. 导航、页面骨架与 CMS 结构化字段
  - [ ] 修改 `[MODIFY] src/components/website/SiteHeader.tsx`、`src/components/website/SiteFooter.tsx`、`src/lib/i18n.ts`，固定 Tab 顺序和 `Upload Drawing` 文案。
  - [ ] 修改 `[MODIFY] src/collections/Pages.ts` 或页面 manifest，增加 Capabilities/For Professionals 结构化 blocks/数组字段。
  - [ ] 修改/新增前台页面与组件：`src/app/(frontend)/[locale]/capabilities/page.tsx`、`src/app/(frontend)/[locale]/for-professionals/page.tsx`、对应骨架组件和 Portal 编辑器。
  - [ ] 缺失字段隐藏区块，保持深蓝主题，不使用 emoji 图标或紫粉渐变。
  - _Requirement: 导航与结构化 CMS_

- [ ] 4. 询盘上传体验与 Portal 性能
  - [ ] 修改 `[MODIFY] src/components/inquiry/InquiryForm.tsx`，加入前置校验、逐文件进度、取消、单文件重试、120 秒超时和无图纸柔性文案。
  - [ ] 保持 `[MODIFY] src/lib/inquiries/handler.ts`、`src/modules/lead-attachments/**`、Feishu 映射契约兼容；只在必要时补测试。
  - [ ] 若启用徽标/筛选，修改 `[MODIFY] src/admin-portal/modules/leads/**`，以批量聚合查询替代 N+1。
  - _Requirement: 询盘转化与性能_

- [ ] 5. 手动清理脚本与运维证据
  - [ ] 新增/修改 `[NEW/MODIFY] scripts/lead-attachments-cleanup.*`，支持 dry-run、统计、失败退出码、审计日志。
  - [ ] 更新 `[MODIFY] docs/operations/部署手册.md` 与 `[MODIFY] docs/开发进度.md`；不修改 worker 周期调度。
  - _Requirement: 180 天保留_

- [ ] 6. 定向验证与 Review
  - [ ] 运行 `pnpm typecheck`、`pnpm lint`、相关 unit/integration/e2e 测试和 `git diff --check`。
  - [ ] 对共享 Collection、migration、Feishu contract、Portal 读模型请求 xuemusi 独立 review。
  - [ ] 记录 base SHA、head SHA、CI policy、测试证据和回滚说明；未获客户整体替换确认前不部署 production。
  - _Requirement: 全部验收标准_

## Out-of-Scope

- [ ] 不删除或批量迁移 News，不改变既有 `/news` URL。
- [ ] 不自动摄取 KnowledgeDocuments，不自动生成或发布社媒内容。
- [ ] 不把附件清理改成 worker 定时调度。
- [ ] 不引入新的上传基础设施、对象存储或后台框架。
