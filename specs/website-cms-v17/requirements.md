# Website/CMS v1.7 Requirements (Archived Snapshot)

> [!NOTE]
> **状态：已归档历史规格快照（Archived / Non-executable）**
> - **实施对应**：本规格已于 2026-09-01 由 **PR #117**（Commit `4bfd0a1`）完整实现并合入 `main`。
> - **当前基线**：当前唯一最高优先级冲刺计划为 [`docs/plans/2026-08-10-MVP范围冻结与交付冲刺.md`](../../docs/plans/2026-08-10-MVP范围冻结与交付冲刺.md)。本文档作为历史设计快照存档，不作为当前执行合同。

关联基线：[`docs/requirements/2026-08-29-官网与CMS改版及素材上架需求任务书.md`](../../docs/requirements/2026-08-29-官网与CMS改版及素材上架需求任务书.md)

## 目标

在保持 16 个产品、71 个项目和既有 News URL 兼容的前提下，建立新的官网导航与内容框架、公开 Knowledge 模块、结构化 CMS 编辑能力，并强化询盘附件转化体验。官网 CMS、AI 客服知识库和 AI 内容工作台继续解耦。

## 用户故事

1. 作为海外工程采购者，我可以从顶部导航按 `Products → Capabilities → Projects → For Professionals → Knowledge → News → About` 浏览内容，并可通过 `Upload Drawing` 提交有图纸或无图纸的需求。
2. 作为运营人员，我可以在 `/dashboard` 编辑和发布 Capabilities、For Professionals、Knowledge 的结构化内容，内容缺失时页面仍能安全降级。
3. 作为 SEO/内容运营人员，我希望 Knowledge 发布后立即刷新对应页面和 sitemap，同时旧 News 页面、slug 和链接保持不变。
4. 作为阿拉伯语访客，我在翻译不完整时仍能看到英文回退内容，RTL 页面不发生数字/型号错乱；未达到阿语完整度的页面不伪装成完整阿语索引页。
5. 作为询盘客户，我可以看到附件可选、上传进度、取消和单文件重试，不因没有图纸或单个文件失败而被误导。

## EARS 验收标准

- 当访问任一公开页面时，系统应显示固定顶部导航顺序；Home、Contact 路由仍可访问但不作为 Tab。
- 当运营人员发布 Knowledge 内容时，系统应刷新 `/[locale]/knowledge` 列表和详情路径，并在 sitemap 中生成 Knowledge URL；News 内容只能生成 `/news` URL。
- 当 Knowledge 与 News 使用同一 Posts 集合时，系统应以内容类型/分类标识分流查询和路由；slug 冲突应返回明确保存错误，不自动改写。
- 当运营人员编辑 Capabilities 或 For Professionals 时，系统应保存结构化 blocks/数组字段，并由固定前台骨架渲染；空字段区块应隐藏。
- 当阿语主要字段未达到最小完整度时，系统应允许页面英文回退但不输出该页 `hreflang="ar"` 或阿语 sitemap 条目。
- 当访客选择附件时，系统应立即校验扩展名/大小，并逐文件显示进度、取消和重试；附件字段不得成为无图纸询盘的必填项。
- 当启用 Portal 附件徽标/筛选时，系统应按当前页 Lead ID 批量聚合查询附件数量，不得循环逐条查询。
- 当执行附件清理时，系统应继续使用手动脚本，不新增 worker 周期调度；脚本需支持 dry-run、统计和失败返回码。

## 业务约束与非目标

- 保持现有深蓝品牌配色；不替换 News，不删除 `/news` 或既有文章。
- 不把官网 Knowledge 自动摄取到 AI 客服知识库，不因 CMS 保存触发社媒生成/发布。
- 不改变附件“永久稳定 Portal 链接 + 登录鉴权”的飞书契约。
- 不引入新的内容 Collection，除非设计阶段证明 Pages/Posts 无法满足且另行批准。
