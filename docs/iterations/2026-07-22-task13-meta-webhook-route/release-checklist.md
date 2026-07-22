# Task 13 Meta Webhook Route：发布检查表

- [x] 没有 migration、Collection、Payload 配置或生成类型改动。
- [x] route 使用 Node runtime、raw body HMAC、no-store 与 fail-closed 配置。
- [x] fixture / test 不含真实 token、账号、客户资料或网络请求。
- [x] 单元与独立 PostgreSQL integration 通过。
- [x] 全量质量门禁通过。
- [x] 独立 reviewer 完成安全 / 回归审查。
- [ ] jueyunai 完成跨人 review。
- [ ] 生产 `.env` 由授权部署人员写入真实 Meta secret 和随机 verify token。
- [ ] Meta App 的 HTTPS callback、订阅字段和 App Review 在受控窗口验证。
- [ ] 真实验证成功前，能力保持 `conditional`。
