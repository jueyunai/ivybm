# Task 8 知识文档自动解析与翻译 PRD

## Sources

| Source | Date | What it contributes |
| --- | --- | --- |
| 用户对话与确认截图 | 2026-08-09 | 上传后自动解析、优先自动翻译、图片尽量支持 |
| 4 份真实 DOCX 与 1 个 ZIP 本地样本 | 2026-08-09 | DOCX 大小、表格、内嵌图片和批量资料验收样本；原件不得入 Git |
| 一期需求与 Task 8 既有实现 | 2026-07 至 2026-08 | 英文/阿语知识、人工审核、索引、引用和高风险转人工基线 |

## Goal

管理员或运营人员上传 DOCX/PDF 后，系统私有保存原件，异步提取正文、表格和 DOCX 内嵌图片，自动生成英文与阿语知识草稿，并在人工审核前保持不可公开、不可进入客户检索。运营人员能看到处理阶段、失败原因、重试入口、来源和生成结果。

## Non-goals

- 不自动审核、自动设置 `customerVisible`、自动索引或部署 production。
- 不对价格、交期、付款、质保、寿命、认证、结构/防火性能、海关结果或责任归属作事实确认。
- 本批次不解析 ZIP、PPT、Excel、音视频，不做扫描件/图片 OCR 或图片语义理解。
- 不把原始客户文档、解压产物、本地数据库、测试 Key 或生成的验收截图提交到 Git。
- 不做 AI 语义拆条；第一版按一个来源文件生成一个英文草稿和一个阿语草稿，后续索引继续使用现有确定性切片。

## User Journey

1. Admin/Operator 在知识库页面选择 DOCX/PDF，填写来源标题、类型、版本和原文语言（可自动识别）。
2. 系统校验文件名、MIME、文件签名、大小和 SHA-256，将原件保存到知识库专用私有集合并幂等排队。
3. Worker 依次显示 `queued -> parsing -> translating -> needs_review`；失败显示安全错误和 Admin 重试入口。
4. DOCX/PDF 正文和表格被提取；DOCX 内嵌图片作为私有来源图片保存并可在后台预览。PDF 可预览原件，PDF 图片抽取不属于本批次。
5. 系统识别原文语言，调用受控 AI route 分段生成英文、阿语版本，记录模型、提示词版本和来源哈希。
6. 两个版本写入 `knowledge-documents`，强制为 `draft / customerVisible=false / pending`，并显示高风险主题标签。
7. 运营人员校对后沿用现有审核、索引和 AI 调试流程；只有 `reviewed + ready + customerVisible` 才能用于客户回答。

## Product And UI Acceptance

- 首屏 5 秒内能看懂“上传资料后自动解析并生成双语草稿”，主按钮是“上传并生成草稿”。
- 上传中、排队、解析、翻译、待审核、失败和重试都有明确状态；不显示内部异常栈、密钥、原始 prompt 或向量。
- 来源列表显示文件名、版本、语言、大小、处理阶段、图片数、输出语言和更新时间。
- 来源详情可预览 DOCX 抽取图片，能跳转到英文/阿语草稿；图片和原件均保持私有访问。
- 360px/390px 无横向溢出；移动端上传表单、状态和错误说明可读。
- 文案不得暗示机器翻译已经通过业务审核；高风险标签必须解释为“需要人工确认”。

## Acceptance Criteria

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC-01 | Admin/Operator 可上传合法 DOCX/PDF，Sales/匿名不可上传 | integration + E2E |
| AC-02 | 非法扩展名、伪造 MIME/签名、路径文件名、空文件、超限文件 fail closed | unit + integration |
| AC-03 | 相同文件哈希与版本重复提交不会生成重复来源或重复 Job | integration |
| AC-04 | DOCX 正文、标题、表格和内嵌图片可提取；PDF 文本可提取 | parser fixtures + real local samples |
| AC-05 | 生成英文与阿语两个草稿，记录来源、哈希、模型和提示词版本 | integration + local model evidence |
| AC-06 | 自动产物始终为 `draft / customerVisible=false / pending`，不能由上传请求覆盖 | state transition tests |
| AC-07 | 价格/交期/质保等中英阿高风险内容显示标签并继续由问答层转人工 | unit + E2E |
| AC-08 | 解析/翻译失败不产生可见知识；Admin 可安全重试，Operator 看到需处理状态 | integration + E2E |
| AC-09 | 原文或来源版本变化后旧翻译回到 draft、索引失效，不继续作为客户知识 | integration |
| AC-10 | 既有手工知识 CRUD、审核、索引、引用和 AI 调试不回归 | existing unit/integration/E2E |
| AC-11 | 原件与抽取图片不公开，API 不泄露服务器路径、Key、prompt 或异常栈 | access/security tests |
| AC-12 | 4 份本地 DOCX 可处理；20MB 级样本不阻塞进程或超出明确限制 | local acceptance report |

## Open Questions And Assumptions

| Item | Type | Decision |
| --- | --- | --- |
| 中文是否直接进入客户问答 | Decision | 否；中文保留为来源，客户知识只生成英文/阿语 |
| 自动产物能否直接公开 | Safety decision | 不能；人工审核门禁不可关闭 |
| 图片支持含义 | Assumption | 本批次为提取、私有保存和预览；OCR/图片理解后续 |
| ZIP | Decision | 本批次明确拒绝并给出可理解提示；后续做受限批量容器 |
| 文档拆条 | Decision | MVP 不做语义拆条；一个来源生成每语言一条草稿，索引时确定性切片 |
