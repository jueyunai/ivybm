# 修复记录：发布重复发送与永久链接

## 结果

- 同一审核内容与同一平台账号已有 `scheduled`、`accepted`、`publishing`、`published` 或 `delivery_unknown` 任务时，新点击返回稳定 409，不创建第二条 PublishJob 或 Jobs 队列记录。
- 发布决策在 PostgreSQL transaction 内先锁定同一 `generated_contents` 行，因此两个不同幂等键并发点击也最多成功一个。
- Facebook 使用 Graph 返回的 `permalink_url`，Instagram 使用 IG Media 返回的 `permalink`；LinkedIn 仅在 GET-by-URN 确认为 `PUBLISHED` 后保存官方 feed URL。
- 永久链接缺失或查询失败时保留 provider ID / URN，URL 留空；不会凭 ID 猜链接，也不会重发已确认 mutation。
- `externalPublicationId` 与校验后的 `externalPublicationUrl` 通过同一 CAS transaction 持久化。

## 验证

- 平台 unit：移除会话侧 PoC 后 37 files / 518 tests，通过。
- 平台 contract：3 files / 22 tests，通过。
- TypeScript `--noEmit`：通过。
- 变更后源码已由 TypeScript 与平台测试覆盖；本轮仅新增 Markdown 记录，不在 ESLint 配置范围内。
- Prettier 与 `git diff --check`：通过。
- 隔离 PostgreSQL 18 fresh migration：全部 migration 通过。
- Content Studio 与 publishing authority integration：2 files / 10 tests，通过；包含 `delivery_unknown` 新 key 防重、不同 key 并发防重、direct mutation 只调用一次后的只读确认与 URL CAS 持久化。

## 外部联调边界

本地 fixture 仅证明 request/parser、状态机与持久化契约；Facebook、Instagram、LinkedIn 的真实 ID / URL 仍需在受控账号与官方权限齐备后逐平台验证。未取到永久链接时保持 URL 为空，不用人工拼接替代。

## Review 范围收口

当前 head Review 指出分支曾混入未接入 P0-D 发布运行时的会话侧 PoC。本轮已移除 Meta 私信出站 transport、会话 token provider、社媒联系人身份/投递 helper 及对应测试；发布凭据读取、三平台 publication worker、状态机、CAS、永久链接与 kill switch 保持不变。
