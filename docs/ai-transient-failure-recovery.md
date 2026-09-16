# AI 客服临时故障恢复设计

## 来源与目标

| 来源                | 事实                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| 2026-09-16 生产截图 | 官网访客发送“你好”后，一次 AI 异常就显示“已分享给项目团队”并进入待接管。                             |
| 生产会话 #32        | handoff reason 为 `ai_service_unavailable`；同时配置、Provider、RAG 探针正常，后续新会话可正常回复。 |
| 现有代码            | `replyOrHandoff` 捕获所有 responder 异常并立即返回 `ai_service_unavailable` handoff。                |

目标：技术性 AI/知识检索异常不再改变会话业务状态；网站访客获得可重试错误，使用同一幂等键在原会话重试，成功时只持久化一条访客消息和一条 AI 回复。

## 产品规则

- 临时技术异常（Provider 超时/限流/网络、AI 配置读取、向量检索异常）：保持 `ai_active`，返回 `503 ai_unavailable` 且 `retryable=true`。
- 高风险问题、三轮资格信息仍不完整、已审核客户知识无匹配：属于业务策略，仍立即转人工。
- 访客或运营人员主动转人工：保持现有权威状态机。
- 技术故障永不按任意次数偷偷改成人工接管；访客可显式点“转人工”，运营人员可根据可观测日志介入。

## 技术流程

```text
send message + stable idempotency key
  -> responder / retrieval
  -> success: transactionally persist visitor + AI reply
  -> technical error: fail command, persist no message/state change, HTTP 503 retryable
  -> browser Retry: reclaim same failed command key and rerun
  -> policy handoff: transactionally persist visitor + handoff event/status
```

## 可观测性

生产日志只记录：事件名、会话 ID/request ID、渠道、内部错误类别、是否可重试。不记录访客正文、Prompt、知识片段、API Key 或 provider 响应体。

## 测试与验收

| ID        | 场景                        | 预期                                                                             | 证据                                       |
| --------- | --------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| AI-REC-01 | 首次 responder 抛出临时异常 | 503 + `ai_unavailable` + `retryable=true`；会话仍 `ai_active`，0 消息，0 handoff | service unit + PostgreSQL HTTP integration |
| AI-REC-02 | 同幂等键重试成功            | 仅一条 visitor + 一条 AI，无 handoff                                             | service unit                               |
| AI-REC-03 | 丢失成功响应后重试          | 返回已完成结果，不重复生成/写入                                                  | 现有 ChatWidget/idempotency regression     |
| AI-REC-04 | 高风险、无知识、三轮未完成  | 继续权威转人工                                                                   | existing service/responder tests           |
| AI-REC-05 | 生产技术异常                | 日志可用 conversation/request ID 定位错误类别，不含敏感正文                      | unit log assertion + production smoke      |

## 范围、部署与回滚

- 无 Collection/migration/公开 API schema 变更；复用现有 `ChatServiceError` 与 ChatWidget Retry。
- 不修改知识阈值、Prompt、模型参数、人工接管状态机或社媒出站投递。
- 部署后用新网站会话做一次正常回复 smoke；不重放历史访客消息。
- 回滚为回退本提交并重新部署；无数据回滚。
