# Release checklist

- [x] PRD、技术方案和 AC-01～AC-12 已冻结。
- [x] luna_worker 实现、主代理审核、独立 QA 分工完成。
- [x] 本地 lint/typecheck/unit/integration/contract/build/E2E/migration 门禁通过。
- [x] 原始客户文档、Key、数据库、uploads 和截图未进入 Git。
- [x] 自动翻译继续保持 draft/hidden/pending。
- [ ] 当前 PR head 的 GitHub CI policy 通过。
- [ ] jueyunai 审核共享 Jobs、AI route、Payload config 和 migration。
- [ ] Draft PR 明确转为 Ready。
- [ ] production AI route/prompt/正式 Key 和业务知识批准完成。
- [ ] production 部署获得 jueyunai 单独批准。

Rollback：先关闭 `ADMIN_PORTAL_KNOWLEDGE_ENABLED` 并停止 ingestion worker，再回滚应用镜像；保留 schema、原件和生成数据。禁止在 production 执行 migration down。
