# Website Content Package Publishing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task.

**Goal:** 将客户提供的产品与项目案例素材整理为可审、可恢复、可幂等导入的英文/阿拉伯文官网内容，并分批发布到 IVYBM production。

**Architecture:** 本地内容准备与 production 写入分离。准备会话只扫描素材、抽取 DOCX 图片、生成规范化 manifest 和待审图片包；主会话负责唯一的 production 写入窗口。所有生产写入都由主会话按批次串行执行，使用 slug 幂等 upsert、媒体 SHA/视觉去重和显式发布确认，避免多个会话同时修改同一 Payload 文档。

**Tech Stack:** Next.js 16、Payload CMS 3.86、TypeScript/tsx、Vitest、Sharp、Payload REST API、PostgreSQL、腾讯 Lighthouse MCP、Cloudflare 定向缓存清理。

---

## 0. 范围冻结与完成标准

本计划只涉及内容准备、媒体导入和官网 CMS 数据，不改 Collection schema、migration、CI、Cloudflare 缓存规则或前端组件。

完成后预期为：

- 规范产品总数 16 个；产品页使用 5 个实际有引用的产品大类。
- 规范项目总数约 71 个：线上已有 8 个，新增约 63 个独立项目；3 个重复项目只追加图库，不新建 slug。
- 产品与项目均有英文和阿拉伯文标题、摘要、描述、SEO 字段和公开媒体；未把 `To be confirmed`、内部审核提示或网站实施备注发布到公开页面。
- 导入可重复执行：重复运行不会新增同 slug 文档或同一媒体；失败批次可从 checkpoint 继续。
- 每批完成英文/阿拉伯文列表、详情、媒体、sitemap、移动端/RTL、API 数量和缓存失效验证。

原始客户 ZIP、DOCX、图片、数据库、uploads、备份和包含客户原图的 manifest 均留在 Git 忽略目录或受控资料目录，不进入仓库。

## 1. 并行会话模型（推荐）

可以并行推进，但并行边界必须按“内容准备”划分，不能让多个会话直接写 production。建议主会话加 5 个执行会话，最多同时占用 6 个协作槽位：

| 会话 | 责任 | 允许写入 | 禁止事项 | 交付物 |
| --- | --- | --- | --- | --- |
| 主会话（Coordinator） | 冻结规则、合并 manifest、备份、production 导入、验收、回滚 | 唯一 production writer；协调目录和计划文档 | 不把未审内容直接发布；不让其他会话写 production | release manifest、导入日志、验收证据 |
| 产品准备 | 16 个规范产品、产品文案、规格、图片映射 | 自己 worktree 和独立准备目录 | 不改案例；不上传 production | `products/batch.json`、图片处理报告 |
| 案例准备 A | 案例清单前 1/3，重点国际/机场/交通案例 | 自己 worktree 和独立准备目录 | 不改产品；不创建线上记录 | `cases-a/batch.json`、重复候选报告 |
| 案例准备 B | 案例清单中段，商业/公共/医疗案例 | 自己 worktree 和独立准备目录 | 不改产品；不创建线上记录 | `cases-b/batch.json`、缺失事实报告 |
| 案例准备 C | 案例清单后 1/3、产品参考型案例归并 | 自己 worktree 和独立准备目录 | 不改产品；不创建线上记录 | `cases-c/batch.json`、归并报告 |
| 独立 QA | 只读检查合并后的 manifest、slug 冲突、媒体尺寸、双语完整性 | QA 报告目录 | 不修改 manifest；不写 production | `qa-report.json`、阻塞清单 |

会话之间不共享可写的 `.env`、`.next`、数据库或 media 目录。每个会话从最新 `origin/main` 创建独立 worktree；准备产物写入 Git 外部的独立目录，例如 `/Users/zhiyun.lee/Downloads/ivybm建站素材-上架准备/<batch>/`。主会话只接受带 SHA-256 清单的产物。

生产写入必须串行：媒体上传、产品/案例 upsert、发布和缓存清理不能由并行会话执行。并行会话只减少资料整理时间，不扩大 production 写权限。

## 2. 数据合同与脚本骨架

**Files:**

- Create: `scripts/content-import/contracts.ts`
- Create: `scripts/content-import/README.md`
- Modify: `package.json`
- Test: `tests/unit/content-import-contracts.test.ts`

### Step 1: 定义不可变导入合同

定义以下运行时校验类型，所有输入先转成此合同再进入 publisher：

