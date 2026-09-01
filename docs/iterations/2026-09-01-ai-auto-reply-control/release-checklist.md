# Release Checklist

- [ ] 当前 head CI policy 成功
- [ ] 共享 Collection / migration / contract 已由另一开发者 Review
- [ ] production 备份与 restore rehearsal
- [ ] 默认账号策略为 paused，管理员显式开启
- [ ] 暂停 canary：入站落库、AI/Meta 出站为 0
- [ ] 恢复 canary：只回复新消息
- [ ] app/worker/db healthy，smoke 通过
- [ ] 回滚前处理暂停账号，避免旧代码忽略策略
