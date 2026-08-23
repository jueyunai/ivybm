# 飞书 CRM 接入运行手册

## 当前交付边界

Task 11 默认使用飞书官方“扫码一键创建自建应用”。管理员在 Portal 线索页点击“扫码连接飞书”，
扫码确认创建租户专属应用，再完成用户 OAuth；系统随后自动创建 CRM 多维表格、客户档案表、字段映射
和默认通知接收人。免费飞书租户可以使用，不要求企业版、ISV 商店审核，也不要求客户复制 App ID / Secret。

当前代码提供：

- 线索按本地 Lead ID 在飞书多维表格幂等新增或更新；
- 真实新建线索和新进入统一高意向状态的线索分别幂等通知；
- `nextFollowUpAt` 到期后按“Lead + 到期时间”幂等通知负责人或默认接收人；
- `handoff.created` 人工接管通知；
- 限流、Token 失效刷新、Job 指数退避、dead job、最终同步失败通知和管理员人工重试；
- OAuth `state` 单次消费并在十分钟后过期；统一商店 / 环境应用继续使用 PKCE S256，扫码创建的租户
  机密应用使用服务端 App Secret 换取 token，不附带 PKCE 参数，以兼容飞书扫码创建链路；
- 扫码 registration 十分钟过期，跨进程通过 PostgreSQL 状态锁去重；租户 App Secret 先加密暂存，
  OAuth 完成后转移到连接记录并从 registration 清除；
- access / refresh token 使用独立 AES-256-GCM 密钥加密，refresh token 轮换在数据库行锁内完成；
- OAuth 回调立即返回，durable `feishu.connection.provision` Job 在后台自动创建
  `IVYBM 客户管理` Base 和客户档案表，不启用企业版专属行列权限；
- 字段映射、销售用户到飞书 `open_id` 的成员映射和默认通知接收人由管理员配置，不在业务代码中写死飞书字段名或 ID。

经 Task 11 Review 确认，“下次跟进时间”已作为可空的 `Leads.nextFollowUpAt` UTC 时间进入
共享契约，并映射到飞书日期字段。worker 每 30 秒扫描已到期且未淘汰的 Lead，每个时间戳只创建
一个 durable reminder Job；日期变更会形成新的提醒身份，旧 Job 执行前会再次核对当前日期并安全
no-op。“最近跟进记录”仍只保留在飞书侧，回写范围另行确认。

## 建议的首版多维表格

| 字段                | 建议类型       | 数据来源 / 规则                                   |
| ------------------- | -------------- | ------------------------------------------------- |
| Local Lead ID       | 单行文本，唯一 | IVYBM `leads.id`，用于幂等 upsert，不允许人工修改 |
| 客户名称            | 单行文本       | 公司名优先，否则联系人姓名                        |
| 国家 / 地区         | 单行文本或单选 | IVYBM Lead                                        |
| 来源渠道            | 单选           | 官网表单、官网 AI、社媒等                         |
| 来源链接            | URL            | 首次进入系统的页面                                |
| 需求产品            | 多行文本       | Lead interest                                     |
| 项目阶段            | 单选           | 初始可映射 Lead status；最终选项由业务确认        |
| 客户等级            | 单选           | A / B / C / Unscored                              |
| 负责人              | 人员或文本     | 需在真实表格确认人员字段写入方式                  |
| 邮箱                | 邮箱或单行文本 | Lead email                                        |
| 电话                | 电话或单行文本 | Lead phone                                        |
| 原始咨询 / 客户画像 | 多行文本       | 首次咨询或已审核 Lead 摘要，不写入无关对话        |
| 下次跟进时间        | 日期时间       | IVYBM `nextFollowUpAt`，按 UTC 到期调度提醒       |
| 最近跟进记录        | 多行文本       | 飞书侧填写，后续回写范围另行确认                  |

字段显示名可以按客户习惯调整。Payload 的 `FeishuMappings` 负责把标准本地字段映射到实际
显示名，因此改名不需要修改业务代码。

## 默认激活步骤（推荐）

