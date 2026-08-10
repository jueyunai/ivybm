# Task 11 飞书通知与重连修复：测试用例

| ID     | Setup                                        | Steps                            | Expected                                                                      | Evidence                           |
| ------ | -------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| EVT-01 | active mapping；Lead 初始 B                  | 更新到 A 并执行 Job              | 1 个 high_intent；发送 1 次高意向消息                                         | `feishu-sync.test.ts`              |
| EVT-02 | EVT-01 Job 已完成                            | A → B → A，并完成中间 Job        | 第二次 A 的业务 revision 与首次相同，但 Job / provider key 不同；累计发送 2 次高意向消息 | `feishu-sync.test.ts`              |
| EVT-03 | 已存在相同内容 revision Job                  | 重复保存相同业务内容             | 不新增普通同步 Job                                                            | `feishu-sync.test.ts`              |
| EVT-04 | 历史高意向 Lead 首次 relay                   | 执行 backfill Job                | upsert 1 次，sendText 0 次                                                    | 既有 historical backfill case      |
| REC-01 | disconnected QR connection；旧 member openId | 新应用 OAuth 后执行 provisioning | mapping active 且 memberMappings 为空                                         | `feishu-routes.test.ts`            |
| REC-02 | REC-01                                       | 读取 mapping                     | 唯一默认 recipient 等于新 installer identity                                  | `feishu-routes.test.ts`            |
| REC-03 | store OAuth connection；已有 member mapping  | provisioning resume              | member mapping 保留                                                           | `feishu-routes.test.ts`            |
| RES-01 | retryable 429 / dead Job                     | 执行现有定向门禁                 | 退避、dead、管理员 retry 与脱敏失败通知通过                                   | existing contract/integration/unit |

## 门禁命令

```bash
pnpm vitest run --config ./vitest.integration.config.mts tests/integration/feishu-sync.test.ts tests/integration/feishu-routes.test.ts
pnpm vitest run --config ./vitest.contract.config.mts tests/contract/feishu.test.ts
pnpm vitest run --config ./vitest.config.mts tests/unit/jobs/retry.test.ts tests/unit/feishu-oauth.test.ts tests/unit/feishu-app-registration.test.ts
pnpm typecheck
pnpm lint
```

UI/API 合约未变，本修复无需新增视觉验收；产品验收以受控租户断开 → 重连 → 合成 Lead 同步通知为准。