```ts
type ImportLocale = 'ar' | 'en'
type ImportKind = 'product' | 'project'

type ImportMedia = {
  alt: Record<ImportLocale, string>
  filename: string
  height: number
  kind: ImportKind
  mimeType: 'image/avif' | 'image/jpeg' | 'image/png' | 'image/webp'
  sha256: string
  sourcePath: string
  sourceRef: string
  width: number
}

type ImportDocument = {
  application?: Record<ImportLocale, string>
  categorySlug?: string
  description: Record<ImportLocale, unknown>
  galleryMediaKeys: string[]
  kind: ImportKind
  location?: Record<ImportLocale, string>
  seo: Record<ImportLocale, { description: string; keywords: string; title: string }>
  slug: string
  summary?: Record<ImportLocale, string>
  title: Record<ImportLocale, string>
}

type ImportManifest = {
  generatedAt: string
  sourcePackageSha256: string
  media: ImportMedia[]
  documents: ImportDocument[]
  rulesVersion: string
}
```

校验要求：slug 必须是小写 Latin slug；locale 必须同时包含 `en`/`ar`；同一 slug 不得同时出现在 product/project；媒体 key、SHA、文件名和引用关系必须唯一；媒体文件大小不得超过 Media collection 的 8 MB 图片限制。

### Step 2: 先写失败测试

覆盖空标题、重复 slug、缺失阿语、媒体引用不存在、非法 MIME、超 8 MB、产品/案例 slug 冲突和通过校验的最小 manifest。

Run: `pnpm vitest run --config ./vitest.config.mts tests/unit/content-import-contracts.test.ts`

Expected: 新合同尚未实现时 FAIL。

### Step 3: 实现合同解析与安全错误

使用显式错误码返回失败原因，不打印原始客户路径、密码、Cookie、Payload token 或完整文案。`README.md` 只描述输入输出格式，不包含真实客户项目名或原图。

### Step 4: 验证并提交 checkpoint

Run: `pnpm vitest run --config ./vitest.config.mts tests/unit/content-import-contracts.test.ts`

Expected: PASS；随后运行 `git diff --check`，提交 `feat(content-import): add manifest contract`。

## 3. 素材扫描、DOCX 抽图与图片规范化

**Files:**

- Create: `scripts/content-import/build-package-manifest.ts`
- Create: `scripts/content-import/normalize-media.ts`
- Modify: `package.json`（增加本地准备命令）
- Test: `tests/unit/content-import-manifest.test.ts`

### Step 1: 增加本地准备命令

增加：

```text
content:package:manifest -- --source <package-root> --output <ignored-dir> --batch <name>
content:package:media -- --manifest <manifest> --output <ignored-dir>
content:package:validate -- --manifest <manifest>
```

命令必须拒绝 `https://ivybm.com`、production 数据库 URL 和仓库内未忽略的输出路径作为写入目标。

### Step 2: 读取产品和案例清单

产品以 `product-taxonomy-seo.csv` 的 16 个规范 slug 为主键；18 份产品详情文档只作为文案/规格来源。案例以 `project-case-seo-manifest.csv` 为索引，DOCX 的 `word/media/*` 作为图片来源。使用 ZIP/DOCX 解析库读取文件，不修改原始 ZIP/DOCX。

### Step 3: 规范媒体

对每张图执行：真实 MIME 检查、Sharp 解码、EXIF 方向归一、最大 2400×2400、去元数据、照片 JPEG 质量 82–88、透明或线稿保留 PNG、必要时转 WebP；输出必须小于 8 MB。计算原始 SHA-256、规范化 SHA-256 和 9×8 灰度 dHash，用于精确及近似重复分组。最大嵌入图约 11.3 MB，必须在上传前压缩。

### Step 4: 写清单测试

使用合成 CSV、合成 DOCX 和合成 PNG/JPEG fixture，覆盖：DOCX 图片抽取、图片过大压缩、错误 MIME、同图不同文件名去重、图片方向归一、无图片案例、重复 slug 和输出目录越界。

Run: `pnpm vitest run --config ./vitest.config.mts tests/unit/content-import-manifest.test.ts`

Expected: PASS；客户原始资料只在本地运行时读取，不作为 fixture 提交。

## 4. 规范产品与案例归并规则

**Files:**

- Create: Git 忽略目录中的 `rules.json`、`products/batch.json`、`cases-*/batch.json`
- Modify: `scripts/content-import/build-package-manifest.ts`
- Test: `tests/unit/content-import-manifest.test.ts`

### Step 1: 产品规则

以 16 个规范产品为 canonical URL：3 个线上已有产品加 13 个新增产品。线上既有产品的 slug、ID、已有媒体和已发布事实不能由准备会话改写。

新增产品候选固定为：

