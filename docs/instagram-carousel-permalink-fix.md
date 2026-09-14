# Instagram 轮播帖链接丢失修复

## 来源与目标

| 来源                 | 事实                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------- |
| 2026-09-14 生产截图  | Instagram 发布记录显示“已发布”和媒体 ID，但没有可点击链接。                             |
| 生产库 PublishJob #4 | `published`，`externalPublicationId=18116793680282345`，`externalPublicationUrl` 为空。 |
| 当前代码             | Instagram 单图在发布成功后查询 `permalink`；轮播路径只保存媒体 ID。                     |

目标：Instagram 轮播帖发布 mutation 确认成功后，用媒体 ID 读取并保存官方 `permalink`，使 Portal 发布记录自动显示可点击帖子链接。

## 范围边界

- 不重新发布已经成功的帖子，不改变幂等、CAS、lease fence 和 `delivery_unknown` 语义。
- permalink 是发布成功后的只读补充数据；查询失败时仍保留 `published + mediaId`，不重试发布 mutation，不伪造 URL。
- 只接受官方 HTTPS Instagram 链接，不改动 Facebook、LinkedIn 和 Portal UI 结构。
- 对现有 PublishJob #4 的回填必须先通过官方只读 API 取得 permalink，再以精确 ID/状态/媒体 ID/空 URL 条件更新，不触发平台发布。

## 技术流程

```text
carousel container ready
  -> POST /{ig-user-id}/media_publish
  -> validate and persist mediaId
  -> GET /{mediaId}?fields=permalink   (read-only, best effort)
  -> persist published + mediaId + optional permalink
  -> Portal renders the existing URL anchor
```

## 验收与测试

| ID         | 场景                             | 预期                                                                   | 证据                            |
| ---------- | -------------------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| IG-LINK-01 | 轮播发布成功，permalink 查询成功 | checkpoint 为 `published`，同时保存 mediaId 与 canonical Instagram URL | unit + PostgreSQL integration   |
| IG-LINK-02 | 发布成功，permalink 查询抛错     | 仍为 `published`，保留 mediaId，无 URL，后续调用不重发                 | unit test                       |
| IG-LINK-03 | transport 返回非 Instagram URL   | 不保存伪造 URL，仍保留已发布真相                                       | unit test                       |
| IG-LINK-04 | 生产旧帖回填                     | 官方读取返回 canonical URL；只更新 PublishJob #4 空 URL，帖子数不变    | 生产读回 + SQL row count        |
| IG-LINK-05 | Portal 刷新发布结果              | 记录中媒体 ID 成为可点击链接                                           | production screenshot/read-back |

## 风险、可观测性与回滚

- 风险：发布 mutation 成功后 permalink API 短暂不可用。处理：不降级发布状态，不自动重发，保留 mediaId 用于人工核对/回填。
- 可观测性：PublishJob 的 `externalPublicationId` / `externalPublicationUrl` 和 checkpoint 是权威证据；不在日志输出 access token。
- 部署：应用代码变更，无 migration。需合并后构建同 SHA runtime/worker 镜像再部署。
- 回滚：回退本修复提交并重新部署；已回填的官方 permalink 为可验证只读补充数据，无需删除。
