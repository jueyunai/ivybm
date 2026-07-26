# Task 13 无账号交付加固：需求复核

## 范围

- 无 Facebook、Instagram、TikTok、LinkedIn 真实账号时，平台能力只能标为 `conditional` 或 `blocked`，不能把 fixture / mock 写成真实可用。
- 客户自行注册并持有业务账号、企业资产和最终管理员；一期不包含账号注册、养号或封号/账号恢复。IVYBM 只在收到书面授权且平台前置条件满足后，协助 API、Webhook、App 配置、审核材料与受控联调。
- LinkedIn 无 API 权限时必须交付审核、格式化、素材下载与人工发布辅助。
- TikTok 私信当前缺少可信官方 schema / 资格证据，保持 `blocked`；不创建猜测的 connector 或 payload。
- WhatsApp 仅保留历史可读，不创建一期新会话、Webhook 或自动回复。

## 外部依赖

真实 Webhook、OAuth、自动发布与 production 联调仍需客户资产、书面授权、平台审核及受控窗口。本轮不把这些依赖标为已完成。
