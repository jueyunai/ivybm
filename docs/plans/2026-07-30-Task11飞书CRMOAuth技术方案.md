# Task 11 飞书 CRM OAuth 技术方案

## 2026-08-05 扫码一键创建应用修订

### 来源、目标与范围

- 产品来源：用户确认飞书官方[一键创建飞书智能体应用](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview)
  已提供 RFC 8628 扫码注册；此前“先申请商店应用、客户共享一个 App ID/Secret”不再是默认方案。
- 目标：客户免费飞书租户的管理员只需在 IVYBM Portal 点击连接并扫码确认，系统自动创建该租户
  自有应用、配置最小权限和 OAuth 回调，再复用现有 OAuth、异步建表、同步、通知和补偿链路。
- 非目标：本批次不接收飞书入站消息、不订阅事件或卡片回调、不申请文档/通讯录等默认智能体权限，
  不删除既有商店应用连接或内部 App ID/Secret 运维回退，也不部署 production。
- 假设：官方 `@larksuiteoapi/node-sdk >= 1.61.1` 的 `registerApp` 创建 Developer Platform
  Custom App；扫码人必须拥有当前租户创建自建应用的权限。真实租户条件不足时只以官方协议 fake
  和受控测试应用验收，不伪造 production 可用。

### 产品体验与状态

- 默认入口位于 `/dashboard/leads`，只对 Admin 显示；Payload `/admin` 维持内部维护用途，不扩展为
  新产品入口。
- 首屏文案必须在 5 秒内说明“无需手工创建应用，扫码后系统自动配置”；操作状态为
  `idle -> pending -> registering -> qr_ready -> configuring -> authorization_ready -> completed`，以及
  `failed / expired / cancelled`。加载、二维码过期、扫码拒绝、配置失败和 OAuth 失败必须给出下一步。
- 二维码 URL 十分钟有效且只允许一人使用；页面轮询服务端状态。扫码成功后页面跳转飞书 OAuth
  授权，授权成功继续现有 `provisioning -> connected` 状态。
- `FEISHU_QR_REGISTRATION_ENABLED` 是外部建应用副作用 kill switch，默认关闭；关闭时页面显示
  dependency-gated，路由返回稳定错误码，不调用飞书。

### 技术流与最小权限

1. Admin POST 创建 `FeishuAppRegistration`，数据库 advisory lock 保证同一时间最多一个有效注册；
   app 进程后台调用 `registerApp`，不占用串行 Task 10 worker。
2. 使用 `createOnly: true`、`addons.preset: false`，只申请：
   - tenant：`application:application:patch`、`im:message:send_as_bot`
   - user：`auth:user.id:read`、`bitable:app`、`offline_access`
   - 不申请 events / callbacks。
3. `onQRCodeReady` 只保存短期 QR URL 和过期时间；成功返回的 App Secret 立即以
   `FEISHU_CREDENTIAL_ENCRYPTION_KEY` AES-256-GCM 加密，任何 API、日志、Job 或 UI 均不回显。
4. 使用新应用的 tenant token 调用 `PATCH /application/v7/applications/:app_id/config`，增加精确
   `redirect_urls` 并启用 `allow_refresh_token`；然后创建十分钟有效的一次性 state 和授权 URL。扫码创建的
   租户应用属于持有 App Secret 的服务端机密应用，换取 token 时不附带 PKCE；环境 / 统一商店兼容路径
   继续使用 PKCE S256。
5. OAuth callback 从 registration 取得租户专属 App ID/Secret，交换 user token、取得 tenant key，
   将 App ID 与加密 App Secret 转移到 `FeishuConnection(authMode=qr_registered)`，随后清空
   registration 中的 Secret，并入队现有 `feishu.connection.provision`。
6. `PayloadFeishuTokenProvider` 对 `qr_registered` 使用连接自己的凭据刷新 user token、获取 app /
   tenant token；历史 `store_oauth` 连接和 connection 为空的 mapping 继续使用环境变量回退。

### 失败、并发与安全

