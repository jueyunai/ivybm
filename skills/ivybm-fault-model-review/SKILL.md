---
name: ivybm-fault-model-review
description: Review IVYBM pull requests that change asynchronous Jobs/workers, AI gateway or RAG vector retrieval, Payload Collections, PostgreSQL migrations, Docker Compose, or production release steps. Use to perform fault-model reviews with crash, lease, retry, identity-drift, upgrade, and rollback paths before recommending approval.
---

# IVYBM 故障模型审查

以状态机和失败时序审查 IVYBM 的高风险 PR。不要把 CI 全绿、类型通过或 happy-path 测试当成可合并结论。

## 开始前

1. 完整阅读 `AGENTS.md`、`CONTRIBUTING.md` 和对应 Task 计划；若使用 Claude Code，再阅读 `CLAUDE.md`。
2. 获取 PR 的 base、最新 head、合并状态、作者、已有 review、CI run 和完整 diff；不得根据旧 commit、旧评论或他人的摘要下结论。
3. 若 PR 已合并，明确标为“post-merge audit”，不要称为 Approval，也不要把合并后的检查伪装成合并前独立 review。
4. 审查默认只读。不要提交、push、批准、Request changes、合并或修改代码，除非用户明确授权。
5. 记录测试环境、PostgreSQL / pgvector 版本、是否使用 fake provider，以及哪些命令实际运行过。

## 证据纪律与问题分级

把外部 review、子代理结论、CI 报告都当作**线索**，而不是事实。逐条在当前 head 的 `file:line`、调用链和测试中复核；修复提交后的旧结论默认失效。

在提出问题前，标明它属于哪一类：

| 类别 | 结论要求 |
| --- | --- |
| 代码缺陷 | 给出当前 head 可发生的失败序列和被违反的不变量。 |
| 测试缺口 | 明确现有实现为何仍安全，或说明缺口对应的未证明风险；不要把“未测”直接写成 P1。 |
| 运维风险 | 区分 Compose / 发布顺序回归与 staging、production、真实账号或真实模型演练。 |
| 流程违规 | 单独报告缺失独立 review、越权合并或错误基线；不得把它伪装成代码 defect。 |

完整追踪复合防线后再定级。不要只因一个时间戳、一个 cleanup SQL 或一个内存 limiter 就下结论；确认状态、revision、owner、lease、权限和检索过滤是否共同阻止该失败序列。可重建的派生 chunk 在 `failed` 时 fail closed，不自动等同于源资料数据丢失。

## 三层审查流程

1. **规范与契约对照：** 将 diff 对照 Task、ADR、Collection access、公开接口、migration 历史和发布职责；确认共享结构需要另一位开发者 review。
2. **状态机 / migration 语义：** 先写可证伪不变量，再沿持久化状态和异常时序推演；不要只读单个函数。
3. **隔离复现：** 在 detached worktree 和 disposable PostgreSQL / pgvector 库运行最小失败注入、fresh migrate、down/up、seed 和 Task 定向测试。保留实际命令与退出码；不污染主工作树或真实数据。

## 先写不变量，再读实现

为每个变化领域写出可证伪的不变量。无法给出不变量时，不能给出 merge-ready 结论。

| 领域 | 必须成立的不变量 |
| --- | --- |
| Job / worker | 每个 processing 资源都有精确 owner 和未过期 lease，或者可收敛为 `ready`、`failed` 或可重新 claim。 |
| 文档 / chunk | 旧 worker、旧 revision、失效 lease 和 dead-letter 恢复后都不能写入、删除或完成新的索引结果。 |
| 幂等 | 同一业务事实重复执行不会重复创建副作用；配置或内容身份改变时能创建正确 replacement Job。 |
| 向量身份 | endpoint、协议、模型、dimensions、写入 metadata、查询过滤、Job key 和重建策略使用同一兼容性身份。 |
| Gateway | provider 成功后 telemetry 失败不能伪装为 provider 失败或触发模型重复计费。 |
| migration | 迁移、Payload schema snapshot、`payload.config.ts`、生成类型和实际数据库 schema 一致；升级和回滚不破坏旧应用可读数据。 |
| 发布 | 旧 worker 不会跨越 ownership/schema migration 写入；失败后的服务状态和人工恢复动作明确。 |

## 失败时序审查

为每个异步操作沿时间线推演，而不是只读函数局部。

```text
claim → 写 processing / owner → 外部调用 → 持久化副作用 → finalise → Job complete
```

在每个箭头之间至少检查以下情形：

- worker 被 `SIGKILL`，不会执行 `catch` 或 `finally`；
- lease 到期，另一个 worker 重新 claim；
- 旧 owner 在失租后恢复并返回；
- 最终 attempt 到期进入 `dead`；
- 文档、审核状态、配置或向量身份在执行期间改变；
- 副作用已提交，但 Job complete / telemetry / audit 尚未提交；
- 清理、retry、manual re-arm 与新 owner 并发执行。

