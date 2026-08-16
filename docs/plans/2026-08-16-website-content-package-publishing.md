# Website Content Package Publishing Execution Plan

## 1. 目标与执行边界

本次任务是整理并上架客户提供的产品和案例资料，不是开发新功能。

执行期间：

- 不修改官网运行时代码、Collection、migration、CI、Compose 或 Cloudflare 缓存规则；
- 新增一个独立、可复用的 `scripts/content-import/**` 运营导入 CLI 及最小单元测试；它不注册路由、不进入 app/worker runtime、不携带客户素材；
- 导入 CLI 的代码变更单独走代码 worktree 和小 PR，但不需要部署新镜像；
- 不执行 seed，不删除现有产品、案例、分类或媒体；
- 原始 ZIP、DOCX、图片和处理后的客户媒体均留在 Git 外部，不提交仓库；
- 只使用官网现有 Payload CMS/REST API、Lighthouse/1Panel 运维控制、生产备份脚本和缓存失效能力完成上架；
- 内容准备可以并行，production 数据写入只能由主会话串行执行。

完成后预期：

- 官网共有 16 个规范产品，其中 3 个为现有产品、13 个为新增产品；
- 产品列表实际显示 5 个产品大类；
- 官网项目总数约 71 个，其中现有 8 个、新增约 63 个；
- 3 个与线上重复的项目只补充图库，不创建重复 slug；
- 产品和项目的英文、阿拉伯文公开字段完整；
- 所有公开图片可正常解码且不超过当前 Media collection 的 8 MiB 单图限制；
- 英文/阿拉伯文列表、详情、sitemap、移动端和 RTL 验证通过。

## 2. 已确认的素材与线上基线

素材包包含：

- 16 个规范产品目录、119 张产品图片和 18 份产品详情草稿；
- 69 份案例草稿；案例清单记录 705 张去重源图，其中 344 张已嵌入 DOCX；
- 当前 production 为 3 个产品、8 个项目案例。

已确认归并规则：

- `Solid Aluminum Panel` 已有图库覆盖，不重复上传；
- `Single-Curved Aluminum Panel` 复用现有未挂载 Media 补 1 张；
- `Double-Curved Aluminum Panel` 视觉去重后补约 4 张产品视图；
- Children's Mall 合并到现有 Children Mall (Qatar)；
- Falcon Hotel 合并到现有 Falcon Tower (Qatar)；
- Saudi Arabia Twisted Strip Project 合并到现有 Al KHORAYEF CENTER (Saudi)；
- 两份 Zengcheng Youth Palace 文档合并为一个案例；
- `Aluminum Baffle Ceiling Reference` 和 `Custom-Shaped Ceiling Reference` 作为产品页图库/参考内容，不默认创建独立 Projects 文档。

案例数量公式为 `69 - 3 个线上重复 - 1 个 Zengcheng 重复文档 - 2 个产品参考文档 = 63 个新增独立案例`，最终项目总数为 `8 + 63 = 71`。

## 3. 会话与流水线模型

A/B/C 是三条并行的“案例准备流水线”，不是三条 production 发布流水线。

```text
只读客户素材
  ├─ 产品准备 ───────────────> products/
  ├─ 案例准备 A（01–23）────> cases-a/
  ├─ 案例准备 B（24–46）────> cases-b/
  ├─ 案例准备 C（47–69）────> cases-c/
  └─ 独立 QA（只读复核）────> qa/
                                  ↓
                           主会话合并与 dry-run
                                  ↓
                       主会话唯一执行 production 写入
```

| 会话       | 责任                                             | 允许写入                                                                | 禁止事项                                                           | 交付物                                    |
| ---------- | ------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| 主会话     | 冻结规则、合并批次、备份、上架、验收、回滚       | 协调 worktree、共享准备根目录的 `merged/` 与 `checkpoints/`、production | 不改产品/案例准备目录；不发布未审内容；不允许其他会话写 production | release manifest、导入日志、验收证据      |
| 产品准备   | 16 个规范产品的文案、规格和图片映射              | 共享准备根目录的 `products/`                                            | 不改案例；不写 production                                          | `batch-manifest.json`、媒体、处理报告     |
| 案例准备 A | 原始案例 01–23                                   | 共享准备根目录的 `cases-a/`                                             | 不改产品；不写 production                                          | `batch-manifest.json`、媒体、重复报告     |
| 案例准备 B | 原始案例 24–46                                   | 共享准备根目录的 `cases-b/`                                             | 不改产品；不写 production                                          | `batch-manifest.json`、媒体、缺失事实报告 |
| 案例准备 C | 原始案例 47–69；负责范围内 65 号产品参考内容归并 | 共享准备根目录的 `cases-c/`                                             | 不改产品；不写 production                                          | `batch-manifest.json`、媒体、归并报告     |
| 独立 QA    | 检查合并后的 slug、双语、媒体和重复项            | 共享准备根目录的 `qa/`                                                  | 不修改批次产物；不写 production                                    | `qa-report.md`、阻塞清单                  |

