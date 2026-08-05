# Portal AI 配置设计

## 目标

在新版 `/dashboard/settings` 中提供仅管理员可见的 AI 配置入口，让运营负责人可以完成 AI 供应商、文本/向量模型以及用途路由配置，而无需进入 Payload `/admin`。AI 客服与内容工作台共用 `chat.reply`，知识索引和客服检索使用 `knowledge.embedding`。

## 方案选择

采用 Portal 专用读写层，复用现有 `AiProviders`、`AiModelProfiles`、`AiUsageRoutes` Collection。

- 不让浏览器直接调用 Payload REST，避免把通用数据库接口暴露为 Portal 业务契约。
- 不新建 Collection、migration、Payload 注册或生成类型，降低与 PR #58 的共享结构冲突。
- 不在 Portal 返回 `apiKey` 或密文；仅返回 `apiKeyConfigured`。
- 所有写入使用当前用户的 Payload request、`overrideAccess:false`、现有 Collection validation/audit hook 和 Portal command receipt。
- 供应商连接测试不进入首版。它会产生真实外部请求和计费/SSRF边界，需要单独安全设计；首版以结构校验和运行时 readiness 为完成标准。

备选方案包括：直接链接 `/admin`，实现成本最低但无法满足新版 Portal 内配置；让 Portal 直接写 Payload REST，开发快但契约、安全和错误处理不可控。两者均不采用。

## 信息架构

基础设置为所有角色保留账户、偏好、站点摘要和模块状态。管理员额外看到“AI 模型配置”区域，按依赖顺序显示：

1. 供应商：名称、OpenAI-compatible Base URL、启用状态、API Key 设置/替换。
2. 模型：名称、能力、模型 ID、供应商、超时和能力相关参数。
3. 用途路由：用途键、操作类型、模型、启用状态。
4. 业务 readiness：AI 客服、内容工作台、知识索引分别显示 ready/action-required 以及缺失项。

首版允许每类记录新增、编辑和删除，但删除仍由现有数据库关系和 Collection hooks 约束。API Key 输入始终为空；留空表示保留现有 Key，填写表示替换。

## 安全与错误处理

- Portal 和 Settings 模块必须启用；请求必须来自 Payload Users session 且角色为 `admin`。
- JSON 请求体最大 16KB，按原始字节流限制并严格校验 UTF-8/对象 JSON。
- 每次写操作要求 `Idempotency-Key`，同 actor/scope/key 安全 replay，不同 payload 返回 409。
- Base URL 沿用 Collection 校验：production 只允许 HTTPS，禁止凭据、query 和 fragment。
- Key 由 `AI_CONFIG_ENCRYPTION_KEY` 加密；缺少或非法加密密钥时只返回稳定错误码，不回传异常正文。
- 返回 DTO 只包含安全字段。未知异常日志只记录 error type、resource/action，不记录请求体、URL、Key 或密文。
- operators/sales 不获取 AI 配置 DTO，页面也不渲染技术配置入口。

## 验证

单元测试覆盖 DTO 脱敏、readiness、角色 UI、JSON 边界、命令输入和错误映射；集成测试覆盖 admin CRUD、operator/sales 拒绝、Key 加密/不回显、空 Key 保留、幂等 replay；Portal E2E 覆盖管理员配置供应商、模型、路由和移动端布局。最终运行 lint、typecheck、unit、integration、Portal E2E、build 和视觉检查。
