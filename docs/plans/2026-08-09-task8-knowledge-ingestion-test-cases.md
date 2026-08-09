# Task 8 知识文档自动解析与翻译测试用例

| ID | Area | Setup | Steps | Expected | Evidence |
| --- | --- | --- | --- | --- | --- |
| API-001 | RBAC | admin/operator/sales/anonymous | 上传合法 DOCX | admin/operator 201；sales/anonymous 403/401 | integration |
| API-002 | Upload validation | 伪 MIME、ZIP、空文件、路径名、超限文件 | 分别上传 | fail closed；无 source/job/file 残留 | unit + integration |
| API-003 | Idempotency | 同一 hash/version | 重复提交同一 idempotency key 与不同 key | 返回同一 source/job，不重复扣费 | integration |
| PARSE-001 | DOCX | 标题、段落、表格 fixture | 运行 parser | 顺序稳定，表格可读，无 OOXML/XML 泄漏 | unit |
| PARSE-002 | DOCX image | 两张内嵌图片 fixture | 运行 parser/handler | 两个私有 asset，稳定占位符、哈希与顺序 | unit + integration |
| PARSE-003 | PDF | 多页文本 PDF | 运行 parser | 文本与页数正确 | unit |
| PARSE-004 | Scanned PDF | 无文本 PDF | 运行 parser | `ocr-required`，不调用模型 | unit |
| PARSE-005 | Limits | 过多/过大图片、超长文本 | 运行 parser | 受控失败，无部分可见结果 | unit |
| STATE-001 | Happy path | fake text gateway + active translation prompt | worker 处理 source | queued→processing→needs_review；生成 en/ar draft | integration |
| STATE-002 | Invariants | 上传请求伪造 reviewed/visible/ready | 提交 | 字段被忽略；输出固定 draft/false/pending | integration |
| STATE-003 | Partial translation | EN 成功、AR 超时 | 处理并重试 | 未进入 needs_review；重试幂等完成两语言 | integration |
| STATE-004 | Source revision | 关联知识已 reviewed/ready/visible | 重新处理新版本 | 处理开始即退回 draft/pending/hidden | integration |
| STATE-005 | Lease loss | worker 在模型返回前失租 | 新 owner 接管 | 旧 owner不能写资产/草稿/完成状态 | integration |
| RISK-001 | Policy | 中英阿高风险语料 | 检测 | 稳定风险标签；客户问答仍 handoff | unit |
| AI-001 | Translation fidelity | 含尺寸、牌号、表格、图片占位符样本 | fake/real model 翻译 | 数字、单位、占位符保留，不新增承诺 | fixture + local JSON |
| AI-002 | Missing config | 无 route 或 prompt | 处理 | action-required/failed；无草稿公开 | integration |
| UI-001 | Desktop | admin + sources | 上传并查看状态/详情 | 主 CTA、阶段、错误、输出跳转和图片预览清晰 | Playwright screenshot |
| UI-002 | Mobile 360/390 | 同 UI-001 | 完整走查 | 无横向溢出/重叠，错误与 CTA 可读 | Playwright screenshot |
| UI-003 | Retry boundary | operator/admin + failed source | 点击重试 | operator 无越权；admin 幂等重试 | E2E |
| SEC-001 | Private files | anonymous/sales/admin | 请求原件和 asset URL | 仅有权限角色可读；不泄露绝对路径 | integration |
| REG-001 | Existing knowledge | 既有手工知识 | CRUD→review→index→preview | 现有流程不回归 | existing suites |
| MIG-001 | Migration | PostgreSQL 18 + pgvector 空库/升级库 | full up/down/up | 线性通过，既有数据保持 | migration log |
| REAL-001 | Local DOCX | 4 份仓库外真实 DOCX | 本地上传处理 | 全部进入明确成功或可行动失败状态；20MB 样本不 OOM | acceptance report |
| REAL-002 | Real model | 本地加密测试 route | 翻译代表性片段 | EN/AR 生成；usage log 有证据；Key 不出日志 | acceptance report |
| PROD-001 | Production | 未获部署批准 | 检查本 PR | 不部署；记录正式 route/prompt/Key 人工动作 | PR checklist |

## Required Quality Gate

- `corepack pnpm generate:types`
- `corepack pnpm generate:importmap`（如 Payload admin import 变化）
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test:unit`
- 定向 contract/integration/operations/E2E
- PostgreSQL 18 + pgvector migration up/down/up
- `corepack pnpm build`
- `git diff --check`
- 独立测试 agent 报告 + 主代理逐项复核
