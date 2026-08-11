# 经典 Bug 案例库

## P-PROVIDER-ENUMERATION-GAP 提供方列表接口遗漏已授权资源

- Category: observability, test-gap, product-acceptance
- Applies to: OAuth 资产绑定、第三方资源发现、已知外部 ID 的身份校验
- Example cases: META-001

### Invariant

用户明确授权且系统已预登记外部资源 ID 时，身份校验必须能对该精确资源执行提供方权威查询；列表接口
未返回资源不能单独证明资源未授权，但任何 fallback 都必须继续校验精确 ID 和资源 Token，不能放宽身份边界。

### Failure Mechanism

实现把 `/me/accounts` 等枚举接口当成唯一身份来源。提供方在 Business Portfolio、新资产授权模型或接口版本
差异下漏返回已勾选资源时，系统把“列表遗漏”误判为身份不匹配；纯 fixture 只覆盖列表成功路径，真实授权
直到 production 联调才失败。

### Early Signals

- OAuth 授权页明确显示目标资源已勾选，但枚举接口返回空数组。
- 目标外部 ID 已由提供方资产设置确认，用户也具有完全访问权限。
- 身份解析只有列表查找，没有精确资源查询或安全的提供方响应阶段日志。

### Prevention Gate

OAuth adapter 必须分别测试枚举成功、枚举遗漏后精确查询成功、精确查询错误、返回 ID 不一致和 Token 缺失；
fallback 只允许请求预登记 ID，继续携带 `appsecret_proof`，并只记录有界错误码、阶段和非敏感资源 ID。

### Verification

模拟 `/me/accounts` 返回空数组，随后 `/{page-id}?fields=id,name,access_token,tasks` 返回同一 Page：绑定成功；
若 direct 响应为其他 ID、无 Token 或提供方拒绝，则 fail closed 且日志不含授权码、用户 Token、Page Token
或 App Secret。

### Reuse Prompt

“这个第三方枚举接口是否可能漏掉已授权资源？系统能否用预登记 ID 做精确、仍然 fail-closed 的权威校验？”

## META-001 已勾选 Facebook Page 仍被判定 identity mismatch

- Category: observability, test-gap, product-acceptance
- Pattern: P-PROVIDER-ENUMERATION-GAP
- Date: 2026-08-11
- Area: Task 13 Meta OAuth / Facebook Page Token 解析
- Environment: production 受控 Facebook Page 与 Meta Login for Business
- Severity: P0

### Symptom

Meta 授权页明确勾选 Page `129472283584550`，账号拥有完全访问权限且三个必需 scope 已授予，但回调仍
返回 `metaOAuth=identity_mismatch`，平台账号保持 `not_started`。

### Context

App ID / Secret、回调域名、Login Configuration、Page ID 和 Webhook allowlist 均已验证；更换同权限的
User Access Token 配置后结果不变。Graph API Explorer 与真实回调均显示 `/me/accounts` 没有目标 Page。

### Root Cause

Technical cause: `resolveMetaAuthorizedAccount` 只读取 `/me/accounts` 并在目标 Page 缺失时立即失败，没有使用
Meta 支持的精确 `/{page-id}` Page Access Token 查询作为受限 fallback。

Process cause: 既有测试只模拟 `/me/accounts` 返回目标 Page；没有使用 Business Portfolio 真实资产验证列表
遗漏，也没有要求失败日志记录安全的解析阶段和提供方错误码。

### Why Existing Checks Missed It

fixture 证明了理想 Graph 响应契约，却没有覆盖 Meta 真实资产发现差异；production smoke 只检查站点健康，
无法代替受控账号 OAuth 产品验收。

### Fix

保留权限校验和 `/me/accounts` 首选路径；目标缺失时仅针对预登记 Page ID 调用
`/{page-id}?fields=id,name,access_token,tasks`，携带 HMAC `appsecret_proof`，只在返回 ID 精确一致且 Page
Token 合法时绑定。回调增加有界结构化诊断，不记录任何凭据或原始提供方正文。

