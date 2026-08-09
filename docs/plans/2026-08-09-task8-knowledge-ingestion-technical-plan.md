# Task 8 知识文档自动解析与翻译技术方案

## Architecture / Data Flow

```text
Portal multipart upload
  -> protected knowledge source command + command receipt
  -> private KnowledgeSourceDocuments upload collection
  -> knowledge.ingest Job (hash + revision idempotency)
  -> worker parser port (DOCX/PDF)
  -> private KnowledgeSourceAssets (DOCX embedded images)
  -> controlled text route + versioned translation prompt
  -> EN/AR KnowledgeDocuments drafts
  -> existing manual review -> index Job -> customerVisible retrieval
```

## Persistence

### `knowledge-source-documents`（新增，Task 8 私有上传集合）

- 上传类型只允许 DOCX/PDF，单文件上限 30 MiB；原文件不进入公共 `Media`。
- 保存来源标题、来源类型、来源版本、原文语言、检测语言、SHA-256、文件大小、处理状态/阶段、parser 版本、抽取正文、页数/图片数、当前 Job、错误摘要和完成时间。
- 状态由服务端维护：`queued / processing / needs_review / failed / archived`；阶段为 `queued / parsing / translating / finalizing / complete`。
- 访问：admin/operator read/create；仅 admin 可重试/归档；sales/匿名无权访问；任何文件读取继续受集合 access control。

### `knowledge-source-assets`（新增，Task 8 私有上传集合）

- 保存 DOCX 内嵌图片，关系指向来源文档，记录稳定序号、原始名称/MIME、SHA-256 和可访问性说明。
- 只允许安全图片 MIME，单图和每文档总量均有限制；默认不公开。

### `knowledge-documents`（扩展）

- 新增 nullable `ingestionSource`、`sourceHash`、`sourceAnchor`、`generationModel`、`generationPromptVersion`、`riskTopics`。
- 自动生成命令不接受客户端传入 review/index/customerVisible 系统状态，写入时固定 `draft / false / pending`。
- 同一 ingestion source + locale 只保留一个当前草稿；重新处理以 CAS/revision 更新并触发现有 review/index reset hook。

## Parsing And Translation Ports

- `KnowledgeDocumentParser` 接受受限 Buffer + MIME，返回标准化文本、检测语言、页数/段落统计和图片 Buffer 元数据。
- DOCX 使用 OOXML-aware parser，保留段落/标题/表格阅读顺序，图片用稳定占位符关联 source asset；禁止宏执行和外部关系抓取。
- PDF 只提取文本和页数；空文本/扫描 PDF 返回明确 `ocr-required`，不猜测内容。
- 语言检测使用确定性字符比例（中文/阿语/拉丁）并允许上传者显式选择；不额外调用模型做检测。
- 翻译按稳定字符预算分段，使用新增 `knowledge.translation` text usage route；每段 instructions 强制忠实翻译、保留单位/数字/占位符、不补事实。
- prompt 优先读取 active `purpose=translation` 模板；没有有效模板/route 时 fail closed，不创建半公开知识。
- 翻译结果和 telemetry 不记录 API Key、拼接后完整 prompt 或原始文件路径。

## High-risk Policy

- 抽取中英阿价格、报价、折扣、付款、交期、质保、寿命、认证、结构、防火、海关、运费、保险和责任主题，保存稳定枚举标签。
- 标签仅用于审核提示，不自动删除原文、不自动批准事实；现有 `requiresHumanReview` 继续作为客户问答的权威安全门禁。

## Contracts