- 注册状态、QR 过期时间、App ID、加密 Secret 和脱敏错误码持久化；app 进程重启不会把失败误报成功，
  但正在轮询的 SDK 会中止，过期后管理员重新扫码。扫码成功而本地凭据持久化前崩溃仍可能留下客户
  租户内的 orphan 空应用，运行手册必须记录人工识别与删除方式，不宣称 exactly-once。
- 并发点击返回同一个有效 registration，不重复创建应用；`access_denied`、`expired_token`、`abort`
  映射为稳定状态。Provider description、App Secret、device code 和 header 不写日志或错误正文。
- OAuth state 绑定 registration；state 单次消费、registration 状态和租户专属凭据共同阻止跨租户
  callback 混用。连接、registration 和 state 的 Secret 字段全部 field-access hidden。
- 主动断开继续以单事务清除 user token、租户 App Secret 并停用 mapping；不会删除客户租户中的应用
  或 Base。旧连接数据保持可读；新增 migration 只前向添加表、字段和 enum 值，不修改历史 migration。

### 验收与测试矩阵

| ID    | 场景                             | 预期证据                                                                                       |
| ----- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| QR-01 | Admin 启用开关后开始连接         | 只创建一个 registration，返回 pending/qr_ready；非 Admin 为 403                                |
| QR-02 | 开关关闭、重复点击               | 关闭时零外部调用；并发点击复用有效 registration                                                |
| QR-03 | 官方 SDK fake 返回 QR 后成功     | QR URL/过期时间可见，App Secret 仅密文落库，最小 scopes/createOnly 参数锁定                    |
| QR-04 | 拒绝、过期、Abort、provider 正文 | 稳定 failed/expired/cancelled 与脱敏 error code，响应/日志无 Secret 和正文                     |
| QR-05 | 自动配置应用                     | tenant token 与 PATCH URL/body 正确，redirect 精确、refresh enabled，无事件订阅                |
| QR-06 | authorization_ready -> callback  | state 绑定 registration，连接保存租户 app 凭据，registration Secret 清空，仅一个 provision Job |
| QR-07 | callback 重放/跨 registration    | fail closed，不交换 token、不创建第二连接或 Job                                                |
| QR-08 | token refresh / IM               | qr_registered 使用自身凭据；store_oauth 和 env fallback 回归不变                               |
| QR-09 | disconnect                       | 单事务清除 user token 与租户 App Secret、停用 mapping；stale Job no-op                         |
| QR-10 | Portal 390/1440                  | Admin 看扫码/过期/失败/成功状态；Operator/Sales 不出现凭据或连接控制，无横向溢出               |
| QR-11 | migration down/up                | 旧 store_oauth 数据保留；新增 registration/凭据字段可前向迁移和受控回滚                        |
| QR-12 | production smoke（受阻）         | 受控免费租户扫码、OAuth、自动建表、线索同步、IM 提醒；无真实账号时明确 blocked                 |

## 契约

- 授权入口：`GET /api/integrations/feishu/connect`，仅管理员，302 到飞书官方授权页。
- 回调：`GET /api/integrations/feishu/callback`，所有路径使用一次性 state；环境 / 统一商店兼容路径另加
  PKCE 校验，扫码机密应用使用 App Secret，不依赖回调时登录态；
  只交换 token、读取安装用户、保存 `provisioning` 连接并创建 durable Job，不在 HTTP 请求内创建 Base。
- 状态：`GET /api/integrations/feishu/status`，仅返回手工构造的非敏感摘要。
- 断开：`POST /api/integrations/feishu/disconnect`，清除本地 token 并停用关联映射。
- OAuth token：`POST https://accounts.feishu.cn/oauth/v3/token`，申请 `offline_access`。
- Base：worker 的 `feishu.connection.provision` 使用用户 token 调用 `POST /bitable/v1/apps` 和
  `POST /bitable/v1/apps/:app_token/tables`。

## Provisioning 状态机

- OAuth 成功后连接进入 `provisioning`，Job 幂等键为 `connectionId:lastConnectedAt`；callback
  入队失败时，worker 的维护扫描会为仍处于 `provisioning` 的连接补建同一任务。