### Prevention Checklist

- [ ] 真实平台联调覆盖“授权页已选中、枚举接口为空”的路径。
- [ ] 精确 fallback 只能使用预登记资源 ID，并校验返回 ID 与 Token。
- [ ] 提供方拒绝、错误 ID、缺 Token 全部 fail closed。
- [ ] OAuth 失败日志只记录阶段、状态码、错误码和非敏感资源 ID。

### Regression Test

`tests/unit/platforms/meta-oauth.test.ts`：`resolves the exact configured Page when Meta omits it from /me/accounts`；
`tests/unit/platforms/meta-oauth-routes.test.ts`：`logs safe diagnostics when Meta rejects the exact Page lookup fallback`。

### Related Workflow Gates

- MVP Scope Freeze 5.2、5.3；Task 13 外部平台联调阶段

## P-PROVIDER-RESPONSE-SHAPE 提供方多阶段响应被错误共用同一 schema

- Category: observability, test-gap, product-acceptance
- Applies to: OAuth 授权码交换、短期 / 长期 Token 转换、第三方多阶段 API
- Example cases: META-002

### Invariant

第三方多阶段流程必须分别按每个阶段的官方契约校验响应；后续阶段需要的字段不能反向变成前一阶段的
必填字段。任何响应拒绝都要记录阶段、HTTP 状态和有界字段名，不能记录 Token 或原始正文。

### Failure Mechanism

实现为了复用解析器，把短 Token 与长 Token 响应都套用同一严格 schema。提供方在授权码交换阶段只返回
`access_token`，而在长效转换阶段才返回 `expires_in` 时，合法短 Token 会在第二次请求前被本地拒绝。

### Early Signals

- 同一解析函数被授权码交换和长效 Token 交换共同调用。
- production 只有 `token_response_invalid`，无法判断失败发生在哪个阶段。
- fixture 为每个阶段复制了完全相同的字段，即使官方示例并不保证相同 schema。

### Prevention Gate

为每个 provider stage 建立最小独立解析器；短 Token 只验证下一阶段实际需要的凭据，长 Token 再严格验证
有效期。测试必须覆盖字段缺省、数字字符串、非法期限和安全诊断。

### Verification

短 Token 响应只有 `access_token` / `token_type`，长 Token 的 `expires_in` 为十进制字符串：交换成功；长
Token 缺少或包含非法期限时 fail closed，日志仅含 `token_exchange_long` 和安全字段名。

### Reuse Prompt

“这个多阶段第三方流程是否错误复用了同一响应 schema？每个阶段真正需要哪些字段？”

## META-002 Facebook 授权资产已选中但 Token 交换被本地拒绝

- Category: observability, test-gap, product-acceptance
- Pattern: P-PROVIDER-RESPONSE-SHAPE
- Date: 2026-08-11
- Area: Task 13 Meta OAuth / Facebook Login for Business
- Environment: production 受控 Facebook Page
- Severity: P0

### Symptom

Meta 授权页已显示正确 Business Portfolio 和 Page，Graph API Explorer 也能从 `/me/accounts` 返回目标 Page，
但 IVYBM 回调仍显示 `metaOAuth=token_exchange_failed`。

### Root Cause

Technical cause: 授权码交换的短 Token 响应未包含 `expires_in`，`readTokenPayload` 却要求短、长两阶段都必须
返回数值型期限，因而在长效转换请求前抛出 `token_response_invalid`。

Process cause: 所有 Meta fixture 都人为给短 Token 加了数值型 `expires_in`，且失败日志没有 Token 阶段和安全
响应字段，production 联调前无法发现契约假设。

### Why Existing Checks Missed It

测试验证了理想化的同构响应，而不是两个独立 provider stage；站点 smoke 不执行真实 OAuth 授权码交换。

