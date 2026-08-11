# Requirements review

## Scope

- Admin/Operator 私有上传 DOCX/PDF，异步解析正文、表格和 DOCX 图片。
- 通过独立 `knowledge.translation` route 生成英文、阿语草稿。
- 自动产物始终保持 `draft / customerVisible=false / pending`，人工审核后才能索引和用于客户回答。
- 价格、交期、质保等 13 类中英阿高风险问题统一转人工。

## Non-goals

- 不自动审核、公开、索引或部署 production。
- 不处理 ZIP/PPT/Excel/音视频、扫描 PDF OCR 或图片语义理解。
- 不提交客户原件、测试 Key、数据库、uploads、截图或生成验收文件。

## Acceptance

以 `docs/plans/2026-08-09-task8-knowledge-ingestion-prd.md` 的 AC-01～AC-12 和测试矩阵为准；production 配置、正式 Key、业务内容批准与发布审批均作为外部门禁。
