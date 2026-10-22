# IVYBM 运营后台 Codex 智能接管：一体化 Skill 原型设计方案 (RFC)

- **状态**: 客户交付候选（Customer RC）；按下列对抗式验收收口，未完成真实账号与 Windows 实机验收前不宣称正式交付通过
- **编制日期**: 2026-09-16
- **技术负责人**: jueyunai
- **适用场景**: 客户侧通过 OpenAI Codex / Claude Code / 私有 Agent 辅助维护 IVYBM 运营后台，实现官网内容（英阿双语产品/案例/文章）整理上架与社交媒体（Facebook / Instagram / LinkedIn）专业文案生成及送审。

---

## 1. 背景与业务边界定位

### 1.1 需求背景与纠偏
客户提出希望通过其私有的 Codex / AI 助手接管后台，自动化处理官网与社媒内容。在首轮设计和技术审查中，明确指出了无人值守发布的风险与冲刺政策冲突：
- 依据 [`docs/plans/2026-08-10-MVP范围冻结与交付冲刺.md`](2026-08-10-MVP范围冻结与交付冲刺.md)：
  - `/dashboard` 是客户唯一后台；
  - 三平台发布必须由人类在工作台完成 5 项合规 Checklist 审查并点击一次发布；
  - 严禁无人值守、自动连环发帖，避免 Meta / LinkedIn 官方风控封禁账号。
- **定位收敛（Human-in-the-Loop）**：
  - AI Skill 明确作为**“运营辅助助理（Copilot）”**，负责：
    1. 提取中东建筑工程参数，地道翻译与排版英阿双语（English & Arabic）；
    2. 上传配图素材获得 media ID；
    3. 组装官网产品草稿/正式内容；
    4. 撰写多平台社媒推文，创建草稿并推进至待审状态（`submit-review`）；
  - **终审与发布边界**：最终 5 项合规审查与官方三平台一键 API 发布，**强制保留在 `/dashboard` 运营后台，由人类操作员确认后点击**。

### 1.2 核心安全原则
1. **零生产入侵（Zero Production Intrusion）**：
   - 100% 复用既有 `/api/portal/...` 接口，不改动后端数据库模型，不需要 migration。
2. **零明文密码接触（Zero-Plaintext-Password Security）**：
   - **严禁 AI 索要或持久化人类用户的明文密码**；
   - 采用操作员终端交互式登录，仅在本地受限目录（`~/.ivybm/auth.json`，权限 `0600`）保存短期会话 JWT Token，或通过 `IVYBM_TOKEN` 环境变量传入；
   - 杜绝密码进入 LLM 上下文、进程列表或明文落盘导致的安全隐患。
3. **强制全链路幂等（Mandatory Idempotency）**：
   - 严格遵循底层契约：所有写操作（POST / PATCH / DELETE）必须在 HTTP Header 中携带符合正则 `/^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$/` 的 `Idempotency-Key`。
4. **语言标准严格对齐**：
   - 官网与社媒内容严格为**英文（English, `en`）与阿拉伯语（العربية, `ar`）**，中文仅为后台 UI 界面语言。

---

## 2. 现有系统底座与 API 契约映射