## 4. Worktree 与目录规则

本次不做官网业务功能开发。内容准备会话不需要各自创建 worktree；导入 CLI 的维护另按代码任务使用独立 worktree。

- 主会话保留一个协调 worktree，仅用于读取项目配置、维护本计划和最终更新 `docs/开发进度.md`；
- 产品、案例 A/B/C 和 QA 会话可以只读共用该协调 worktree，也可以完全不使用开发 worktree；
- 客户原始素材目录只读，任何会话都不得覆盖或改名原文件；
- 所有客户内容、媒体、manifest、报告和 checkpoint 写入 Git 外部的共享准备根目录，例如 `/Users/zhiyun.lee/Downloads/ivybm建站素材-上架准备/`；计划和 `docs/开发进度.md` 是仓库治理记录，由主会话在协调 worktree 维护；
- 每个会话只能写自己负责的子目录，不能同时编辑另一个会话的 manifest 或媒体；
- 主会话只写 `merged/`、`checkpoints/` 和协调 worktree 内的治理文档，不修改 `products/`、`cases-a/`、`cases-b/`、`cases-c/` 或 `qa/` 产物；
- 准备会话不读取或共享 production `.env`、Cookie、token、数据库、uploads 或 media 卷；
- 若后续确实需要修改除 `scripts/content-import/**` 之外的 tracked 应用代码、脚本或测试，必须先暂停该会话，并把它转换为独立代码任务和独立 worktree；这不属于本次内容上架范围。
- `scripts/content-import/**` 属于可复用运营工具的例外：由主会话或指定工具会话在独立 worktree 维护，准备会话只消费已审版本，不直接修改工具代码。

共享准备根目录结构：

```text
ivybm建站素材-上架准备/
  products/
    batch-manifest.json
    media/
    review-report.md
    SHA256SUMS
  cases-a/
  cases-b/
  cases-c/
  merged/
  qa/
  checkpoints/
```

## 5. 批次交付格式

每个准备会话交付相同结构的 `batch-manifest.json`。manifest 至少包含：

- `kind`：`product` 或 `project`；
- `sourceNumbers`：一个或多个原始产品/案例编号；多源合并必须全部列出；
- `slug`：稳定英文 URL slug；
- `action`：`create`、`enrich-existing`、`merge-into-product` 或 `merge-into-project`；
- `targetSlug`：归并到现有产品/项目或把多个源合成一个新项目时填写；
- 英文和阿拉伯文标题、摘要、描述、SEO title、SEO description、keywords；
- 产品分类、规格，或项目地点、建筑类型、产品应用；
- `coverImage`、`gallery` 顺序；
- 每张媒体的文件名、真实 MIME、宽高、字节数、SHA-256、ALT 和来源说明；
- 删除的占位语、重复项和人工判断记录。

Media 的 `alt` 字段在当前 Payload 模型中不是 localized 字段，因此每张媒体只提供一条清晰的英文/语言中立 ALT。产品和项目本身的公开文本必须同时提供 `en` 和 `ar`。

每个批次还必须包含：

- `review-report.md`：处理数量、跳过数量、重复候选、缺失事实和人工判断；
- `SHA256SUMS`：manifest 和全部准备媒体的校验清单；
- 不包含密码、Cookie、token、Authorization、客户原始绝对路径、完整原文或 production 响应头。

## 6. 可复用导入 CLI

导入脚本不是官网业务功能，而是版本化的运营工具，负责把外部批次 manifest 和处理后的媒体写入 Payload。它必须支持本次上架，也支持后续客户资料追加。

建议文件：

