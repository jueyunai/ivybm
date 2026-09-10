# 客户侧自然 AI 回复测试用例

| ID     | 场景                                | 预期                                                       |
| ------ | ----------------------------------- | ---------------------------------------------------------- |
| HR-001 | 模型输出 `Answer [1]. More [1, 3].` | 客户正文无有效引用标记；Message citations 保留三条         |
| HR-002 | 模型输出年份 `[2024]` 或产品型号    | 不误删非实际知识序号                                       |
| HR-003 | EN FAQ                              | 2–4 个短句，无引用、无自问、无编号问卷                     |
| HR-004 | EN qualification                    | 回答后追加最多两个自然问题，不含 `1.` / `2.`               |
| HR-005 | AR qualification                    | 全阿语，最多两问，不重复已问字段                           |
| HR-006 | Visitor snapshot / ChatWidget       | 不返回、不展示 citation metadata                           |
| HR-007 | Portal operator snapshot            | 保留 citation title/version/URL 与模型元数据               |
| HR-008 | Facebook/Instagram outbound         | intent text 使用已清理 content                             |
| HR-009 | 高风险 EN/AR                        | 不调用模型，立即按既有策略转人工                           |
| HR-010 | 生成文本清理后为空                  | 不发送空消息，转 `reviewed_knowledge_unavailable` 人工路径 |