- handler 先创建 Base 并立即保存 `appToken` / `baseURL`，再创建表格并立即保存 `tableId`，最后在
  同一数据库事务中激活 `primary-leads` mapping 并把连接切为 `connected`。
- 临时错误由 Task 10 Job 以 1 / 2 / 4… 秒退避重试，最多 5 次；最后一次失败把连接切为
  `error`，Job 进入 `dead`。管理员人工重试原 Job 后，handler 允许从已保存步骤继续执行。
- 断开连接会清除 token、停用 mapping 并把状态切为 `disconnected`；尚未执行或旧 revision 的
  provisioning Job 只做 no-op，不会重新激活连接。
- 飞书创建 Base / 表格接口没有可用的客户端幂等键。分步持久化可避免“Base 已保存、建表失败”时
  重复建 Base，但若飞书已成功而进程在本地保存前退出，仍可能留下一个未关联的 orphan Base；
  运行手册要求人工确认后清理，不声称外部副作用 exactly-once。

## 数据与安全

- `FeishuOAuthStates` 只保存 state SHA-256、加密 verifier（仅兼容 PKCE 路径使用）、申请人、过期与
  单次使用时间；
  update 使用数据库行锁，重复回调只有一个成功。
- `FeishuConnections` 保存 tenant、安装用户、scope、过期时间、Base 标识和 AES-256-GCM 密文；
  token 字段 field-access 禁止读取，状态 API 不返回密文。
- `FEISHU_CREDENTIAL_ENCRYPTION_KEY` 与平台账号密钥分离；App Secret 只存在 app / worker 环境。
- refresh token 为单次使用。刷新在连接行 `FOR UPDATE` 事务内完成，新 access / refresh token 原子轮换。
- refresh token 被撤销、过期或无效（含 `20024` / `20026`）时，失败的轮换事务先回滚，再用独立
  行锁事务把连接持久化为 `reconnect_required`；管理页不会继续显示可用。
- Base 同步使用 user token；IM 通知使用商店应用 app token + tenant key 换取 tenant token。
- provisioning Job payload 不保存 token，只保存连接 ID 和授权 revision；错误状态只记录脱敏错误码，
  不记录飞书响应正文、token 或请求 header。

## 兼容与回滚

- `FeishuMappings.connection` 可空：有关联时使用 OAuth token provider；为空时沿用内部 tenant token。
- 无 active mapping 时 worker 不访问飞书。连接断开会停用关联映射。
- OAuth callback、status、disconnect 和 provisioning handler 使用隔离 PostgreSQL + fake Feishu fetch
  做集成测试；覆盖 state 重放、单任务入队、异步建表、部分成功续跑、最终 error 和断开后 stale no-op。
- 回滚先停用 mapping，再回滚应用；不会删除客户飞书中的 Base 或记录。
- fixture / fake fetch 不访问真实网络。真实可用必须等待应用商店审核和受控租户 smoke。
- `Leads.nextFollowUpAt` 以 UTC 保存并映射为 Base 日期字段；worker 对已到期 Lead 创建稳定 reminder
  Job，执行时重新核对当前到期时间。dead lead sync 由维护扫描恢复为脱敏失败通知，原 Job 继续走
  Task 10 管理员人工重试。相同 Lead 的 upsert 在远端 search + write 全程持有 PostgreSQL Lead
  行锁并核对内容 revision，跨 worker 串行化且阻止旧 revision 回写，但不宣称远端副作用 exactly-once。
- Lead after-change 与同 revision 的同步 Job 同事务持久化，payload 显式记录通知意图；历史 relay
  回填默认无通知。新线索 / 新高意向通知不从“首次同步”推测。高意向谓词与 Dashboard 共用；
  dead 通知同时绑定 Lead revision 和 `manualRetryCount` 失败周期，被取代或过期的失败安全 no-op。
- 主动断开由 Admin client 明确确认后发送同源 POST；清空凭据和停用 mapping 使用一个数据库事务，
  失败整体回滚。