1. IVYBM 运维配置精确 HTTPS 回调地址 `FEISHU_OAUTH_REDIRECT_URI`、32 字节随机密钥的十六进制形式
   `FEISHU_CREDENTIAL_ENCRYPTION_KEY`，并确认 `NEXT_PUBLIC_SERVER_URL` 与回调同源。预检通过后再把
   `FEISHU_QR_REGISTRATION_ENABLED=true` 只注入 app 进程；客户不填写任何服务端配置。
   扫码注册 POST 以该 `NEXT_PUBLIC_SERVER_URL` 的 origin 作为同源安全边界，不使用反向代理内部的
   `request.url`；OpenResty 仍应覆盖 Host、X-Forwarded-Host 和 X-Forwarded-Proto。若 Portal 显示
   `Same-origin request required`，先核对浏览器 Origin 与该公开 URL，再检查有效代理配置，不得关闭同源保护。
2. 客户管理员打开 Portal `/dashboard/leads`，点击“扫码连接飞书”，扫码确认创建应用，然后完成用户授权。
3. 回调成功后页面先显示“正在自动创建客户表”；worker 以授权用户为 Owner 创建 Base 和客户档案表，
   再原子激活 `primary-leads` 映射并显示“已连接”。管理员刷新页面后即可点击“打开飞书客户表”。
4. 管理员补充销售用户到飞书 `open_id` 的成员映射；首次连接默认把安装管理员设为通知接收人。
5. 使用合成测试线索核对同步和通知，再投入真实使用。成功 Job 为 `succeeded`；临时失败按
   1 / 2 / 4… 秒退避，最多 5 次；dead
   任务由管理员确认配置和远端状态后人工重试。重试会从已经保存的 Base 或表格步骤继续，不要求客户
   再授权。

扫码创建模式不依赖 IVYBM 应用商店上架。首次生产启用仍必须使用受控免费租户完成扫码、OAuth、建表、
断开和重连 smoke；完成前保持 feature flag 为 `false`，不得伪造真实授权成功。

## 手动兜底模式

既有统一商店应用 OAuth 和 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 手动自建应用模式继续保留。
映射不关联 `FeishuConnection` 时，worker 仍可使用环境凭据获取内部 tenant token；这些路径只用于
兼容、私有化或受控运维，不再作为客户默认流程。

## 安全与运维

- 扫码模式不需要环境级 App ID / Secret。每个租户的 App Secret 只以 AES-256-GCM 密文保存；app
  用于 OAuth，worker 用于刷新和 bot tenant token。环境级 App Secret 仅服务兼容路径。
- access token、refresh token，以及兼容 OAuth 路径使用的 PKCE verifier 只以密文落库，API / Admin /
  日志不返回密文或明文。
- Bitable app token 和 table ID 是资源标识，不是应用密钥，但仍仅允许管理员读取。
- 通知只发送必要摘要，不发送完整 Token、内部提示词或无关对话。
- 修改 active 映射时，旧 revision 的未执行任务会安全结束，新 mapping revision 会重新生成
  幂等任务，不会使用旧字段配置继续写入。
- Lead 创建 / 更新与其 `feishu.lead.sync` Job 在同一 PostgreSQL 事务内持久化。Job
  payload 显式区分 `new_lead` / `high_intent` / `none`；首次连接时 relay 扫描的历史 Lead
  一律为 `none`，只做回填同步，不发“新客户”或“新高意向”通知。高意向与 Dashboard
  共用 `status in (new, qualified) AND intentLevel = a`，`contacted` / `disqualified` 不会误报。
- Lead 内容 hash 只作为远端写入的 stale fence，不再等同于业务事件身份。首次出现的内容 revision
  使用 canonical Job key；A → B → A 等回到历史内容的真实变更使用额外 change-event key，因此会重新
  同步当前状态，并对新的非高意向 → 高意向跃迁再次通知。内容未变的重复保存仍由 canonical key 去重；
  pending 通知被新 revision 携带时沿用原 notification-event identity，避免重复提醒。
- 当前 relay 每 30 秒扫描本地 Leads 和 durable Handoffs；一期数据量下可接受。数据量显著
  增长后应改为游标或数据库 outbox，而不是缩短轮询间隔。

## 已有记录的受控重同步

修复字段映射或切换 active mapping **不会自动改写已经成功同步的历史飞书记录**：worker 的普通
relay 会按 canonical Job key 去重。因此上线前必须先盘点是否存在受影响的历史 Lead。若需要修正，
使用 server-only 的 `feishu:resync` 工具，逐条或小批量传入明确的本地 Lead ID；它不会扫描全量数据，
不会发送“新客户”或“高意向”通知，也不会读取或输出飞书 token。

