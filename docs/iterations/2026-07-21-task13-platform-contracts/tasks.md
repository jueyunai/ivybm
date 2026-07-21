# Task 13 平台契约迭代：任务拆分

| 任务                                   | Owner                       | Reviewer          | 状态      | 验收                                                                     |
| -------------------------------------- | --------------------------- | ----------------- | --------- | ------------------------------------------------------------------------ |
| 需求与依赖复核                         | Codex controller + 子 Agent | Kimi              | completed | 一期范围、非目标和阻塞项有证据。                                         |
| 清理 WhatsApp 旧实验                   | Codex controller            | Claude            | completed | 代码、fixture、测试和 README 无 WhatsApp connector。                     |
| Webhook verifier 与幂等冲突            | Codex controller            | Claude            | completed | raw body、content type、时间窗、单事件摘要 duplicate/conflict 测试通过。 |
| Meta 入站 contract                     | Codex controller            | QA Agent          | completed | Messenger/Instagram fixtures 通过。                                      |
| 发布 ports 与 LinkedIn assisted export | Codex controller            | Product Agent     | completed | 三发布平台 contract 与导出测试通过。                                     |
| TikTok schema 阻塞记录                 | Codex controller            | Kimi              | completed | 不创建伪造 fixture；PoC 明确 blocked。                                   |
| Release gate                           | Codex controller            | Claude + QA Agent | completed | lint、typecheck、unit、contract、integration、build；无 P0/P1。          |

## 路由记录

- Repo 探查、依赖审计：Codex 子 Agent；适合跨目录只读检索并返回 `file:line`。
- 长文档范围一致性：Kimi；用于中英文范围和依赖口径复核，Codex controller 最终裁决。
- 实现：Codex controller；写权限限定为 `src/modules/platforms/**`、平台 tests/fakes/fixtures 与本迭代文档，避免多个 Agent 修改相同文件。
- 独立代码审核：Claude Code；只读检查 correctness/security/regression，失败时回退独立 Codex Review Agent。
- QA：独立 Codex Agent；只读核对验收矩阵和命令证据，主线程负责最终执行全量门禁。