### Fix

短 Token 仅校验有界 `access_token`；长 Token 独立校验正整数期限并兼容十进制字符串。Token 请求和解析失败
记录 `token_exchange_short` / `token_exchange_long`、状态码和白名单字段名，不记录凭据或正文；同时把真实
Page 查询必需的 `pages_read_engagement` 纳入服务端权限门禁。

### Prevention Checklist

- [ ] OAuth 每个交换阶段使用独立最小 schema。
- [ ] fixture 覆盖短响应无期限、长期限为数字字符串。
- [ ] 非法长期限 fail closed，诊断不含授权码、Token 或 App Secret。
- [ ] 真实平台权限必须同时由 Login Configuration 和服务端门禁校验。

### Regression Test

`tests/unit/platforms/meta-oauth.test.ts` 覆盖短响应无期限、长期限数字字符串和非法长期限；
`tests/unit/platforms/meta-oauth-routes.test.ts` 覆盖真实响应形态完成回调并保存 Page Token。

### Related Workflow Gates

- MVP Scope Freeze 5.2、5.3；Task 13 外部平台联调阶段

## P-EVENT-REVISION-FENCE 内容状态与事件身份混用

- Category: state-management, concurrency, test-gap
- Applies to: 内容同步、状态跃迁通知、outbox / Job 幂等
- Example cases: FEISHU-001

### Invariant

内容 revision 用于判断“当前数据是否仍可写入”，事件 identity 用于判断“这次业务事件是否已经投递”；
两者不能用同一个可回退的内容 hash 表示。

### Failure Mechanism

状态机回到历史内容时会产生相同 hash。若 Job 唯一键只包含内容 hash，新发生的同步与通知会被历史 Job
吞掉；若所有重放都改用随机 key，又会破坏重复执行幂等。

### Early Signals

- 状态允许 A → B → A、启用 → 停用 → 启用等循环。
- Job key 只包含实体 ID 和当前字段 hash。
- 测试只覆盖单向状态变化，没有覆盖回到历史状态。

### Prevention Gate

技术设计同时声明 content fence 与 event identity；测试矩阵必须包含状态循环、内容不变重放和 pending
事件跨 revision 携带。

### Verification

创建 B Lead，执行 B → A → B → A：两个 A 的内容 revision 相同，change-event / notification-event identity
不同，高意向消息恰好发送两次；内容不变保存不新增 Job。

### Reuse Prompt

“这个状态能否回到历史值？如果能，当前幂等键区分内容快照和新业务事件吗？”

## FEISHU-001 历史内容 revision 吞掉新的高意向事件

- Category: state-management, concurrency, test-gap
- Pattern: P-EVENT-REVISION-FENCE
- Date: 2026-08-09
- Area: Task 11 Lead sync / high-intent notification
- Environment: 本地隔离 PostgreSQL + 受控免费飞书租户
- Severity: P1

### Symptom

Lead 从 A 降为 B 后再次升为 A，Portal 已保存 A，但没有新的 `feishu.lead.sync` Job 和高意向通知。

### Context

同步 Job 使用 Lead 业务字段 hash 作为 entity revision 和唯一键；旧 A Job 已经 succeeded。

### Root Cause

Technical cause: A → B → A 的第二个 A 与第一个 A hash 相同，`ON CONFLICT DO NOTHING` 把新事件视为重放。

Process cause: 既有测试覆盖首次高意向和历史回填，但未覆盖状态循环回到历史内容。

### Why Existing Checks Missed It

测试只验证 predicate 与单向 revision，不验证同一内容在不同事件时刻再次出现。

### Fix

保留内容 hash 作为 stale fence；首次 revision 使用 canonical key，历史 revision 的真实变更追加稳定
change-event key；通知另带可携带的 notification-event identity，并把它纳入飞书 provider idempotency key。

### Prevention Checklist

