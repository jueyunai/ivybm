# Task 11 飞书 CRM OAuth 技术方案

## 契约

- 授权入口：`GET /api/integrations/feishu/connect`，仅管理员，302 到飞书官方授权页。
- 回调：`GET /api/integrations/feishu/callback`，使用一次性 state + PKCE 校验，不依赖回调时登录态。
- 状态：`GET /api/integrations/feishu/status`，仅返回手工构造的非敏感摘要。
- 断开：`POST /api/integrations/feishu/disconnect`，清除本地 token 并停用关联映射。
- OAuth token：`POST https://accounts.feishu.cn/oauth/v3/token`，申请 `offline_access`。
- Base：用户 token 调用 `POST /bitable/v1/apps` 和 `POST /bitable/v1/apps/:app_token/tables`。

## 数据与安全

- `FeishuOAuthStates` 只保存 state SHA-256、加密 PKCE verifier、申请人、过期与单次使用时间；
  update 使用数据库行锁，重复回调只有一个成功。
- `FeishuConnections` 保存 tenant、安装用户、scope、过期时间、Base 标识和 AES-256-GCM 密文；
  token 字段 field-access 禁止读取，状态 API 不返回密文。
- `FEISHU_CREDENTIAL_ENCRYPTION_KEY` 与平台账号密钥分离；App Secret 只存在 app / worker 环境。
- refresh token 为单次使用。刷新在连接行 `FOR UPDATE` 事务内完成，新 access / refresh token 原子轮换。
- Base 同步使用 user token；IM 通知使用商店应用 app token + tenant key 换取 tenant token。

## 兼容与回滚

- `FeishuMappings.connection` 可空：有关联时使用 OAuth token provider；为空时沿用内部 tenant token。
- 无 active mapping 时 worker 不访问飞书。连接断开会停用关联映射。
- 回滚先停用 mapping，再回滚应用；不会删除客户飞书中的 Base 或记录。
- fixture / fake fetch 不访问真实网络。真实可用必须等待应用商店审核和受控租户 smoke。
