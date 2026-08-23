## 对应任务

- Task / Issue：
- 负责人：

## 变更内容

- 请填写主要变更。

## PR 范围与 CI 生命周期

- [ ] 本 PR 只包含同一目标、实施计划、Review 边界和回滚 / 发布单元；未机械拆分方案 / 实现 / 验证，也未混入无关任务
- [ ] PR 初始使用 Draft；push 前已运行本地定向检查并合并同轮小修改，未使用 `[skip ci]`
- [ ] 已选择与本次 diff 直接相关的最小测试层；未运行的真实联调、skipped、fake 或 fixture 证据已明确标注，未描述为真实平台通过
- [ ] 转 Ready 前已补全描述、测试记录、风险 / 回滚、共享边界判断和 Review 请求
- [ ] Ready 后如有新提交，已重新核对最新 head 的 Review 与 CI；连续大改时已先转回 Draft
- 当前 head SHA：
- `CI policy` 模式与结果（Fast-only / Full）：
- production image（会 / 不会，依据）：

## 验证

- [ ] 工作分支与 worktree 从最新 `origin/main` 创建，远程 upstream 与本地分支同名
- [ ] 已运行对应 Task 要求的测试
- [ ] `lint` 通过或当前阶段尚未配置
- [ ] `typecheck` 通过或当前阶段尚未配置
- [ ] 测试通过或已说明无法运行的原因
- [ ] production build 通过或当前变更不涉及构建
- [ ] 未提交密钥、客户资料、数据库、uploads 或备份
- [ ] 已更新 `docs/开发进度.md`

## 共享结构检查

- [ ] 不涉及共享 Collection、`src/payload.config.ts` 或 migration
- [ ] 不修改供另一名开发者任务消费的公共接口、字段或契约
- [ ] 如新增 migration，已基于最新 `main` 生成

## Review 路径

- [ ] 负责人自检合并：属于本人负责范围，CI 已通过，已检查完整 diff，且不涉及共享结构、跨人契约、协作者范围或一期上线验收
- [ ] 另一名开发者 review：涉及共享结构、跨人契约、双方板块边界或影响协作者在途任务，已请求 review
- [ ] CI 独立 review：如修改 workflow、`scripts/ci/**`、CI policy 或 production image 触发边界，已请求另一名开发者 review

> 两条路径按实际情况选择一条。负责人自检合并不等同于作者批准自己的 PR；请在描述或评论中记录自检依据。

> 合并前只接受与“当前 head SHA”一致的成功 `CI policy`。Draft Fast CI、旧 head、pending、neutral、skipped、cancelled 或 failure 均不能作为合并依据。

## 风险与回滚

- 风险：
- 回滚方式：