```text
               ┌────────────────────────────────────────────────────────┐
               │              Codex / Claude Code / Agent               │
               └──────────────────────────┬─────────────────────────────┘
                                          │ 调度本地免依赖命令
                                          ▼
               ┌────────────────────────────────────────────────────────┐
               │        ivybm-operator Skill (bin/runner.cjs)           │
               └──────────────────────────┬─────────────────────────────┘
                                          │ HTTPS + Authorization: JWT <token>
                                          │       + Idempotency-Key: <key>
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                IVYBM Portal API Gateway                                │
├────────────────────────────────┬───────────────────────────────┬───────────────────────┤
│ 1. 认证与凭据通道               │ 2. 官网内容管理 (Website)     │ 3. 社媒工作台 (Studio) │
│ POST /api/users/login          │ GET  /api/portal/content/:type│ POST /api/portal/     │
│ (仅操作员终端交互登录, 存 JWT)  │ POST /api/portal/content/:type│      content-studio   │
│                                │ PATCH/GET/DELETE              │ POST /api/portal/     │
│                                │   /api/portal/content/:type/:id│      content-studio/:id│
│                                │                               │      (submit-review)  │
├────────────────────────────────┴───────────────────────────────┴───────────────────────┤
│ 4. 媒体资产管道: POST /api/portal/media (multipart/form-data -> mediaId)               │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 真实契约端点说明

| 业务动作 | 对应端点与方法 | 关键 Header 与输入 | 说明 / 生产约束 |
| :--- | :--- | :--- | :--- |
| **操作员登录** | `POST /api/users/login` | `{ username, password }` | 人工在终端运行，换取 2 小时 JWT Token，本地仅存 Token |
| **媒体上传** | `POST /api/portal/media` | Header: `Idempotency-Key`<br>Multipart: `file`, `alt`, `source`, `isPublic` | 返回 `{ result: { id: number, previewUrl: string \| null, ... } }` |
| **获取内容配置** | `GET /api/portal/content/[type]` | 无需幂等头 | 获取该内容类型可用的类别、分类、标签等 `{ options }` |
| **创建/更新官网内容** | `POST/PATCH /api/portal/content/[type](/[id])` | Header: `Idempotency-Key`<br>Body: `{ locale: 'en'\|'ar', action: 'save-draft'\|'publish', title, slug, updatedAt, ... }` | 支持 products, product-categories, projects, posts, knowledge；每次处理单语言，英阿双语需先 POST 创建 EN 获取 ID，再 PATCH AR 并携带最新 updatedAt；`--publish` 映射为 `action: 'publish'` |
| **创建社媒草稿** | `POST /api/portal/content-studio` | Header: `Idempotency-Key`<br>Body: `{ title, body, platform, contentType, contentLocale, assets, idempotencyKey }` | 创建社媒推文，返回 `{ content: { id, status: 'draft', updatedAt }, duplicate: false }` |
| **提交草稿送审** | `POST /api/portal/content-studio/[id]` | Header: `Idempotency-Key`<br>Body: `{ action: 'submit-review', updatedAt }` | 推进至 `review` 状态，返回 `{ content: { id, status: 'review', updatedAt } }`，等待操作员在 `/dashboard` 终审 |

---

## 3. 一体化 Skill 包结构

```text
skills/ivybm-operator/ 现归档于 docs/skills/ivybm-operator/
├── SKILL.md                 # Agent 核心提示词：角色定位、SOP 流程、英阿双语排版指南、安全红线
├── bin/
│   └── runner.cjs           # 零外部依赖单文件执行器 (Node.js 18+ 原生 API)
├── references/
│   └── case-workflow.md     # 照片与介绍文档到案例草稿：资料审查、主动询问、上传与核对
└── README.md                # 快速开始说明
```

### 3.1 零外部依赖（Zero-Dependency）
- 纯原生 Node.js（`fetch`、`FormData`、`Blob`、`crypto`、`fs/promises`、`readline`）。
- 无需执行 `npm install`，开箱即用。

### 3.2 凭据生命周期与安全隔离
- 凭据保存在 `~/.ivybm/auth.json`（权限 `0600`，仅当前操作系统用户可读写）：
  ```json
  {
    "endpoint": "https://ivybm.com",
    "token": "eyJhbGciOiJIUzI1NiIsIn...",
    "user": { "id": 1, "username": "operator1", "role": "operator" },
    "expiresAt": 1726580000,
    "updatedAt": "2026-09-16T12:00:00.000Z"
  }
  ```
- **过期处理**：Token 到期后，Runner 返回明确指引，提示用户在终端重新运行 `runner.cjs auth login`，绝不要求用户在聊天窗口泄露密码。

---

## 4. 业务工作流与操作闭环

```text
用户下达自然语言指令:
"帮我将这份铝单板工程参数整理为英阿双语产品草稿，并撰写一篇 LinkedIn 案例推文"
                         │
                         ▼
             Codex 读取并激活 SKILL.md
                         │
                         ▼
              执行自检状态命令:
          node "<SKILL_ROOT>/bin/runner.cjs" auth status
                         │
            ┌────────────┴────────────┐
       [未登录 / Token过期]         [已登录有效]
            │                         │
            ▼                         │
   Codex 提示用户在终端手动登录:           │
   "检测到尚未登录，请在终端执行:              │
    runner.cjs auth login 完成安全登录"        │
            │                         │
            └────────────┬────────────┘
                         │
                         ▼
        【步骤 1：素材上传】
        node "<SKILL_ROOT>/bin/runner.cjs" media upload "<TEMP_DIR>/panel.jpg"
        --> 获得 mediaId = 101
                         │
                         ▼
        【步骤 2：上架官网英阿双语产品】
        2a. 创建英文版:
        node "<SKILL_ROOT>/bin/runner.cjs" content upsert --type products \
             --locale en --file "<TEMP_DIR>/product-en.json"
        --> 获得 id = 15, updatedAt = "2026-09-16T12:00:00Z"
        2b. 补充阿拉伯语版:
        node "<SKILL_ROOT>/bin/runner.cjs" content upsert --type products \
             --id 15 --locale ar --updatedAt "2026-09-16T12:00:00Z" \
             --file "<TEMP_DIR>/product-ar.json"
        --> 完成双语闭环
                         │
                         ▼
        【步骤 3：生成社媒推文并提交送审】
        node "<SKILL_ROOT>/bin/runner.cjs" social draft-create \
             --file "<TEMP_DIR>/social-payload.json"
        --> 获得草稿 id = 88, status = "draft"
        node "<SKILL_ROOT>/bin/runner.cjs" social draft-submit --id 88 --updatedAt <ts>
        --> 状态推进至 review
                         │
                         ▼
        【步骤 4：向操作员汇报，引导至 /dashboard 终审】
        Codex 输出推文文案摘要，并明确提示操作员：
        "推文草稿（ID: 88，状态: review）已生成并提交送审。请登录 /dashboard，
         在 AI 内容工作台核对文案与配图，完成 5 项合规确认后点击‘立即发布’。"
