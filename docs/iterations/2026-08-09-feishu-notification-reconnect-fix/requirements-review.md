# Task 11 飞书通知与重连修复：需求复核

## 来源

| 来源                   | 日期                    | 约束                                                                               |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| 受控免费租户本地验收   | 2026-08-09              | A → B → A 回到历史内容时仍是新的高意向事件；QR 重连后旧应用 `open_id` 不得继续投递 |
| Task 11 OAuth 技术方案 | 2026-07-30 / 2026-08-05 | 历史回填不通知、同步幂等、QR 应用凭据隔离、断开后映射停用                          |
| 飞书 CRM 运行手册      | 2026-08-05              | 重试与失败补偿必须脱敏；重连后连接和映射必须可恢复                                 |

## 目标

1. 同一 Lead 每一次真实的非高意向 → 高意向跃迁都产生一次新的 `high_intent` 通知，即使业务字段回到曾经同步过的历史内容。
2. QR 重连创建新租户应用时，旧应用作用域的销售成员 `open_id` 不再随 mapping 重新激活。
3. 保持历史 relay 无通知、内容同步幂等、store OAuth 兼容和 dead/manual retry 语义不变。

## 非目标

- 不修改 `Leads`、`FeishuMappings` 或 `Jobs` Collection 结构，不新增 migration。
- 不新增飞书通讯录自动解析或销售映射 UI。
- 不删除客户租户中的旧应用、Base 或历史记录。
- 不启用或部署 production。

## 验收标准

| ID     | 标准                                                                | 证据                        |
| ------ | ------------------------------------------------------------------- | --------------------------- |
| EVT-01 | B → A 的首次跃迁产生一个 `high_intent` Job                          | PostgreSQL integration test |
| EVT-02 | A → B → A 回到历史 A 内容时产生新的 Job / provider key，且高意向消息累计发送两次 | PostgreSQL integration test |
| EVT-03 | 无通知意图的相同业务 revision 仍由原幂等键去重                      | integration assertion       |
| EVT-04 | 历史 relay 继续 `notificationIntent=none` 且不发消息                | existing regression test    |
| REC-01 | `qr_registered` provisioning 激活 mapping 前清空旧 `memberMappings` | PostgreSQL integration test |
| REC-02 | 重连默认通知收件人使用新安装管理员身份                              | PostgreSQL integration test |
| REC-03 | `store_oauth` provisioning 不清空已有销售成员映射                   | PostgreSQL integration test |
| REC-04 | 旧 mapping revision Job 继续安全 no-op，人工补偿契约不变            | existing integration tests  |

## 风险与假设

- Payload `updatedAt` 是同一次 after-change hook 可稳定复用的事件标记；只用于有通知意图的 Job key，不改变内容 revision。
- QR 注册每次创建新应用，`open_id` 视为应用作用域身份；清空比静默复用更安全，未配置销售映射时回退到新安装管理员。
- store OAuth 复用统一应用身份，必须保留原成员映射。
