# CI 可信锚两阶段迁移计划

日期：2026-08-09
状态：已批准执行；Phase A bootstrap 实施中

## 1. 背景与结论

PR #64 的多轮复审确认：候选分支可以修改 workflow、job、step 和 policy 脚本，因此候选 workflow 产生的成功结果不能自行证明其执行过真实门禁。按 workflow 名称、job 名称、step 名称或 conclusion 查询 Actions API 仍属于候选 ledger 自证；轮询还会产生竞态和额外 runner 分钟。

本次采用两阶段迁移：先从最新 `origin/main` 安装一个最小、base-owned 的 PR 可信锚，再让 PR #64 合并该基线并删除临时候选 ledger、API 轮询和重复控制流。Phase A 不实现 CI v2 的分类节流，不修改 production 发布契约。

## 2. 信任模型

权威数据流固定为：

```text
pull_request_target event metadata
  -> base SHA checkout (trusted control)
  -> exact head SHA checkout (candidate code)
  -> base-owned workflow permission validation
  -> isolated full candidate validation
  -> same-run needs results
  -> base-owned CI policy
```

约束如下：

- workflow 编排、权限验证和 policy 代码只从 PR base SHA 读取。
- 候选代码只在独立 job / checkout 目录运行，不覆盖 trusted control 文件。
- 候选命令不接收 secrets、写 token、OIDC 或可复用的 main cache；checkout 使用不可变 head SHA 且 `persist-credentials: false`。
- Phase A 直接执行完整门禁，空 diff、非法 SHA、权限解析异常、candidate job failure / skipped / cancelled 全部 fail closed。
- policy 只消费同一 workflow run 的 `needs` 结果，不查询 Actions runs/jobs API，不轮询，不接受候选 ledger。
- production image 仍只由现有 `main` push workflow 在 main policy 成功且 `production_image=true` 时发布。

## 3. Phase A：可信锚 bootstrap

### 3.1 实现范围

- 新增独立 `pull_request_target` workflow，job 顺序为 trusted control -> isolated full validation -> stable `CI policy`。
- 新增结构化 YAML workflow 权限验证：重复键、alias/merge、缺失 permissions、任意 write scope、OIDC、非发布 job 的 secret、未固定 SHA 的远程 action 全部拒绝。
- 唯一 write 例外为 `.github/workflows/ci.yml` 的 `publish_production_images` job；只允许 `contents: read` + `packages: write`、固定 allowlist 的 main push 条件和 `secrets.GITHUB_TOKEN` 登录 GHCR。
- 现有 PR workflow 的 policy check 改名为 `CI diagnostics`；main push 保留 `CI policy (main)`，避免与 trusted `CI policy` 同名。
- 现有 PR diagnostics 不使用共享 pnpm cache，候选 shell 环境显式清空 GitHub token 变量；所有 Actions 固定完整 commit SHA。
- 更新冲突的 CI 设计基线、实施计划和 `docs/开发进度.md`。

### 3.2 一次性 bootstrap 验收

新增的 `pull_request_target` workflow 只有进入 `main` 后才会成为 base-owned；它不能为自己的 bootstrap PR 提供可信 check。本 PR 只允许采用一次性人工验收：

1. PR 保持 Draft，记录 base SHA `097a27508afdf201ae76e10b94b740131428178b` 和最终 head SHA。
2. 本地完整门禁、workflow AST 权限测试、action pin、diff/sensitive path 检查全部通过。
3. 现有候选 CI 结果只作诊断，不表述为 trusted policy。
4. jueyunai 与 xuemusi 对完整 diff、权限、无 secrets/write、main publish 不变和单 commit revert 路径作独立确认。
5. 仅该 bootstrap head 可使用此例外；任何新 commit 使旧验收失效。
6. 合并后以 PR #64 的首个真实 trusted `CI policy` 验收可信锚；若失败，立即 revert bootstrap commit。

Bootstrap 分支不复制 PR #64 已更新的 72 张 Linux / Darwin 视觉基线。本地全量 E2E 应记录功能用例结果；`main` 既有 footer legal links 导致的 36 张陈旧视觉基线由 PR #64 当前 head 的已审核快照修复和 bootstrap 合入后的首个真实 trusted run 验收。

## 4. Phase B：PR #64 收口

Phase A 合入 `main` 后：

1. PR #64 使用普通 merge 合入最新 `origin/main`，禁止 rebase 后 force push。
2. 删除 `verify-trusted-policy.mjs`、Actions API 轮询、候选 job/step ledger 和临时 `pull_request_target` verifier。
3. 将 CI v2 分类、单 validation runner 和阶段计划迁入 base-owned trusted workflow；候选 workflow 只保留 diagnostics 或被删除。
4. 当前 head 运行真实 trusted policy；绑定 base/head SHA、同一 run DAG 和完整门禁结果。
5. 更新 PR 描述与复审评论，逐项映射 review `4890428099` 的四个 P1 和文档 P3。

## 5. 测试矩阵

- 合法 main publish workflow 通过结构化权限验证。
- flow / quoted / commented YAML、`write-all`、任意 write scope、`id-token: write`、缺失 permissions、alias/merge、额外 secrets 和未固定 action 全部失败。
- trusted policy 拒绝非法 event、非法或不一致 SHA、control/validation 的 failure、skipped、cancelled 和缺失结果。
- trusted workflow 只使用 `pull_request_target`，trusted/candidate checkout 隔离，candidate 精确绑定 head SHA，无 secrets、write、cache、polling 或 ledger。
- 完整 lint、typecheck、unit、contract、operations、build、数据库、E2E 和 Docker/Compose 门禁按 bootstrap 验收记录执行。

## 6. 风险与回滚

- 风险：Phase A 临时对所有 PR 运行完整门禁，计费高于分类模式；PR #64 合入后恢复基于可信分类的节流。
- 风险：`pull_request_target` 执行候选代码；通过独立 runner/job、只读权限、无 secrets、无持久凭据、无共享 cache 和 base-owned 命令降低风险。
- 残余风险：免费私有仓库没有服务端 branch protection，同仓协作者和管理员仍需遵守双人控制面 Review；代码不能消除平台管理员绕过能力。
- 回滚：Phase A 保持单一紧密 commit，可直接 revert；回滚不改变现有 main push、镜像 tag/digest 或 production 人工部署流程。