- [ ] 所有可循环状态至少覆盖一次回到历史值。
- [ ] 明确 content revision、change event 和 notification event 三种身份。
- [ ] 内容不变重放与 pending 事件携带都验证恰好一次。

### Regression Test

`tests/integration/feishu-sync.test.ts`：`delivers a new high-intent event when a lead returns to a prior content revision`。

### Related Workflow Gates

- product-development-workflow Gate 3、Gate 4、Gate 6

## P-IDENTITY-RECONNECT-FENCE 外部身份跨连接代际复用

- Category: state-management, observability, product-acceptance
- Applies to: OAuth 重连、应用重建、租户 / 应用作用域用户标识
- Example cases: FEISHU-002

### Invariant

外部身份标识只能在签发它的租户与应用代际内使用；连接切换到新应用前，旧作用域映射必须被清理、
禁用或重新解析。

### Failure Mechanism

连接记录和 mapping 被复用，但应用已重新创建。partial update 刷新默认安装人却保留旧成员数组，通知
优先命中旧 `open_id`，自动重试和失败通知都会在同一错误映射上继续失败。

### Early Signals

- 重连会创建新应用或更换 OAuth client。
- 外部用户 ID 被长期保存在 mapping 中。
- provisioning 使用 partial update，未显式声明旧数组字段的代际策略。

### Prevention Gate

技术设计为每个外部身份字段标注 scope；重连验收必须包含旧 mapping、分配销售 Lead 和真实通知，不能
只检查 `connected` / `active` 状态。

### Verification

旧 QR 应用 mapping 含销售成员，断开后以新 QR 应用重连：mapping 激活时成员数组为空、默认 recipient
为新安装管理员；store OAuth provisioning 后成员数组保持不变。

### Reuse Prompt

“重连是否更换了外部应用身份？所有持久化 user/chat/account ID 的 scope 是否仍然有效？”

## FEISHU-002 QR 重连保留旧应用销售 open_id

- Category: state-management, observability, product-acceptance
- Pattern: P-IDENTITY-RECONNECT-FENCE
- Date: 2026-08-09
- Area: Task 11 QR provisioning / sales notification mapping
- Environment: 本地隔离 PostgreSQL + 受控免费飞书租户
- Severity: P1

### Symptom

断开并扫码重连后页面显示 connected、mapping 显示 active，但新 Lead 通知重试 5 次后 dead，脱敏错误为
`open_id cross app`；失败通知也被旧销售映射阻塞。

### Context

QR 重连创建新租户应用；默认 recipient 已刷新，销售 `memberMappings` 仍来自旧应用。

### Root Cause

Technical cause: `finalizeProvisioning` partial update 未写 `memberMappings`，Payload 保留旧数组；发送逻辑
优先使用 assigned user mapping。

Process cause: 既有断开 / 重连验收只验证凭据、状态、Base 和 mapping 激活，未用已配置销售映射执行通知。

### Why Existing Checks Missed It

测试没有在 QR 重连前植入旧应用 member mapping，也没有区分 QR 新应用与 store OAuth 同应用语义。

### Fix

仅在 `qr_registered` provisioning 激活 mapping 时显式清空成员映射，并刷新默认安装管理员；
`store_oauth` 不写该字段，保持兼容。重连后管理员重新维护销售映射。

### Prevention Checklist

- [ ] 为所有外部 ID 标注 tenant/app/account scope。
- [ ] 新 OAuth client 激活前清理旧 scope mapping。
- [ ] 重连 smoke 使用已分配销售的合成 Lead，而非只看状态。
- [ ] 失败通知不能再次优先命中已知失效身份。

### Regression Test

`tests/integration/feishu-routes.test.ts`：`clears QR app member mappings on reconnect while preserving store OAuth mappings`。

### Related Workflow Gates

- product-development-workflow Gate 1、Gate 3、Gate 4、Gate 7、Gate 8