- `scripts/content-import/cli.ts`：命令入口和参数校验；
- `scripts/content-import/manifest.ts`：manifest 读取、schema 校验和 SHA-256 校验；
- `scripts/content-import/payload-client.ts`：Payload REST 登录、查询、创建、草稿更新和发布；
- `scripts/content-import/media.ts`：媒体查询、上传、复用和 `isPublic` 状态处理；
- `tests/unit/content-import/*.test.ts`：不含客户素材的 fake REST/manifest 单测；
- `package.json`：只增加本地 CLI 别名，不改变 production runtime。

CLI 必须具备以下模式：

```text
pnpm content:import -- --manifest <external-manifest> --dry-run
pnpm content:import -- --manifest <external-manifest> --batch products --execute --confirm <manifest-sha>
pnpm content:import -- --manifest <external-manifest> --resume <external-checkpoint>
```

安全约束：

- 默认 `dry-run`，没有 `--execute` 和精确 manifest SHA 时拒绝写入；
- production origin 只允许 `https://ivybm.com`，本地测试只允许显式 localhost；
- 按稳定 slug 幂等 upsert，按媒体 SHA/确定性文件名复用 Media；
- 不执行删除、不执行 seed、不修改 Collection/migration，不覆盖未在 manifest 声明的字段；
- 新文档先草稿，双语字段/媒体/SEO读回完整后才发布；
- 结果未知时先查询 slug、版本和媒体状态，禁止盲目重发；
- checkpoint、日志和错误输出不得包含密码、Cookie、token、Authorization、production 响应头、客户原始绝对路径或完整原文；
- production 凭据只由主会话在进程环境中提供，准备会话和 QA 会话不能读取。

工具测试只使用合成 manifest 和 fake REST server，至少覆盖 dry-run 零写入、重复媒体复用、slug 幂等、草稿发布、已发布记录版本更新、结果未知查询恢复、错误 origin 拒绝和日志脱敏。CLI 合并前运行相关定向 unit、typecheck、lint 和 `git diff --check`；合并后不需要重新构建 production 镜像，因为工具由受控工作站执行。

## 7. 产品准备流水线

产品会话以 16 个规范产品 slug 为唯一 URL 基线。

现有产品：

- `solid-aluminum-panel`；
- `single-curved-aluminum-panel`；
- `double-curved-aluminum-panel`。

新增产品：

- `aluminum-clip-in-ceiling`、`aluminum-strip-ceiling`、`aluminum-grid-ceiling`、`aluminum-baffle-ceiling`、`aluminum-mesh-ceiling`；
- `aluminum-decorative-screen`、`stainless-steel-decorative-screen`；
- `extruded-aluminum-louver`、`perforated-acoustic-louver`、`waterproof-aluminum-louver`；
- `aluminum-honeycomb-panel`、`stone-honeycomb-panel`、`corrugated-aluminum-panel`。

产品分类使用：

- 复用现有 `aluminum-panels` 并将标题统一为 `Solid Aluminum Panels`；
- 新增 `aluminum-ceilings`；
- 新增 `metal-partitions-screens`；
- 新增 `aluminum-sunshade-louvers`；
- 新增 `composite-panels`。

18 份详情文档中的实心墙板、Lay-In/防风扣板、装饰切割/雕刻、条形挂片、勾搭和大规格勾搭系统先作为对应规范产品页的变体、应用或规格，不单独创建同义 URL。

产品会话完成标准：

- 16 个产品均有唯一 slug、分类、英文/阿语内容、封面和图库顺序；
- 技术参数只使用素材中存在且适合作为能力参考的内容；
- 不发布文档里的内部审核说明和 `To be confirmed`；
- 图片完成旋转、尺寸、格式和视觉重复检查。

## 8. 案例准备 A/B/C 流水线

三个会话按原始编号分配，不按最终行业分类重新抢占，避免相互覆盖：

- A：01–23；
- B：24–46；
- C：47–69。

每个案例只使用素材可以确认的信息：项目名、明显地点或国家、建筑类型、产品类别和图片中可见的内容。不能把 `To be confirmed`、内部网站实施备注或泛化的合同/质量承诺复制到公开正文。

每个案例至少满足：

- 一个稳定英文 slug；
- 英文/阿语标题和摘要；
- 一张封面；有更多有效图片时提供图库；
- 项目图片少于两张时在报告中标记为低优先级；
- 效果图、施工图、工厂图和完工图在文案中不混写为同一状态；
- 与线上既有案例或其它批次疑似重复时只标记候选，不自行创建第二个 slug。