确认每一项都由数据库条件、事务或 outbox/fence 保护。仅靠内存 flag、`AbortSignal` 或“正常情况下 finally 会运行”不构成持久化保证。

### 必须要求的故障注入测试

使用 fake provider、fixture、受控时钟或真实测试数据库；不得调用付费 AI API。

- 成功、普通失败、可重试失败、最终失败、admin manual retry；
- 旧 owner 存活但失租；
- **旧 owner 直接死亡且不 cleanup**，新 owner / sweeper 仍能恢复；
- zombie handler 恢复后不能修改 document、chunk、Job 或审计状态；
- 多并发 claim / handoff / enqueue 只产生一个权威结果；
- 失败清理不会删除新 owner 写入的数据；
- 测试顺序改变、干净数据库重置后仍稳定，测试 fixture 不遗留 pending Job、锁或身份数据。

不要接受“测试主动让旧 worker 返回并清理”作为进程死亡恢复的证据。

优先用真实数据库 owner / lease / fence 条件模拟“进程死亡且不 cleanup”。若没有 literal `SIGKILL` 子进程测试，明确写为测试边界；只有在持久化效果没有被等价故障注入覆盖时，才将其升级为阻塞缺陷。

## 向量与模型身份审查

从配置入口一直追到检索 SQL，逐项确认：

```text
route/profile/provider endpoint
  → configured model + dimensions
  → provider returned model + vector dimensions
  → embeddingSpace
  → chunk metadata
  → retrieval filter
  → idempotency / rebuild key
```

- endpoint、模型或 dimensions 任一不兼容时，必须 fail closed 或排入受控重建；不得猜测 provider 名称作为稳定空间身份。
- 覆盖配置变更、endpoint 变更、provider 返回 model/dimensions 漂移、NULL legacy space 和非空 stale space。
- 确认 reviewed / customer visibility / locale / source citation 仍在正式回答路径上受限。
- 检查一次 embedding 的 batch 内和多 batch 间模型、维度、空间均保持一致。

## Migration 与发布审查

涉及 Payload Collection、`src/payload.config.ts`、migration 或生成类型时，逐项检查：

1. 只基于最新 `origin/main` 的 migration 历史；绝不改已合并 migration。
2. 新 migration 有匹配、有效的 Payload `.json` schema snapshot；`src/migrations/index.ts` 已注册；`payload-types.ts` 已重新生成。
3. 在隔离数据库完成 fresh up、完整 down/up、升级既有数据和两次幂等 seed。
4. 在隔离 worktree / disposable state 运行 migration generation，确认不会重新生成已存在 DDL。不要在有未提交改动的工作树直接生成 migration。
5. 检查前向兼容：旧镜像读取扩展后的 schema 是否仍安全；未备份阶段不得用状态批量重写替代受控重建。
6. 检查 migration 前停止旧 worker，migration 成功后才启动新 worker；写明 migration 失败时保持何种状态、如何人工恢复或回退。

把 snapshot 文件存在本身视为必要但不充分证据：还要验证内容含新表、enum、relation 和生成器所需的完整 schema 基线。

## CI 与证据判定

- 区分“CI 覆盖”与“本地专项测试覆盖”。CI 通过不能替代缺失的失败模型测试。
- 若本机 PostgreSQL 版本不符合项目基线，明确它不能充当最终 integration 门禁；以 CI 或同版本隔离库补齐。
- 审查 CI 定义，确认 contract、integration、operations、migration、seed、build 与相关 E2E 确实在最新 head 执行。
- 只引用亲自运行或可追溯到最新 commit 的日志、测试和 CI run。
- 将 `migrate:create` 无 drift、Compose / 发布顺序测试归为配置证据；除非实际执行过，不得称为 staging 或 production 演练。

## 输出审查结论

每个可行动问题使用以下格式：

```text
[P1] 简短标题
file:line
失败序列：A → B → C
影响：违反的具体不变量
证据：代码路径和缺失/失效测试
最小修复：实现方向与必需回归测试
```

- P0/P1 必须阻止合并。
- P2 说明是否阻塞、为什么不阻塞、应如何跟进。
- 没有发现问题时，明确审查范围、base / 最新 head、已验证的失败模型、实际命令、残余测试与运营风险；不要以“CI 绿”作为唯一理由。
- 独立审查工具不可用时，标记为自审，不得声称已获得独立批准。
- 缺少所需跨人 review 时，即使代码没有 P1，也不得建议合并；单独说明谁需要给出独立 review，不能由作者自批。
