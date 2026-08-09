# Task 11 飞书通知与重连修复：技术设计

## 数据流

### 高意向事件

`Leads.afterChange` 继续用业务字段 hash 作为 `entityRevision`，用于远端 upsert 的 stale fence。每个
首次出现的内容 revision 仍占用 canonical idempotency key，供 relay 判重；当 Lead 真正变更并回到一个
历史 revision 时，Job key 追加由前后 revision / 更新时间计算的 change-event hash。通知意图另带稳定的
notification-event hash，pending 通知被后续 revision 携带时沿用同一事件身份。这样 A → B → A 会重新
同步并再次通知；该 identity 同时进入飞书消息发送的 provider idempotency key，因此新事件不会被飞书
误判为历史请求，而同一 Job 重试仍保持同一发送身份。内容不变的保存和同一 pending 通知不会重复投递。

Lead after-change 与 Job insert 同属一个 PostgreSQL 事务，是业务变更事件的权威入口；30 秒 relay 只用
canonical key 补齐历史 Lead / 当前快照，不尝试从最终状态反推已经丢失的中间业务事件。

### QR 重连

`finalizeProvisioning` 在同一连接锁事务中激活 mapping。若连接为 `qr_registered`，mapping update/create
显式写入 `memberMappings: []`，同时把默认通知收件人更新为当前安装管理员；`store_oauth` 不写该字段，
继续保留已有映射。

## 契约与兼容

| 表面                          | 变化                                             | 兼容性                                                      |
| ----------------------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| Lead sync Job idempotency key | 历史 revision 被再次访问时增加 change-event hash | canonical key 与旧 Job 兼容；payload 只新增可选通知事件字段 |
| Feishu mapping provisioning   | QR 模式清空 app-scoped member mapping            | 无 schema/migration；store OAuth 保持原行为                 |
| Portal/API                    | 无请求响应变化                                   | 完全兼容                                                    |

## 失败模式

| 失败                          | 处理                                                   | 验证      |
| ----------------------------- | ------------------------------------------------------ | --------- |
| 同一内容多次普通保存          | 内容未变时继续命中 canonical key                       | EVT-03    |
| 高意向事件回到历史内容        | change-event hash 形成新 key，同时保留内容 stale fence | EVT-02    |
| QR 重连旧销售身份             | 激活 mapping 前清空，通知回退新安装管理员              | REC-01/02 |
| store OAuth 重新 provisioning | 不写 memberMappings                                    | REC-03    |
| 旧 Job / dead retry           | mapping revision 与 entity revision fence 不变         | REC-04    |

## 可观测性

- 继续使用 Job type、status、attempts、manualRetryCount 和脱敏 `lastError`。
- 不记录 `open_id`、Token、Secret、OAuth state 或 provider 正文。
- 回归测试直接断言 Job 数量、intent、idempotency key 差异和收件人数组状态。

## 发布与回滚

- 无 migration、环境变量或生产开关变化。
- 回滚为恢复旧 Job key 与 mapping partial update；生产仍保持 QR 开关和部署审批边界不变。

## 预计修改

- `src/modules/feishu/jobs.ts`
- `src/modules/feishu/notify.ts`
- `src/modules/feishu/provisioning.ts`
- `tests/contract/feishu.test.ts`
- `tests/integration/feishu-sync.test.ts`
- `tests/integration/feishu-routes.test.ts`
- Task 11 运行手册、开发进度、Bug 案例库与本迭代记录
