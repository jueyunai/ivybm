# Task 11 飞书通知与重连修复：验收报告

## 结论

本地修复验收通过。Lead 回到历史内容 revision 时会再次同步，并对新的非高意向 → 高意向跃迁发送
新的通知；QR 重连创建新应用时会清空旧应用作用域的销售成员映射，默认通知回退到本次安装管理员。
`store_oauth` 继续保留既有销售映射。

本轮未修改 Collection、migration、Portal/API、环境变量或 production 配置，未部署 production，测试
仅使用合成数据与隔离数据库。

## 验收结果

| 范围 | 结果 | 证据 |
| ---- | ---- | ---- |
| A → B → A 历史 revision | 通过 | 两个 A 的 `entityRevision` 相同，Job key、notification event identity 与飞书 provider key 均不同，高意向消息累计 2 次 |
| 内容不变保存 | 通过 | 不新增同步 Job |
| pending 通知跨 revision | 通过 | 沿用同一 notification event identity，旧 Job no-op，最新 Job 仅通知 1 次 |
| QR 应用重连 | 通过 | `memberMappings=[]`，默认收件人为新 installer |
| store OAuth provisioning | 通过 | 原销售成员映射保持不变 |
| 飞书限流、重试和失败补偿 | 通过 | 既有 contract / integration / unit 回归通过 |

## 本地门禁

| 门禁 | 结果 |
| ---- | ---- |
| TypeScript typecheck | 通过 |
| ESLint | 通过，完整检查 0 errors / 28 个基线 warnings；本轮 4 个改动代码/测试文件定向检查 0 errors |
| AI eval | 60 / 60 通过 |
| Unit | 110 files / 766 tests 通过 |
| Feishu contract | 12 / 12 通过 |
| Feishu routes integration | 18 / 18 通过 |
| Feishu sync integration | 10 / 10 通过 |
| Production build | 通过，Next.js compile、TypeScript 与 20 个静态页生成成功 |
| `git diff --check` | 通过 |

验证使用独立 PostgreSQL 数据库 `ivybm_task11_fix_20260809_test`。Build 使用合成环境值和本地测试
数据库，不构成 production 部署或 production 验收。

## 外部正式租户差距

- 企业版不改变本轮代码路径；飞书 `open_id` 仍按应用隔离，因此 QR 重连清理旧映射同样必要。
- 企业版可能要求管理员审批应用创建、权限范围或可用成员范围；这是租户配置与验收动作，不需要代码分支。
- 客户正式租户重连后，管理员需要重新维护销售成员映射，再用一条纯合成 Lead 验证定向通知。
- 未经单独批准，不删除旧应用或 Base，不修改客户真实 Lead，不启用或部署 production。
