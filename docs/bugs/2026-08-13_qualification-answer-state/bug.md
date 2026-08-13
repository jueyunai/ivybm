# Bug: 资格回答被重复解释为公司

## 关联需求

- `docs/plans/2026-08-10-MVP范围冻结与交付冲刺.md` 的 P0-B 官网 AI 客服初筛闭环。
- 已合并 PR #76 的多轮资格追问与 Lead 评分。

## 问题描述

资格流程只保存累计的 `askedFields`，但 Lead 解析器把它当成“当前正在等待回答的字段”。公司一旦在任意历史轮次被问过，后续时间、姓名或拒答消息仍会进入 prompted-company 解析，从而产生错误的 `company_identified`、意向分数和高意向接管。

已复现的错误输入包括：

- `Would Rather Not Disclose.`
- `My name is Alex Chen from UAE.`
- `Next Quarter.`

## 根因分析

`askedFields` 同时承担了两个不同语义：

1. 历史累计字段，用于避免重复提问；
2. 当前待答字段，用于解释下一条访客消息。

第二个语义必须是单轮、一次性消费的状态，不能从历史累计集合推断。此前围绕拒答同义词增加正则只能覆盖样例，无法修复字段归属错误，因此相似输入会持续复发。

## 修复方案

- 新增 `awaitingFields`：只记录上一条 AI 回复实际提出、供下一条访客消息消费的字段。
- `askedFields` 保持历史累计语义，不再参与 prompted-company 判断。
- Lead 评估完成后立即清空 `awaitingFields`；旧会话缺失该字段时按空集合处理。
- 新增 `answeredCompany` 持久化已在正确上下文确认的公司，避免待答上下文消费后下一轮评分丢失公司。
- 公司追问明确要求 `Company: ...` / `الشركة: ...` 结构；未带标签的英文只接受高置信组织形状，阿语裸回答 fail closed。
- 姓名、拒答、时间回答不能产生 `company_identified`；`We are ...` 同样必须满足高置信组织形状。

## 影响范围

- Conversation 资格状态 contract、服务状态机和 Payload repository。
- `Conversations` 共享 Collection、前向 migration 与生成类型。
- 英文/阿语公司信号解析及相关 unit、contract、integration fixture。

不修改 CI、生产配置、其他资格字段解析或并行的国家边界修复。
