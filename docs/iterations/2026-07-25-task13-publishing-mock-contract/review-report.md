# Task 13 发布 Mock 契约加固：审查报告

## 初始发现

### P1：accepted 与 status 无法闭环

`PlatformPublishingPort.getStatus()` 需要 `externalPublicationId`，而 `PlatformPublishAcceptance` 的 accepted 分支此前不返回该值；原 contract test 还硬编码了另一个不相关的 ID。若以后 provider 接受请求但状态回调延迟，调用方没有明确可持久化、可重查的关联句柄。

处置：accepted 和 status 统一为必填的 adapter-issued `externalPublicationId`，并由 mock 契约测试验证贯通。

## 独立审查与残余风险

独立 fault-model 代码审查与 QA 均未发现 P0/P1。QA 实际运行了 publishing contract 与 typecheck；最终隔离数据库质量门禁见 `test-notes.md`。

以下为不阻塞、且不得误报为已覆盖的 P2 / 后续测试边界：

- 当前 fake 的 `getStatus()` 只验证 accepted 句柄被正确传递和回显，尚未定义未知句柄或 platform 不匹配的 provider 语义。
- request fingerprint 使用 `JSON.stringify`；素材顺序可能有发布语义，若未来要把语义等价的对象字段顺序视为同一命令，应在真实 adapter 阶段明确 canonicalization。
- mock 的内存 map 不证明数据库级并发幂等、provider 接受后进程死亡、lease reclaim、状态回调或人工重试；这些必须等待 Task 12 / Task 10 / 真实平台条件后以故障注入覆盖。

本变更是跨人公共 publishing contract，仍需 jueyunai 独立 review 后才能合并。