| Surface | Change | Compatibility |
| --- | --- | --- |
| Payload config/types | 注册两个 Task 8 私有集合并扩展 KnowledgeDocuments | migration + generated types；需另一开发者 review |
| Portal read model | 增加来源列表、状态、输出文档和图片摘要 | feature flag/RBAC 保持现有知识模块边界 |
| Portal commands/API | multipart upload、Admin retry、来源详情 | command receipt + idempotency key；不直接改 Jobs owner/status |
| Jobs/worker | 注册 `knowledge.ingest` handler | 复用现有 lease/heartbeat/retry；无独立队列 |
| AI registry | 新增 `knowledge.translation` usage key | 未配置时 fail closed，不回退到客户回复 route |
| KnowledgeDocuments | 增加生成来源和风险元数据 | 手工创建字段均 nullable，不改变现有检索 SQL 门禁 |

## Failure Modes

| Failure | User impact | Handling | Evidence |
| --- | --- | --- | --- |
| MIME/签名不匹配 | 上传被拒绝 | 415，安全文案，无文件落库 | API tests |
| 重复上传 | 可能重复扣费/草稿 | hash+version+job idempotency 返回现有记录 | integration |
| DOCX 损坏/外部关系 | 无法解析 | fail closed，来源 failed，可 Admin 重试 | parser tests |
| 扫描 PDF | 无文本 | `ocr-required`，不调用翻译 | parser tests |
| 图片过多/过大 | 内存/磁盘风险 | 单图、总数、总字节限制；来源 failed | limit tests |
| AI route/prompt 缺失 | 无翻译 | failed + action-required，不生成可见知识 | integration |
| 模型超时/限流 | 处理延迟 | Jobs 标准重试；幂等写入 | worker tests |
| worker 丢 lease | 旧执行污染新结果 | 每个持久化阶段核验 job owner/revision | concurrency test |
| 部分语言成功 | 结果不完整 | 来源不进入 needs_review；重试覆盖当前 revision | integration |
| 来源重处理 | 旧 reviewed 知识可能继续可见 | 开始重处理即先 CAS 退回关联文档 draft/pending/hidden | integration |

## Observability

- 记录 source ID、job ID、stage、parser/version、输出语言、token/耗时和安全错误码。
- 不记录原始正文、图片内容、密钥、服务器绝对路径或完整 prompt。
- Portal 展示可行动状态；Operations 继续读取标准 Jobs 状态。

## Deployment / Rollback

- 本 PR 不部署 production。migration 的 up/down/up 只允许在一次性、隔离的 PostgreSQL 18 + pgvector 验证库执行；`down` 会删除 Task 8 表/字段，绝不能作为 production rollback，也不能连接含客户数据的环境。
- 发布前先停止旧 worker、运行 migration，再启动 app/worker；新增 handler 未启用时不会被旧 worker消费。
- production 回滚只回滚应用镜像/代码：先停止新 ingestion，保留新增表、nullable 字段和全部数据，避免删除客户原件。任何 schema/data 删除另需人工批准；若需验证 down/up，必须使用隔离 disposable 库并在验证后销毁。
- `ADMIN_PORTAL_KNOWLEDGE_ENABLED=false` 时不暴露上传/重试入口。

## Concurrency And Review Boundary

- 分支：`feat/task-8-knowledge-ingestion`；worktree：`ivybm-task8-knowledge-ingestion`。
- 修改 migration、`src/payload.config.ts`、Jobs handler 注册和知识公共结构，必须请求另一名开发者 review。
- luna_worker 负责实现；主代理负责需求、逐文件审查和最终修正；独立测试 agent 负责执行测试与验收，不复用开发者结论。

## Files Expected To Change

- `src/collections/KnowledgeSourceDocuments.ts`
- `src/collections/KnowledgeSourceAssets.ts`
- `src/collections/KnowledgeDocuments.ts`
- `src/modules/knowledge/ingestion/**`
- `src/admin-portal/modules/knowledge/**`
- `src/app/api/portal/knowledge/**`
- `src/worker.ts`
- `src/modules/ai/registry.ts`
- `src/payload.config.ts`、`src/payload-types.ts`、新 migration
- 对应 unit/integration/E2E、i18n、运维与进度文档
