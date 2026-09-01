# Requirements Review

主 PRD：[`../../ai-auto-reply-control_PRD_UNDERSTANDING.md`](../../ai-auto-reply-control_PRD_UNDERSTANDING.md)

## 输入来源

- 用户要求新增关闭 AI 自动回复的能力，并明确要求先写 PRD、拆解、再派子代理实现。
- 用户截图：平台账号编辑表单拥挤、状态重复、操作层级混乱。
- 生产事实：Instagram DM 自动回复已跑通；断开授权可以止损，但会同时停止入站。
- 现有代码事实：没有账号级 AI 开关；会话非 `ai_active` 时能保留入站、阻止 AI。

## 范围冻结

- 账号级自动回复控制：Facebook Messenger、Instagram DM。
- 账号页交互重构：摘要卡、管理对话框、危险操作分区、响应式和可访问性。
- AI 生成前与 provider I/O 前双重 gate。
- 默认关闭，显式开启；暂停期间只记录消息，不自动重放。

## 非目标

- 定时规则、TikTok、LinkedIn 私信、WhatsApp、多租户策略。
- OAuth/Webhook 协议改造、内容发布流程改造。

## 独立审查结论

- 产品分析：必须区分账号暂停、会话人工接管和断开授权。
- 架构审查：独立字段不能复用 capability 或 handoff；只改 UI/入队 gate 会留下竞态，worker claim 必须二次检查。
