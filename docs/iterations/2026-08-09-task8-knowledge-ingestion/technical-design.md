# Technical design

- 私有 `knowledge-source-documents` / `knowledge-source-assets` 保存来源和抽取图片，Portal API 继续执行 RBAC 与 feature flag。
- `knowledge.ingest` Job 与来源创建、历史知识撤回使用同一 Payload PostgreSQL 事务；worker 在提交前不可见 Job。
- DOCX/PDF parser 执行签名、MIME、ZIP 边界、路径、大小和图片限制；Payload 将 DOCX 识别为 `application/zip` 时仅在 OOXML 验证通过后归一化。
- 翻译 route 禁止回退到旧环境变量模型；缺少 CMS route/prompt 时 fail closed。
- 统一多语言风险策略供 ingestion 标签和 Conversation responder 复用。
- 生产回滚只回滚应用并保留 schema/data；migration down 仅用于一次性隔离测试库。
