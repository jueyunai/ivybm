# Walkthrough: 资格回答状态归属修复

## 修复结果

资格状态现明确区分：

- `askedFields`：历史累计，仅用于防止重复追问；
- `awaitingFields`：当前一轮待答字段，只消费一次；
- `answeredCompany`：在正确待答上下文中确认并跨轮保留的公司。

旧会话没有 `awaitingFields` 时按空集合读取，不会把历史消息重新解释为公司。

## 关键回归

- 历史问过公司、当前等待时间时，`Next Quarter.` 不会成为公司。
- 当前等待公司时，姓名、拒答及 `We are Next Quarter.` 不会成为公司。
- `Company: Acme Facades` 与 `الشركة: النور` 可识别。
- 当前待答字段在一条访客消息后清空；已确认公司在后续轮次保持。
- Payload hydrate、幂等 replay 和 PostgreSQL 持久化保持同一状态。

## 验证记录

- 定向 unit：192/192 通过。
- ChatService contract：16/16 通过。
- PostgreSQL Conversation integration：9/9 通过。
- TypeScript typecheck：通过。
- 定向 ESLint：无 error。
- 隔离 PostgreSQL migration：up/down/up 通过，新增列与子表在回滚时消失、重跑后恢复。

## 数据库边界

新 migration 只新增：

- `conversations.qualification_answered_company`；
- `conversations_qualification_awaiting_fields` 及其 enum/index/foreign key。

Payload 生成器同时暴露了历史 snapshot 中一个无关知识库外键策略漂移；本 migration 已明确排除，未改变该外键。

## 剩余风险

- 公司实体识别仍是保守规则：没有结构标签且缺少高置信组织形状的品牌可能不自动识别，系统会保持字段缺失并转人工，而不会猜测写入 CRM。
- 共享 Conversation contract、Collection 和 migration 必须由另一名开发者独立 Review 后才能合并。
- 未部署 production，未使用真实客户资料或外部平台凭据。
