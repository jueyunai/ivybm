# Technical Design

## 1. 数据模型

- `PlatformAccounts.aiAutoReplyEnabled: boolean`
- PostgreSQL：`ai_auto_reply_enabled BOOLEAN NOT NULL DEFAULT FALSE`
- 既有与新账号均 fail closed；Payload types 重新生成。
- 不新增 `ai_paused` Conversation 状态，不修改既有 handoff 语义。

## 2. API 与权限

- 复用 `PATCH /api/platforms/accounts/:id`，接受 `aiAutoReplyEnabled`。
- 继续要求 admin、`authorizationRevision` 和行锁/CAS；成功返回 redacted DTO 与新 revision。
- 显式审计 pause/resume，记录 actor、account id、前后布尔值和时间；不记录 Token、消息正文或外部 payload。

## 3. 入站数据流

```text
Meta Webhook
  -> signature / allowlist / account authorization
  -> platform.event.dispatch Job
  -> resolve account automation policy
  -> persist Conversation + visitor Message
  -> if paused: stop (no AI/lead/handoff/outbound)
  -> if enabled and conversation=ai_active: existing AI flow
```

建议增加 server-only `PlatformConversationAutomationPolicy`，按正确平台身份解析 `PlatformAccounts`。Instagram 不可假设 OAuth ID 与 Messaging ID 相同。

## 4. 出站竞态 gate

- 自动 delivery 在 `PayloadPlatformConversationDeliveryAuthority` provider I/O claim 内再次检查账号开关。
- 只拦截 `required_handoff_status = ai_active` 的自动回复；`human_active` 人工消息不受 AI 开关影响。
- 暂停命中时标记为不可重试的 `ai_auto_reply_paused`（如需新增 enum，由 migration 同步）；不得调用 provider。
- 恢复不重启被暂停的 intent。

## 5. Portal UI

- 重构 `PlatformReadinessPage` 为摘要卡 + 管理账号 dialog/drawer。
- 卡片展示连接、入站、AI 自动回复、发布四个互不混淆的状态。
- 高级 capability 与技术诊断折叠；断开/删除独立危险区。
- 使用现有 Portal Button/Dialog/Icon/token，不引入外部字体或新设计框架。

## 6. 失败模式

- stale revision：409 并刷新；不乐观伪造成功。
- 断开/未批准：开关禁用并解释依赖。
- AI intent 已排队后暂停：worker gate 阻断。
- 两账号并存：策略查询必须使用内部 account 或正确 provider identity，不能串账号。
- provider 已越过 I/O：沿用 `delivery_unknown`，暂停不能篡改未知结果。

## 7. 发布与回滚

- migration / Shared Collection /跨模块 contract 需要独立 Review。
- production migration 前备份，发布后验证暂停账号只落库不出站。
- 回滚前将暂停账号恢复 enabled 或保持新版 worker；禁止让旧代码忽略暂停策略。
