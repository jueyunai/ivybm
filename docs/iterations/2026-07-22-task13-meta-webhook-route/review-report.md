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
| 默认内存限流以单一 `meta-webhook` bucket 计数，多个 Meta 账号的合法突发会共享额度 | P2 | 当前不信任伪造代理 IP，保留保守全局桶；真实多账号吞吐前，以已验签账号维度或可信 ingress 设计独立容量策略。 |

P1 修复后，专项 unit、integration、typecheck 和 lint 均通过；完整质量门禁（unit、contract、integration、operations、build）均通过，仍需 jueyunai 跨人 review。