- `aluminum-clip-in-ceiling`、`aluminum-strip-ceiling`、`aluminum-grid-ceiling`、`aluminum-baffle-ceiling`、`aluminum-mesh-ceiling`；
- `aluminum-decorative-screen`、`stainless-steel-decorative-screen`；
- `extruded-aluminum-louver`、`perforated-acoustic-louver`、`waterproof-aluminum-louver`；
- `aluminum-honeycomb-panel`、`stone-honeycomb-panel`、`corrugated-aluminum-panel`。

18 份详情文档中的实心墙板、Lay-In/防风扣板、装饰切割/雕刻、勾搭天花和大规格勾搭系统先作为对应规范页的变体、应用或规格；没有独立图片目录和足够搜索意图时不拆新 slug。

### Step 2: 分类规则

复用现有 `aluminum-panels` 分类作为 `Solid Aluminum Panels`，把现有实心/单曲/双曲产品全部归入；新增 `aluminum-ceilings`、`metal-partitions-screens`、`aluminum-sunshade-louvers`、`composite-panels`。现有 `single-curved`/`double-curved` 空分类先不删除，避免导入批次中出现不可逆删除。

### Step 3: 案例规则

保留线上既有 8 个案例 slug。将 Children's Mall、Falcon Hotel、Saudi Twisted Strip 分别映射到既有 Children Mall (Qatar)、Falcon Tower (Qatar)、Al KHORAYEF CENTER (Saudi)，只追加经过视觉去重的新图片。将两个 Zengcheng Youth Palace 文档合并为一个案例组。

`Aluminum Baffle Ceiling Reference` 和 `Custom-Shaped Ceiling Reference` 作为产品页图库/案例引用，不默认创建 Projects 文档。其他 63 个独立案例使用 manifest 中的英文 slug；阿语标题可以先使用已确认的项目名翻译/转写，不能把内部审核句子作为公开描述。

### Step 4: 归并验证

Run: `pnpm content:package:validate -- --manifest <merged-manifest>`

Expected: 16 products、约 71 projects、5 个实际引用的产品分类、无重复 slug、无未引用媒体、无未翻译公开字段。

## 5. Publisher：dry-run、幂等 upsert 和 checkpoint

**Files:**

- Create: `scripts/content-import/payload-rest-client.ts`
- Create: `scripts/content-import/publish-package.ts`
- Modify: `package.json`
- Test: `tests/unit/content-import-publisher.test.ts`

### Step 1: 设计安全默认值

Publisher 默认 `dry-run`；只有同时提供 `--execute`、精确 production origin、manifest SHA-256 和人工确认字符串才允许写入。默认不删除任何数据、不运行 seed、不改 migration、不执行 Cloudflare API。

production origin 只能是 `https://ivybm.com`；测试使用本地 fake fetch。日志只输出 batch、slug、action、媒体 SHA 前 8 位和 Payload ID，不输出密码、Cookie、Authorization、完整源路径或原始文案。

### Step 2: 实现认证和媒体幂等

REST client 使用 `/api/users/login` 建立短期会话，Cookie 只保存在进程内。媒体上传前按确定性文件名和 `source` 中的规范化 SHA 查询既有 Media；命中则复用，未命中才上传。上传字段必须包含 `alt`、`source`、`isPublic=false`，只有文档发布成功后才将引用媒体设为公开。

### Step 3: 实现分类、产品、案例 upsert

先 upsert 分类，再按 slug 查询产品/案例。新文档先以草稿创建；英文和阿语字段、封面、图库、SEO 全部写入后，重新读取确认关系完整，再一次性发布。已有文档只允许追加明确 manifest 中的媒体和缺失字段，不覆盖未在本批次声明的内容。

### Step 4: 实现断点与重试

每个 batch 写入 ignored checkpoint：manifest SHA、batch 名、完成 slug、媒体 ID、失败原因和时间。网络超时可以重试；Payload 返回 validation、权限或未知副作用时停止该 batch，不自动重复提交。结果未知时先查询 slug/媒体 SHA，再决定是否继续。

### Step 5: Publisher 单测

使用 fake Payload REST server 覆盖：dry-run 零 POST、重复媒体复用、重复 slug 更新、双语缺失阻断、发布前媒体保持 private、部分失败 checkpoint、结果未知后的查询恢复、错误 origin 拒绝和日志脱敏。

Run: `pnpm vitest run --config ./vitest.config.mts tests/unit/content-import-publisher.test.ts`

Expected: PASS。

## 6. 主会话合并与并行准备验收

### Step 1: 创建工作区

主会话从最新 `origin/main` 创建短分支和独立 worktree；执行会话不得复用主 worktree，不得改写客户原始目录。

### Step 2: 并行运行准备会话

各会话只处理分配范围并提交 manifest，不提交客户图片：

