# 图片生成垂直能力实施计划

> **执行要求：** 使用 `executing-plans` 按 checkpoint 测试先行实施；每个 checkpoint 只运行与 diff 直接相关的门禁。

**目标：** 为 AI 控制平面和 `/dashboard/content-studio` 增加真实、服务端、可落库的文生图与可选参考图生成闭环，解决 HMT-0017、HMT-0018、HMT-0022。

**架构：** 复用 `AiProviders`、`AiModelProfiles`、`AiUsageRoutes`、Media 与 `GeneratedContents.assets`，不新增 Collection。新增稳定能力/operation `image` 与用途键 `content.image-generation`；浏览器只提交生成意图和受保护 Media ID，服务端解析一次 AI route snapshot，通过 OpenAI-compatible images transport 调用外部 provider，将受限的 base64 图片结果保存为私有 Media，用户明确采用后再关联草稿。

**技术栈：** Next.js App Router、Payload CMS、PostgreSQL、TypeScript、OpenAI-compatible Images API、Vitest、Playwright。

---

## 1. 冻结的最小完整设计

### 1.1 稳定键与展示标签

- capability / route operation：`image`；与现有 `text`、`embedding` 同层，内部值稳定且不本地化。
- gateway/provider operation：`generateImage`；用量日志 operation 同名。
- usage key：`content.image-generation`。
- 中文展示：`chat.reply` = “AI 客服与内容文案”、`knowledge.embedding` = “知识索引与检索”、`knowledge.translation` = “知识文档翻译”、`content.image-generation` = “内容工作台·图片生成”。英文保留等价业务标签；表单同时显示稳定 key 作为辅助信息。
- readiness：文案与图片拆开评估；图片只有已启用 route/profile/provider、可读凭据以及显式 provider 验证通过时才可标记 ready。fixture 或仅保存配置不得把能力标记为 available。

### 1.2 Server-only `generateImage` port

输入：

```ts
type GenerateImageInput = {
  prompt: string
  referenceImage?: { data: Uint8Array; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }
  size?: '1024x1024' | '1536x1024' | '1024x1536'
  signal?: AbortSignal
  onDispatch?: () => Promise<void> | void
}
```

输出：

```ts
type GenerateImageResult = {
  image: { data: Uint8Array; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }
  model: string
  provider: string
  requestId?: string
  revisedPrompt?: string
}
```

- 文生图：`POST /images/generations`；参考图/图生图：`POST /images/edits` multipart。
- provider contract 固定请求一张图并要求 `b64_json`。URL-only、空数据、非图片、坏 base64 或超出 8 MiB 均 fail closed；服务端不抓取任意 provider URL，避免 SSRF。
- 统一沿用 gateway 的 `configuration`、`invalid_request`、`authentication`、`rate_limit`、`provider_unavailable`、`timeout`、`aborted` 与 `invalid_response` 语义；错误不包含 prompt、图片、URL、key 或 provider body。
- 默认图片超时 60 秒。调用开始前执行 `onDispatch`，用于外层原子命令收口幂等。
- 图片调用不伪造 token。用量日志对 `generateImage` 允许 token 为 0，并记录 provider/model/requestId/duration；费用未知保持空值。

### 1.3 幂等、媒体与采用边界

- 生成与采用为两个独立受保护命令，各自要求 `Idempotency-Key`，使用现有 Portal command receipt；同 key 同请求 replay，不同请求冲突。
- 生成命令只接受已授权的 image Media ID 作为可选参考图；直接上传先走现有 `/api/portal/media`、MIME/大小/access 校验，再把返回 ID 作为参考图。
- provider 成功后服务端立即通过现有 `createPortalMedia` 校验和权限路径保存为 `isPublic=false` Media，`source` 标记为 AI provider 生成，alt 来源于有界提示词摘要。失败不创建 Media。
- 生成预览返回安全 Media DTO，不返回 provider 原始 URL/base64。预览未采用时仍是可管理的私有素材，可从素材库删除；采用命令只允许草稿，并以集合语义把 Media ID 追加到 `GeneratedContents.assets`，重复采用不重复关联。
- 浏览器不读取 API key、不调用 provider、不写 `GeneratedContents` 权威状态或审计字段。

