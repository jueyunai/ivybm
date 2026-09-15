# 客户侧自然 AI 回复与内部引用隔离 PRD

- 日期：2026-09-10
- Owner：xuemusi
- 范围：官网 ChatWidget、Facebook Messenger、Instagram DM、Portal 会话追溯

## 目标

- 客户收到的 AI 回复简短、自然，像一位了解项目的真人销售，而不是知识库问答机器人。
- 客户正文不出现 `[1]`、`[1, 3]`、知识库标题、版本或“参考来源”卡片。
- Portal 内部继续保存并展示引用文档、Prompt version、model 和 token usage，便于审核和纠错。
- 资格初筛、高风险转人工、三轮上限、人工接管和平台出站幂等边界不降级。

## 客户回复规则

1. 先直接回答客户当前问题；普通回复使用 2–4 个短句、1–2 个短段。
2. 模型正文不自行追问、不输出编号问卷；服务端在需要时追加最多两个相关问题。
3. 两个问题应属于同一沟通阶段，使用自然语气，不使用“Please provide the following details”。
4. 回复跟随客户语言；英文/阿语不得混入内部字段名或引用标记。
5. 只有客户明确要求比较、清单或步骤时才使用简短列表。
6. 禁止“As an AI”“Based on our knowledge base”“According to source [1]”等内部或模板化表述。

## 引用边界

- 知识仍以编号化上下文提供给模型，citation metadata 仍写入 Message。
- AI content 在保存前移除只包含有效知识序号的引用标记，如 `[1]`、`[1, 3]`。
- 网站访客 API 与 ChatWidget 不返回/展示 citation metadata。
- Portal operator 视图继续展示标题、版本和内部 URL。
- Facebook/Instagram 出站使用已清理的持久化 message content。

## 非目标

- 不删除数据库 citation metadata，不迁移历史消息。
- 不改变知识检索排序、Lead 评分、三轮上限、handoff 状态机或 Meta connector。
- 不改变高风险问题的人工接管策略，不允许模型承诺价格、交期、认证、付款或质保。
- 不新增语言、WhatsApp 或 LinkedIn 私信。

## 验收标准

- EN/AR 知识回复客户正文引用泄露率为 0；Portal 引用仍完整。
- 模型原始输出含 `[1]`、`[1, 3]` 时，客户正文清理后标点和换行自然。
- `[2024]`、产品型号等超出实际知识序号范围的方括号内容不被误删。
- 模型 instructions 明确禁止自行提问、编号问卷和引用；服务端仍最多追加两个问题。
- 普通 EN/AR 代表用例无编号问题、无内部来源、无机器人自我声明。
- 高风险 EN/AR 第一轮仍进入 `handoff_requested`，接管后 AI 自动回复为 0。
