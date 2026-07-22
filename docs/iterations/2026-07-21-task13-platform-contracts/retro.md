# Task 13 平台契约迭代：Retro

## 本轮交付

- 清理旧的一期 WhatsApp connector、fixture 和测试。
- 冻结 Messenger / Instagram / TikTok 消息类型，以及 Facebook / Instagram / LinkedIn 发布 port。
- 完成平台 verifier、raw-byte Meta HMAC、challenge、content type、body 大小、过去/未来时间窗、验签后限流和批次原子幂等。
- 完成 Meta Messenger / Instagram 合成 fixture 契约与 LinkedIn assisted export。
- 形成 requirements、design、tasks、tests、review、acceptance、release 和 PoC 证据。

## 延期 / 阻塞

- TikTok 私信 connector：缺官方事件 schema、商业账号权限和 channel 前向 migration。
- 发布数据库 adapter：Task 12 `PublishJobs` / `PublishLogs` 未合并。
- Webhook route、Jobs handler、真实发布和失败补偿：需要对应数据库结构与真实平台授权。

## 过程改进

- 幂等摘要必须与唯一键粒度一致；raw body 摘要用于审计，单事件规范化摘要用于冲突判断。
- 外部 reviewer 只能提供静态结论，最终测试证据必须由 controller 在同一工作树执行。
- `/root` 下 Compose bind mount 可能被 Docker 目录权限阻断；本轮改用同一固定镜像的无源码挂载临时容器，并在结束后清理。
- mock/fixture 通过始终记录为 conditional，不得代替真实平台 availability。
