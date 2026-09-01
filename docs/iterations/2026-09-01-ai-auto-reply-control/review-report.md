# Review Report

状态：reviewed，待 PR Review。

## 独立 Review 结论

- P0/P1：无。
- `aiAutoReplyEnabled` 使用独立字段，migration 默认 `false` 且非空；PATCH 继续 admin-only + authorizationRevision/CAS；暂停/恢复写入专用 audit resource，不记录 Token、正文或 provider payload。
- 暂停入站在 `ConversationService` 保存 visitor message 后提前返回，不调用 lead/AI/handoff；恢复只影响新消息。
- delivery authority 在同一 claim 事务锁定 account/intent/conversation，且仅在尚未跨 provider I/O 的 `send` 模式拦截；`recover` 模式保留 `delivery_unknown` 语义，避免伪造结果；`human_active` 不受影响。
- Instagram 通过 messaging ID → OAuth ID 映射后再按 account kind 查询策略；Facebook/Instagram 不串账号。
- UI 默认摘要、诊断折叠、管理对话框和危险区已覆盖截图中的拥挤/重复问题；toggle 已提升到 44px，并有确认、状态通知、键盘焦点处理。

## QA 残余风险

- 本机 Compose/preflight operations 测试依赖 Docker CLI，当前环境未安装，不能作为本地通过证据；应依赖 GitHub CI。
- 本轮真实 Meta canary 尚未执行；需在 PR 合并、生产审批、重新授权后验证暂停只落库不出站、恢复只处理新消息。
- 账号页 E2E 在本地隔离 PostgreSQL + 本地 app 上 7/7 通过，包含桌面/390px/摘要/诊断折叠/账号管理流程。
- 此前审查记录中的 PDF 解析测试超时已不再复现；当前 exact head `pnpm test:unit` 为 205 files / 1821 tests passed，未触碰知识解析代码。