会话 B 负责把 38 号 `Aluminum Baffle Ceiling Reference` 标记为 `merge-into-product`；会话 C 负责把 65 号 `Custom-Shaped Ceiling Reference` 标记为 `merge-into-product`。两者都无权修改产品批次，主会话在合并阶段决定具体目标产品和图库顺序。

## 9. 图片处理与去重

准备会话使用现有本机图片工具处理素材，不新增应用代码：

- 校验图片真实 MIME 和可解码性；
- 按 EXIF 方向纠正旋转；
- 最长边限制在 2400 px；
- 照片优先 JPEG/WebP，透明线稿或图纸保留 PNG；
- 单图不超过 8 MiB；案例包最大嵌入图约 11.3 MB，必须先压缩；
- 文件名使用稳定 slug、顺序号和用途，例如 `singapore-airport-01-exterior.jpg`；
- 先按 SHA-256 精确去重，再用 contact sheet 做视觉去重；
- 与线上现有媒体比较时，以实际画面为准，不能只依赖文件名或 DOCX 重编码后的哈希。

单图上限统一按“不超过 8 MiB”执行；准备阶段建议保留安全余量，不把文件压到临界字节值。产品与案例原始可用图上限为 `119 + 344 = 463` 张，扣除已确认复用的 15 张产品 Media 后最多 448 张待处理；最终上传数还要扣除 Zengcheng、现有案例和其它视觉重复，预计低于该上限。并行准备阶段不上传任何图片。

## 10. 主会话合并与 QA

主会话依次执行：

1. 校验四个批次的 `SHA256SUMS`；
2. 合并产品和案例 manifest 到 `merged/release-manifest.json`；
3. 检查跨批次 slug、媒体和项目名称冲突；只有显式 `merge-into-project`、相同 `targetSlug` 且列出多个 `sourceNumbers` 时，才允许多源合并而不报 slug 冲突；
4. 应用既有案例归并、Zengcheng 合并和产品参考内容归并规则；
5. 检查所有产品/项目的英文和阿拉伯文字段；
6. 检查 cover/gallery 引用的文件真实存在；
7. 生成预计 create、enrich、skip 和媒体上传数量；
8. 将合并 manifest 交给 QA 会话只读复核。

QA 有阻塞项时，主会话把问题退回原 owner 会话；QA 会话本身不修改 manifest。所有阻塞关闭后，主会话冻结 release manifest SHA-256，后续任何变化都必须重新 QA。

## 11. Production 写入前检查

主会话在唯一写入窗口开始前：

1. 通过公开 API 记录当前 3 个产品、8 个案例、产品分类，以及所有待复用/待追加 Media 的 ID、文件名、宽高、字节数、`isPublic` 和下载后 SHA-256 baseline；
2. 只读确认 production `db`、`app`、`worker` 健康和当前运行 SHA；
3. 确认没有其它会话或管理员正在修改 CMS；
4. 对 release manifest 做 dry-run，对比预计 create/enrich/skip 数量；
5. dry-run 与人工预期不一致时停止，不进入 production；
6. 运行 `scripts/preflight-production.sh`，通过 Lighthouse MCP 停止 `app`/`worker`，再执行现有 `scripts/backup-production.sh`；
7. 把备份复制到独立受控的离机位置，并使用 `scripts/verify-production-backup.sh` 同时验证服务器副本和离机副本；
8. 使用 `scripts/restore-production-backup-check.sh` 在隔离数据库完成 restore rehearsal，并验证媒体归档可读；
9. 启动原有 app/worker，确认健康检查、英文/阿语首页和登录入口正常。

本次没有代码、镜像或 migration 变化，因此不拉取新镜像、不执行应用部署。备份完成后继续使用当前 production 版本。

## 12. Production 上架批次

主会话使用已审的 `scripts/content-import/cli.ts` 串行写入。运行时只读取共享准备根目录中的 manifest/媒体，不把客户素材复制回仓库；不得让准备会话获得 production 凭据。

每张新媒体先以 `isPublic=false` 上传并绑定到草稿。复用现有 Media 时必须先核对 baseline 中的 `isPublic`：已经公开的保持不变；private Media 按新媒体同样处理。草稿英文/阿语内容、封面、图库和 SEO 全部读回确认后，先公开该文档引用的新/private 媒体，再发布文档；发布失败时把本批次刚公开且尚未被其它公开内容引用的媒体恢复为 private。已有公开媒体不改变可见性。