```text
products      -> 16 个规范产品及其图片/文案映射
cases-a       -> 原始案例 01–23
cases-b       -> 原始案例 24–46
cases-c       -> 原始案例 47–69
qa            -> 合并后的只读校验
```

每个会话完成后返回：manifest 路径、manifest SHA-256、处理图片数、跳过图片数、slug 列表、缺失事实和重复候选。主会话不直接采用未经 SHA 校验的产物。

### Step 3: 合并并复核

主会话合并四个 batch，执行全局 slug/媒体/locale 检查；QA 会话只读报告冲突。发生冲突时由主会话裁决，不能让两个执行会话相互覆盖。

### Step 4: dry-run production

先读取线上产品、项目、分类和媒体摘要，记录 baseline；执行 publisher dry-run，输出预计 create/update/skip 数量。dry-run 与人工预期不一致时停止，不进入生产写入。

## 7. Production 发布批次

生产写入前必须由主会话在 Lighthouse MCP 中完成：

1. 只读确认 `db`、`app`、`worker` 健康、线上 SHA、当前数据库/媒体备份和 Cloudflare 规则未改变。
2. 停止 `app`/`worker`，执行 `scripts/preflight-production.sh` 和 `scripts/backup-production.sh`，验证 `SHA256SUMS`、`pg_restore --list` 和媒体归档；必要时复制到受控离机位置。
3. 启动原有 app/worker，确认 `/api/health/ready`、英文/阿语首页和 `/dashboard/login` 正常后，才开始 REST 内容导入。

按以下顺序逐批发布，每批完成验证后才进入下一批：

### Batch 0：既有内容补全

- 5 个产品大类归并和现有 3 个产品分类更新；
- 单曲铝板补 1 张现有 Media；双曲铝板补 4 张新视图；
- Children Mall、Falcon Tower、Al KHORAYEF CENTER 追加去重图库；
- 草稿读取确认后发布。

### Batch 1：13 个规范新增产品

按天花、屏风、百叶、复合板四组导入；每组完成英文/阿语详情和产品页验证后再进入下一组。素材不足的规格保持“按项目确认”的表述，不自行补充承诺数字。

### Batch 2：优先案例

优先国际、机场、交通、商业、文化和医疗代表案例，建议每次 8–12 个项目；确保每个项目有封面、至少一张画廊图、英文/阿语标题和不含占位语的摘要。

### Batch 3：剩余案例

导入剩余独立案例；图片较少、只有效果图或属于通用产品参考的条目放在最后。通用参考条目只进入产品页图库，不创建独立 Projects slug。

## 8. 每批验证和回滚

每批并行执行只读验证，生产写入仍保持串行：

- REST API：`/api/products`、`/api/projects`、`/api/product-categories` 数量、slug、`_status`、locale；
- 页面：英文/阿语产品列表、产品详情、Projects 列表和全部新增详情返回 200；
- 媒体：封面/画廊 HTTP 200、真实 MIME、图片解码、无 8 MB 超限；
- SEO：canonical、title、description、sitemap 项目数量和 locale 路径；
- 浏览器：桌面、移动端和阿语 RTL 无溢出、图片无破图；
- 缓存：仅在所有批次成功后定向清理公开产品/项目页面，验证首次 MISS、后续 HIT；`/api/*` 仍为 DYNAMIC。

批次失败时：停止该批次、保留 checkpoint 和错误响应；先按 slug/媒体 SHA 查询实际写入结果，再决定继续或恢复。不得删除已存在的客户内容，不运行 migration down，不把镜像回滚当作数据库回滚。必要时使用导入前数据库/媒体备份恢复，由 production 负责人批准后执行。

## 9. 收尾、凭据和文档

1. 只在全部验证通过后删除临时导入账号；再次只读确认账号不存在。
2. 保存导入前备份、导入后摘要、manifest SHA、每批 checkpoint、API 数量和页面验证结果；不保存密码、Cookie、token 或完整 HTTP header。
3. 清理本地临时图片、会话凭据和未采用的导入包；保留客户原始包不变。
4. 更新 `docs/开发进度.md`，记录实际产品/案例数量、媒体数量、备份目录、生产 SHA 和验证结果。
5. 代码脚本、单测和文档变更使用一个 Draft PR；涉及 `src/payload.config.ts`、Collection、migration 或生产配置时必须增加另一名开发者 Review。本次内容导入本身不需要 migration。

## 10. 本计划的执行选择

推荐采用“主会话统筹 + 4 个内容准备会话 + 1 个独立 QA 会话”。准备阶段可以并行；生产备份、写入、发布、缓存清理和最终验收必须由主会话串行推进。只有在用户明确要求创建独立会话后，才创建新的 Codex session；新会话应在自己的 worktree 中运行，并使用本计划的对应 batch 范围。
