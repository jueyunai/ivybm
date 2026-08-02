# Task 8 知识库运营闭环补充计划

## 背景

Task 8 原计划完成了知识文档、审核状态、切片、向量检索和供应商网关，但一期初版只提供受保护的索引 API，没有给运营人员可直接使用的提交索引、失败重试和问答验收界面。本补充计划只收口现有能力，不新增 Collection、migration 或外部模型协议。

## 用户故事

1. 运营人员在已审核知识文档页提交索引，并能看到任务 ID、队列状态和最终文档状态。
2. 管理员在索引失败时通过同一服务端入口重试，运营人员不能绕过管理员重试边界。
3. 管理员或运营人员在后台输入英文或阿语问题，按官网客服的相同知识可见性、提示词和安全转人工规则预览结果。
4. 本地开发者可以显式导入标注为 DEMO 的知识和客服提示词；默认 seed 与 production 不把演示事实当作客户批准资料。

## 实现边界

- 复用 `POST /api/knowledge/documents/{id}/index`、Jobs、worker 和幂等键，不从浏览器直接修改系统索引字段。
- 新增 admin/operator-only 的知识预览 API；只返回回答、引用、模型、提示词版本和 token 摘要，不返回模型密钥、向量或内部 prompt 拼接结果。
- 后台索引操作使用 Payload 的 `beforeDocumentControls` 公开扩展点；问答验收使用自定义 Admin view。
- DEMO 数据必须显式开关、标题带 `[DEMO]`，正文声明不构成生产事实；production 拒绝启用。
- 不修改会话公共契约，不创建新的数据库结构，不部署 production。

## 验证

- unit：索引按钮状态、导航与 Admin 注册、预览输入和路由鉴权/脱敏。
- integration：复用现有知识索引、检索和 chat runtime 测试；新增 DEMO seed 幂等验证。
- browser：管理员/运营人员可见入口，draft/processing/ready/failed 行为正确，英文/阿语预览及高风险转人工可见。
- quality：import map、lint、typecheck、unit、定向 integration、production build、`git diff --check`。
