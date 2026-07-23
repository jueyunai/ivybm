# Task 13 Meta Webhook Route：审查记录

## Post-merge 前置核验

- `conversation_commands(scope, idempotency_key)` 唯一索引已在 Task 9 migration 中存在；并发 `find → create` 会命中唯一约束并重读，不产生两条会话命令。
- `rawPayloadDigest` 是外层 envelope 审计值，不是事件幂等身份；同一规范化事件在不同 webhook 批次中必须是 duplicate，现有测试已锁定。
- `skipAudit` 是内部写入防递归机制；人工接管另有显式 audit record。
- TikTok port 的显式拒绝是当前 Meta 阶段的依赖阻塞，不得伪造 channel / schema。

以上均为当前 `main` 的 post-merge audit 结论，不是对历史 PR 的重新审批。

## 本迭代待独立复核

- raw body 是否在任何 JSON parse 前受限；
- 缺 secret、错误 HMAC、异常持久化是否均无敏感信息；
- route 是否只调用既有 verifier / connector / Jobs inbox，而不绕过会话状态机；
- deployment 模板是否只列变量名、不包含真实值。

## 独立 route 审查结果

| Finding | 级别 | 处置 |
| --- | --- | --- |
| `repository: await resolveRepository()` 在 HMAC / content-type / 限流前求值，伪造请求可初始化 Payload / DB | P1 | 把 `PlatformEventRepository` 输入扩展为 lazy source；拒绝路径先完成验证，新增 provider spy 回归。 |
| 默认内存限流以单一 `meta-webhook` bucket 计数，多个 Meta 账号的合法突发会共享额度 | P2 | 已改为 HMAC、规范化与 allowlist 后按 `platform + accountExternalId` 分桶；仍需在真实多账号 staging 流量下验证容量。 |
| Compose 未将 Meta 配置传入 app，且 10 分钟时窗会拒绝 Meta 36 小时重投 | P1 | production / staging app 显式接收三项 Meta 变量，preflight 拒绝半配置；route 使用 48 小时已验签时窗，并覆盖故障后延迟重投仍只产生一条 Job。 |
| 任何绑定到同一 App 的账号可进入会话 | P2 | POST 现在要求非空 `META_WEBHOOK_ALLOWED_ACCOUNT_IDS`；未列账号在 repository / Payload 初始化前返回稳定 403。 |

上述修复完成后重新运行专项与完整质量门禁；仍需 jueyunai 跨人 review 及真实受控环境容量验证。
