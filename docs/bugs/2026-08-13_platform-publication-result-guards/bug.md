# Bug: 发布结果未知后可重复发送且成功 URL 未落库

## 关联需求

- `docs/plans/2026-08-10-MVP范围冻结与交付冲刺.md` P0-D
- PR #81 `feat(task13): 完成三平台用户触发 API 发布`

## 问题描述

1. 同一已审核内容和同一平台账号在已有 `scheduled`、`accepted`、`publishing`、`published` 或 `delivery_unknown` 发布任务后，用户使用新的点击幂等键仍可创建第二个真实发布任务。
2. 发布权威层只写 `externalPublicationId`，没有写 `externalPublicationUrl`，因此工作台无法记录 P0-D 要求的平台内容 URL。

## 复现步骤

1. 对同一 `GeneratedContents` 和平台账号执行一次 `publish-now`。
2. 将首个任务推进为 `delivery_unknown`，或保留为其他进行中/已发布状态。
3. 使用新的 `Idempotency-Key` 再次点击同一平台账号。
4. 当前实现会创建新的 `PublishJobs` 和 `platform.publication.execute` Jobs 记录。
5. 将任一成功 transition 提交到 Payload CAS 后读取 `publish_jobs.external_publication_url`，字段仍为空。

## 根因分析

- `publishContentStudioNow` 只按本次点击派生的 `idempotencyKey` 查重，没有把 `content + platformAccount + authoritative status` 作为服务端重复发送边界。
- 即使新增“先查旧任务再创建”的检查，不同 key 的并发事务仍会同时读到空结果，因此必须在检查前锁定同一 `generated_contents` 行。
- Payload CAS 的 transition 写入只携带 `externalPublicationId`；provider transport / stage transition 到持久化链路没有 URL 字段。
- Facebook、Instagram 的永久链接必须读取 Graph API 的 `permalink_url` / `permalink`，不能用 provider ID 猜 URL；LinkedIn 也必须先确认帖子为公开发布状态，再使用官方 URN permalink 规则。

## 修复方案

- 在内容行事务锁内，对每个目标账号查询同内容、同账号的不可重复状态；存在时 fail closed，不创建任何新发布任务或队列记录。确认失败的 `failed` 仍允许用户以新点击显式重试。
- Facebook 发布后读取 Page post 的 `permalink_url`；Instagram 发布后读取 IG Media `permalink`；LinkedIn 先以 GET-by-URN 确认 `PUBLISHED`，再按官方 `/feed/update/{URN}/` 规则生成链接。查询失败时只保存 ID / URN，不伪造 URL，也不把已确认 mutation 降级成未知结果。
- 将经过 host、HTTPS、凭据和 fragment 校验的官方内容 URL 纳入 provider 结果、执行 transition 和 CAS，同内容 ID 一起原子持久化。
- 增加数据库回归测试，证明 `delivery_unknown` 后新 key不会新增 PublishJob / Jobs、两个不同 key 的并发点击最多成功一个；增加各执行路径的 URL 写入测试。
