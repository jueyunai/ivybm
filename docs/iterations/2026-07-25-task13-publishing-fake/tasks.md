# Task 13 可复用发布 Fake：任务拆分

| 任务 | Owner | Reviewer | 状态 | 验收 |
| --- | --- | --- | --- | --- |
| 范围 / 依赖盘点 | Codex controller + 只读子代理 | 架构子代理 | completed | 证明无账号安全范围与阻塞项。 |
| 架构裁决 | Claude（未产出）→独立子代理 | Codex controller | completed | 选择可复用内存 fake，不伪造 TikTok 或 DB。 |
| TDD fake 实现 | Codex controller | 独立 code review | completed | 单元 / contract 覆盖状态、失败、幂等与失败队列。 |
| 质量门禁 | Codex controller | 独立 QA | completed | lint、typecheck、unit、contract、migration/reset/seed、integration、operations、Compose persistence、build。 |

## 工具路由

- Codex controller：仓库状态、实现、测试与最终集成。
- Claude Code：架构裁决；本轮 CLI 无可用流式结果，未作为结论依据。
- Codex 子代理：范围、依赖、分支与故障模型只读核对；主线程复核关键源码并补齐回归测试。
