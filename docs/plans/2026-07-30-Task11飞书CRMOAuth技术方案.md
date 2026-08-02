# Task 11 飞书 CRM OAuth 技术方案

## 契约

- 授权入口：`GET /api/integrations/feishu/connect`，仅管理员，302 到飞书官方授权页。
- 回调：`GET /api/integrations/feishu/callback`，使用一次性 state + PKCE 校验，不依赖回调时登录态；
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

- `FeishuOAuthStates` 只保存 state SHA-256、加密 PKCE verifier、申请人、过期与单次使用时间；
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