### 1.4 Provider compatibility 与真实验证

- 首版只声明 OpenAI-compatible Images API 的 `/images/generations` + `/images/edits` fixture contract；不猜测供应商私有参数。
- 设置页为 image profile 提供模型 ID、超时和启用状态，不复用 text token/reasoning 或 embedding dimensions。
- provider readiness 需要受控环境执行一次不持久或明确确认的真实生成探测，并记录验证时间/模型/能力，不记录 prompt/图片/key。当前没有该证据时保持“需要验证”。

## 2. Checkpoint 1：Schema、migration 与生成类型

**修改：** `AiModelProfiles`、`AiUsageRoutes`、`AiUsageLogs`，新增线性 migration 与 JSON snapshot，追加 `src/migrations/index.ts`，重新生成 `src/payload-types.ts`。

1. 先补 integration/schema 测试，断言 `image` profile/route 能保存、operation 必须匹配、usage log 接受 `generateImage` 且 token 为 0。
2. 运行定向测试确认失败。
3. 实现 collection 校验并生成 migration/types；不得手改已合并 migration。
4. 使用 loopback 且 `_test`/`_ci` 后缀的隔离数据库运行 reset 与定向 integration。

## 3. Checkpoint 2：Provider、gateway 与媒体落库

**修改：** AI gateway/provider/config/registry、images fixture、内容工作台 server-only image command 与 route。

1. 先补 contract 测试：generation/edit 请求、base64 normalize、超时/abort、坏响应、URL-only、secret-safe error、image route snapshot。
2. 实现 `generateImage`、`image` operation route 与 usage persistence。
3. 补 command 单元测试：授权 reference Media、真实 gateway、Media 保存、幂等 replay、失败不落库。
4. 实现 generate route；不允许浏览器直接 provider I/O。

## 4. Checkpoint 3：设置 UI 与 readiness

**修改：** AI settings read/commands/UI/i18n/tests。

1. 先补中文用途标签、image capability/profile/route、图片 readiness 与凭据错误测试。
2. 实现 DTO/parser/form；image profile 隐藏 text/embedding 专属参数。
3. readiness 显示“已配置，待真实验证”或“需要配置”，不得从结构配置推断真实 available。
4. 补 settings unit/integration/E2E 与 390px 检查。

## 5. Checkpoint 4：内容工作台交互与采用

**修改：** Content Studio read model/component/styles/API/tests。

1. 先补模式选择、提示词、素材库参考图、受保护上传、生成预览、采用到草稿与重复采用测试。
2. 在生成草稿区增加“生成文案 / 生成配图”模式；配图模式不要求知识来源。
3. 参考图复用 Media option；上传复用 `/api/portal/media`，只接受既有图片 MIME/8 MiB 限制。
4. 成功响应只展示私有 Media 安全预览；采用后刷新当前草稿 assets。
5. 运行 Content Studio/Media 定向 unit/integration/E2E。

## 6. 最终门禁与交付边界

- `pnpm typecheck`
- 受影响文件的 ESLint
- AI unit/contract、AI settings、Content Studio、Media unit/integration/E2E
- `git diff --check`
- 检查 migration index、timestamp 顺序、snapshot 与 `payload-types` 一致
- 更新 `docs/开发进度.md`
- 飞书逐条按真实完成程度回填并读回；无真实 provider 受控验证时保持“处理中”或按缺口标“信息不足”，不得填写正式验收结果
- 仅明确路径 `git add -- ...`，中文 Conventional Commits；不 push、不建 PR、不合并、不部署
- migration、公共 AI contract、`payload-types`、provider 外部副作用与 `GeneratedContents` 关联改动必须由另一名开发者 Review 后才可合并
