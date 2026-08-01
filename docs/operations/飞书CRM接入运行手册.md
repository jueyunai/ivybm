# 飞书 CRM 接入运行手册

## 当前交付边界

Task 11 默认使用 IVYBM 飞书应用商店应用 OAuth。管理员在 Payload 后台点击“连接飞书”，
同意授权后系统自动创建 CRM 多维表格、客户档案表、字段映射和默认通知接收人。免费飞书租户
可以使用这条路径，不要求客户购买企业版，也不要求客户手动创建企业自建应用。

当前代码提供：

- 线索按本地 Lead ID 在飞书多维表格幂等新增或更新；
- 首次新线索和 A 级高意向线索分别幂等通知；
- `nextFollowUpAt` 到期后按“Lead + 到期时间”幂等通知负责人或默认接收人；
- `handoff.created` 人工接管通知；
- 限流、Token 失效刷新、Job 指数退避、dead job、最终同步失败通知和管理员人工重试；
- OAuth `state` 单次消费、5 分钟过期和 PKCE S256；
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

1. IVYBM 运维在部署环境配置已审核的飞书应用商店应用：`FEISHU_APP_ID`、
   `FEISHU_APP_SECRET`、精确回调地址 `FEISHU_OAUTH_REDIRECT_URI`，以及 32 字节随机密钥的
   十六进制形式 `FEISHU_CREDENTIAL_ENCRYPTION_KEY`。这些都是 IVYBM 服务端配置，不由客户填写。
2. 客户管理员打开 Payload Admin 的“飞书 CRM”，点击“连接飞书”，在飞书页面确认授权。
3. 回调成功后后台先显示“正在自动创建客户表”；worker 以授权用户为 Owner 创建 Base 和客户档案表，
   再原子激活 `primary-leads` 映射并显示“已连接”。管理员刷新页面后即可点击“打开飞书客户表”。
4. 管理员补充销售用户到飞书 `open_id` 的成员映射；首次连接默认把安装管理员设为通知接收人。
5. 使用合成测试线索核对同步和通知，再投入真实使用。成功 Job 为 `succeeded`；临时失败按
   1 / 2 / 4… 秒退避，最多 5 次；dead
   任务由管理员确认配置和远端状态后人工重试。重试会从已经保存的 Base 或表格步骤继续，不要求客户
   再授权。

飞书应用必须先完成 ISV / 应用商店资质与审核，才能供不同租户一键安装。审核尚未完成时，
代码、fixture 和本地回调可验收，但生产状态必须保持 blocked，不得伪造真实授权成功。

## 手动兜底模式

既有 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 企业自建应用模式继续保留：映射不关联
`FeishuConnection` 时，worker 使用内部 tenant token。该模式只用于应用商店审核阻塞、私有化
或受控运维场景，不再作为客户默认流程。

## 安全与运维

- `FEISHU_APP_SECRET` 注入 app 与 worker，不注入浏览器、迁移或 seed 容器；app 用于服务端
  OAuth 换 token，worker 用于刷新和获取商店应用 tenant token。
- access token、refresh token 和 PKCE verifier 只以密文落库，API / Admin / 日志不返回密文或明文。
- Bitable app token 和 table ID 是资源标识，不是应用密钥，但仍仅允许管理员读取。
- 通知只发送必要摘要，不发送完整 Token、内部提示词或无关对话。
- 修改 active 映射时，旧 revision 的未执行任务会安全结束，新 mapping revision 会重新生成
  幂等任务，不会使用旧字段配置继续写入。
- 当前 relay 每 30 秒扫描本地 Leads 和 durable Handoffs；一期数据量下可接受。数据量显著
  增长后应改为游标或数据库 outbox，而不是缩短轮询间隔。
- 同一 Lead 的多个内容 revision 在 PostgreSQL Lead 行锁事务内校验 revision，并串行执行远端
  search + create / update，避免旧 revision 覆盖新数据或并发空查后重复创建。飞书接受 create 但响应
  丢失时，普通 Job 重试会在同一锁内先按本地 Lead ID 重新查询；仍不宣称第三方副作用 exactly-once。
- worker 会把 dead 的 `feishu.lead.sync` 补建为独立失败通知 Job。通知不转发 provider 正文或 token，
  只包含 Lead ID、Job ID 和管理员人工重试指引；原 dead Job 仍由 Task 10 的管理员重试流程补偿。
- worker 同时补扫 `provisioning` 连接，防止 callback 在连接落库后、Job 入队前异常而永久卡住。
  若连接为 `error`，先在 Jobs 中查看脱敏错误码并人工重试原 `feishu.connection.provision` Job；
  若为 `reconnect_required`，重新点击“连接飞书”。
- 飞书创建 Base / 表格接口不提供可用的客户端幂等键。代码会在 Base 创建后立即保存资源 ID，正常的
  建表失败重试不会重复建 Base；若远端已创建成功但 worker 在本地保存前崩溃，可能产生未关联 Base，
  管理员应在飞书中核对名称与创建时间后删除多余空 Base。
- 在后台显示“正在自动创建客户表”时断开连接，会阻止 Job 后续写入和激活 mapping，但无法撤销已经
  发给飞书的创建请求；如果断开恰好发生在远端请求执行期间，也应按上一条核对并清理未关联空 Base。
- 后台主动断开使用同源 POST，并在单一数据库事务中清空本地凭据、过期时间和错误状态，同时停用
  所有关联 mapping；任一步失败会整体回滚。该操作不会调用飞书撤销 API，也不会删除客户 Base。