修改现有已发布产品、案例或分类时，先记录当前文档和版本 ID，通过 Payload drafts/version 能力创建待审版本，并确认公开页面仍保持上一发布版本；不得直接在 published 记录上分步原地修改。待审版本和媒体验证完成后一次发布新版本。失败时保留上一发布版本，恢复本批次新公开媒体的可见性；必要时由主会话恢复先前版本。

上架顺序：

### Batch 0：现有内容补全

- 统一 5 个产品大类；
- 调整现有 3 个产品分类；
- 单曲铝板补 1 张现有 Media；
- 双曲铝板补视觉去重后的产品图；
- Children Mall、Falcon Tower、Al KHORAYEF CENTER 追加图库。

### Batch 1：13 个新增产品

按天花、屏风、百叶和复合板四个小组依次上架。每组完成列表、详情和双语验证后再继续下一组。

### Batch 2：优先案例

先上架国际、机场、交通、商业、文化和医疗代表案例，每次 8–12 个项目。图片较少或事实信息有限的条目暂留草稿。

### Batch 3：剩余案例

上架其余独立案例。通用产品参考内容只进入产品页图库，不创建独立 Projects 记录。

每个 batch 在 `checkpoints/` 记录 manifest SHA、完成 slug、Payload ID、媒体 ID、失败原因和时间。结果未知时先查询线上实际状态，不能直接重发。

## 13. 每批验证

每批写入后可并行执行只读验证：

- `/api/products`、`/api/projects` 和 `/api/product-categories` 的数量、slug、locale 和发布状态；
- 英文/阿语产品列表、产品详情、Projects 列表和所有已发布新增详情返回 200；暂留草稿的条目只验证 CMS 草稿状态，并确认不会出现在公开列表或详情中；
- 封面、图库和响应式尺寸可以下载并解码；
- 页面不存在 `To be confirmed`、内部审核语句或未翻译公开字段；
- SEO title、description、canonical 和 sitemap 路径正确；
- 每批先通过 DYNAMIC API 验证即时数据，再在服务器 origin 等待至少一个 60 秒 ISR 窗口并确认页面已刷新；桌面、移动端和阿语 RTL 无溢出、破图或明显布局异常；
- `/api/*` 继续绕过 Cloudflare 缓存。

只有当前 batch 验证通过，主会话才进入下一批。

## 14. 缓存、回滚和收尾

全部批次成功后：

1. 定向清理英文/阿语产品、案例列表和详情缓存，不修改现有 Cloudflare 规则；
2. 验证公开页面首次 MISS、后续 HIT，API 仍为 DYNAMIC；
3. 记录最终产品、案例、分类和媒体数量；
4. 保存导入前备份、release manifest SHA、checkpoints 和验证摘要；
5. 删除一次性 production 登录会话或临时导入账号，并只读确认不存在；
6. 清理本地一次性凭据和未采用的准备文件，保留原始客户素材不变；
7. 由主会话更新 `docs/开发进度.md`。

所有主会话导入日志、一次性脚本输出和 checkpoint 都必须遵守与批次 manifest 相同的脱敏边界：不得记录密码、Cookie、token、Authorization、production 响应头、客户原始绝对路径或完整原文。

单个 batch 失败时停止后续写入，保留 checkpoint，先按 slug 和媒体 ID 查询实际状态。不得删除已有客户内容、不得运行 migration down、不得把镜像回滚当作数据回滚。确需恢复导入前数据库和媒体时，由 production 负责人根据已验证的服务器副本、离机副本和 restore rehearsal 结果单独批准。

## 15. 会话创建条件

推荐采用“主会话 + 导入 CLI 工具会话 + 产品准备 + 案例 A/B/C + 独立 QA”。用户明确要求开始执行后，再创建这些 Codex 会话；导入 CLI 工具会话只负责独立 worktree 中的通用脚本和测试，不读取客户原始媒体，也不写 production。

新会话收到的任务必须包含：只读素材路径、负责编号范围、唯一输出目录、manifest 格式、禁止 production 写入和完成回报格式。内容准备/QA 会话只读共用协调 worktree；不为它们创建独立开发 worktree。主会话始终保持唯一 production writer。