```

---

## 5. 验收与后续演进

1. **当前阶段（一期交付冲刺范围内）**：
   - 本方案进入客户交付候选收口，发布范围为独立安装的 `ivybm-operator` 包；
   - Skill 负责官网内容维护、素材上传及社媒草拟/送审；官网发布必须由用户明确要求，默认保存草稿；
   - 社媒审批与真实 API 发布坚决依托 `/dashboard` 运营后台。
2. **后续演进（二期规划）**：
   - 评估是否引入专用 API Key 机制（需修改 `Users.ts` 与数据库 migration）；
   - 评估是否支持带服务端一次性挑战确认的外部发布通道。

### 5.1 2026-10-12 对抗式交付收口

- `[MODIFY] docs/skills/ivybm-operator/bin/runner.cjs`：登录与带 JWT 的请求禁止跟随 HTTP 跳转；`public` / `publish` 解析为布尔值；响应读取失败、不可确认的 5xx/408 和 `portal-command-result-unknown` 保留原幂等键并停止写入。
- `[MODIFY] tests/unit/ivybm-operator-runner.test.ts`：补齐上述失败路径、独立安装后的真实本机 HTTP/CLI 验证；修正社媒更新 fixture 为真实 `{ content }` 响应，不放松原有断言。
- `[NEW] tests/unit/ivybm-operator-standalone.test.ts`：独立安装、带空格路径、禁止跳转、官网/社媒真实 CLI 传输及“服务端已提交后断线”原键重放验证；仅连接一次性本机 HTTP fixture。
- `[MODIFY] docs/skills/ivybm-operator/SKILL.md`、`README.md`、`docs/开发进度.md`：统一公开素材授权、完整草稿更新载荷、人工审核边界及交付验收状态。
- 不做：修改后端路由/Collection/migration、增加自动审批/发布、生产写入、CI 改造或通用凭据框架。
- API 签名保持不变：官网写入返回 `{ result }`，草稿创建返回 `{ content, duplicate }`，更新/送审返回 `{ content }`；`PATCH /api/portal/content-studio/:id` 接收完整草稿字段与 `updatedAt`，不是部分字段补丁。
- 版本锚定：runner 只用 Node.js 原生 API（最低 18，客户推荐仍受支持的 LTS）；本地测试使用仓库锁定的 Vitest 4.0.18、TypeScript 5.7.3，不引入新依赖。
- 定向命令：`pnpm exec vitest run tests/unit/ivybm-operator-runner.test.ts tests/unit/ivybm-operator-standalone.test.ts`、`pnpm exec eslint docs/skills/ivybm-operator/bin/runner.cjs tests/unit/ivybm-operator-runner.test.ts tests/unit/ivybm-operator-standalone.test.ts`、`pnpm run typecheck`、Skill `quick_validate.py` 与 `git diff --check`。
- 交付退出条件：上述本地验证通过；受控账号完成登录、素材上传、EN 创建→AR 更新、社媒草稿→送审并在 `/dashboard` 读回；面向 Windows 交付时完成 PowerShell 安装和交互登录实机验证。没有执行的项保持未验证，不以本机 HTTP fixture 替代真实平台证据。

### 5.2 2026-10-22 运营人员新增案例主流程

- 目标：运营人员提供照片和介绍文档并要求新增案例时，AI 先审查资料，自动整理能确定的内容，集中询问影响事实、来源或授权的缺口，再完成素材上传和英阿双语案例草稿；不要求用户逐项填写后台字段。
- `[MODIFY] docs/skills/ivybm-operator/SKILL.md`、`README.md`：新增场景入口、合理默认、来源参数和客户使用说明。
- `[NEW] docs/skills/ivybm-operator/references/case-workflow.md`：明确文件/事实审查、来源与公开授权、封面/图库、完整案例字段、任务记录、中断恢复及真实读回。
- `[MODIFY] docs/skills/ivybm-operator/bin/runner.cjs`：帮助输出补全已有 `--source` 参数，版本更新为 `1.0.1-rc.2`，不改变接口或上传行为。
- `[MODIFY] tests/unit/ivybm-operator-standalone.test.ts`、`docs/开发进度.md`：补多张图片各自的 alt/source 传输、封面/图库关联、EN→AR 完整字段与读回证据，并记录独立行为模拟结果。
- 复用签名：`media upload <file> --alt <text> --source <text> [--public] --idempotency-key <uuid>` 调用 `POST /api/portal/media`，返回 `{ result: { id, previewUrl, ... } }`；`content upsert --type projects` 的 POST/PATCH 接收 `{ locale, action: 'save-draft', title, slug, coverImageId, galleryIds, summary, bodyText, location, application, projectSnapshot, observedFocus, solutionFramework, qualityVerification, seoTitle, seoDescription, ... }`，PATCH 额外需要 `updatedAt`；详情 GET 返回 `{ options, record: { id, updatedAt, data, ... } }`。
- 不做：新增批量后台端点、后台/数据库/CI 改造、自动推断版权或工程事实、自动对外发布、客户资料写入仓库、生产账号操作；不把 AI 的任务记录宣称为内置断点续传器或跨请求事务。
- 版本锚定：继续使用 Node.js 原生 CLI 和仓库既有 Vitest 4.0.18 / TypeScript 5.7.3；不增加依赖。
- 验证：运行 5.1 的定向命令；断言多图各自的 alt/source、独立幂等键、真实返回 ID 对应封面/图库、完整双语载荷和读回。另以缺失来源、资料齐全、中断续做三种独立模拟检验实际询问/执行行为；模拟不连接生产、不作为真实账号验收。
- 新包必须包含 `references/case-workflow.md` 并验证解压内容，旧 RC 包保留不覆盖；正式交付退出条件仍按 5.1。