```bash
# 1. 默认 dry-run，只读取当前 Lead revision，并输出 planHash
pnpm feishu:resync -- \
  --lead-id 123 \
  --lead-id 456 \
  --plan /tmp/ivybm-feishu-resync.json

# 2. 由管理员人工核对 plan 文件后，使用完全相同的 hash 执行
pnpm feishu:resync -- \
  --plan /tmp/ivybm-feishu-resync.json \
  --execute \
  --confirm <planHash> \
  --requested-by <adminUserId>
```

执行前提和保护：

- 每次最多 50 个明确 Lead ID；没有 `--execute` 时绝不创建 Job。
- `--confirm` 必须与 dry-run 的完整 `planHash` 一致；Lead 内容、更新时间、active mapping 或 mapping revision
  在 dry-run 后发生变化时，执行会 fail closed，需重新 dry-run。
- 每个 Job 使用独立 resync 幂等键，payload 固定 `notificationIntent=none`，只触发 Lead upsert。
- 创建 Job 和 `feishu.lead.resync:<planHash>` 审计记录在同一事务中；失败整体回滚。
- 执行后由 worker 处理 Job，管理员核对成功状态和飞书记录；结果未知时停止自动重试并按原远端状态核对流程处理。

该工具是受控运维动作，不属于普通部署步骤；不得把它改造成无确认的全量 backfill，也不得在 PR 或日志中记录 token、
客户原始资料或完整 provider 响应。

- Lead after-change 与 Job insert 在同一数据库事务中，是状态跃迁事件的权威入口；relay 使用 canonical
  key 负责历史 / 当前快照回填，不从最终状态猜测已经发生过的中间通知事件。
- 同一 Lead 的多个内容 revision 在 PostgreSQL Lead 行锁事务内校验 revision，并串行执行远端
  search + create / update，避免旧 revision 覆盖新数据或并发空查后重复创建。飞书接受 create 但响应
  丢失时，普通 Job 重试会在同一锁内先按本地 Lead ID 重新查询；仍不宣称第三方副作用 exactly-once。
- worker 会把 dead 的 `feishu.lead.sync` 补建为独立失败通知 Job。通知不转发 provider 正文或 token，
  只包含 Lead ID、Job ID 和管理员人工重试指引；原 dead Job 仍由 Task 10 的管理员重试流程补偿。
  扫描和发送前都会核对 Lead 当前 revision，被新 revision 取代的失败 no-op；每次人工重试后以
  `manualRetryCount` 形成新失败周期，不会被上一周期的通知幂等键吞掉。
- worker 同时补扫 `provisioning` 连接，防止 callback 在连接落库后、Job 入队前异常而永久卡住。
  若连接为 `error`，先在 Jobs 中查看脱敏错误码并人工重试原 `feishu.connection.provision` Job；
  若为 `reconnect_required`，重新点击“连接飞书”。
- 飞书创建 Base / 表格接口不提供可用的客户端幂等键。代码会在 Base 创建后立即保存资源 ID，正常的
  建表失败重试不会重复建 Base；若远端已创建成功但 worker 在本地保存前崩溃，可能产生未关联 Base，
  管理员应在飞书中核对名称与创建时间后删除多余空 Base。
- 扫码创建应用同样没有业务侧幂等键。数据库状态锁可阻止正常并发重复执行，但 app 在飞书已创建应用、
  本地尚未保存凭据的极小窗口崩溃时可能留下未关联自建应用；管理员应按名称和创建时间在飞书开放平台清理。
  app 在等待扫码期间重启时不会恢复 SDK 长轮询，registration 十分钟后过期，管理员重新生成二维码即可。
- 在后台显示“正在自动创建客户表”时断开连接，会阻止 Job 后续写入和激活 mapping，但无法撤销已经
  发给飞书的创建请求；如果断开恰好发生在远端请求执行期间，也应按上一条核对并清理未关联空 Base。
- 后台主动断开使用同源 POST，并在单一数据库事务中清空本地凭据、过期时间和错误状态，同时停用
  所有关联 mapping；任一步失败会整体回滚。该操作不会调用飞书撤销 API，也不会删除客户 Base。
- 扫码重连会创建新的租户自建应用，飞书 `open_id` 不跨应用复用。provisioning 在重新激活 mapping 前
  会清空旧销售成员映射，并把默认通知收件人更新为本次安装管理员；未重新配置销售映射的已分配 Lead
  会安全回退给默认收件人。管理员应在重连完成后重新维护销售成员映射，不得复制旧应用 `open_id`。
  统一商店 `store_oauth` 复用同一应用身份，重新 provisioning 时继续保留已有销售映射。
