# CI 可信锚两阶段迁移计划

日期：2026-08-09
状态：已批准执行；Phase A bootstrap 保持 Draft，按独立 Review 修复中

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
- 唯一 write 例外为 `.github/workflows/ci.yml` 的 `publish_production_images` job；publisher job 必须与 base-owned contract 结构一致，只允许 `contents: read` + `packages: write`、固定 main push 条件和固定 `docker/login-action` 使用 `secrets.GITHUB_TOKEN` 登录 `ghcr.io`。
- 候选 workflow 集合必须保留普通文件形式的 canonical `ci.yml` 与 `trusted-pr-ci.yml`；base-owned `trusted-pr-ci.yml` 的解析后完整结构是唯一允许契约。YAML 注释、空白和 mapping key 顺序可以变化，但 trigger、权限、runner、job keys、`needs`、`if`、`continue-on-error`、step graph / 顺序 / keys、action SHA、run、shell、env 或任何额外字段的语义变化全部 fail closed。普通 PR 不得升级或重写该可信锚。
- token 扫描同时拒绝 `github.token`、`github.*`、任意 `github[...]` 动态索引和 `toJSON(github)`；结构化拒绝所有非 publisher `secrets` mapping（包括 reusable workflow 的 `secrets: inherit`）。action owner / repository 规范化大小写后，所有 checkout 必须精确等于 base contract 固定 SHA、关闭 credential persistence 且不得覆盖 token input；所有执行候选脚本的 diagnostics job 显式清空 `GH_TOKEN` / `GITHUB_TOKEN`。
- 现有 PR workflow 的 policy check 改名为 `CI diagnostics`；main push 保留 `CI policy (main)`，避免与 trusted `CI policy` 同名。
- 现有 PR diagnostics 不使用共享 pnpm cache，候选 shell 环境显式清空 GitHub token 变量；所有 Actions 固定完整 commit SHA。
- 更新冲突的 CI 设计基线、实施计划和 `docs/开发进度.md`。

### 3.2 首次独立 Review 修复

Review `4890917115` 的两项 P1 与一项 P2 已按 test-first 收口：publisher 例外改为 base contract 全结构比较；validator 从 trusted script 自身位置加载 base workflow contract 并强制 canonical/trusted topology；diff 使用未过滤列表判断真实空 diff，再用 `ACMR` 列表扫描仍存在的敏感路径，因此 deletion-only PR 不再被误拒绝。PR #64 在 Phase B 必须恢复与 bootstrap/main 完全一致的 publisher job，再迁移可信 validation，不得保留候选 publisher 变体。

### 3.3 第二次独立 Review 修复

Review `4891201996` 的两个 P1 已按绕过类别整体收口，而不是只匹配审核示例：trusted workflow 从 substring / 局部拓扑断言升级为解析后全结构契约，统一拒绝 `if: false`、job / step `continue-on-error`、`self-hosted` runner、echo/comment 空壳命令、额外或重排 step 及其他任意语义变化；凭据扫描新增 `secrets` mapping key 拒绝，并对 checkout owner / repository 大小写规范化后要求精确 base SHA。对应负向回归同时覆盖 `secrets: inherit`、大小写 checkout 和历史 checkout SHA。

该精确契约有意将 `trusted-pr-ci.yml` 设为普通 PR 不可变锚点。PR #64 不得修改它；未来可信分类节流或锚点拓扑升级必须作为单独授权、固定 base/head、完整本地门禁和双人独立确认的版本化 bootstrap，不能复用本 PR 例外。

### 3.4 一次性 bootstrap 验收

新增的 `pull_request_target` workflow 只有进入 `main` 后才会成为 base-owned；它不能为自己的 bootstrap PR 提供可信 check。本 PR 只允许采用一次性人工验收：

1. PR 保持 Draft；当前固定 base SHA 为 `d08d174679ffc20dc8e67dd514d6a19d088bd910`。最终 head SHA 在冻结提交后记录到 PR 描述和复审评论；计划文件不能自引用包含自身修改的最终 commit SHA。
2. 本地完整门禁、workflow AST 权限测试、action pin、diff/sensitive path 检查全部通过。
3. 现有候选 CI 结果只作诊断，不表述为 trusted policy。Ready run `31308372770` 仅验证候选 Classify / Fast / path-specific full gate / build / Docker / Compose / operations；新 review 产生修改后 PR 已立即转回 Draft，最终双方确认前不得再次转 Ready。
4. jueyunai 与 xuemusi 对完整 diff、权限、无 secrets/write、main publish 不变和“revert 最终 PR merge commit”的回滚路径作独立确认；分支上的多个审查修复 commit 不改变最终合并回滚单元。
5. 仅该 bootstrap head 可使用此例外；任何新 commit 使旧验收失效。
6. 合并后以 PR #64 的首个真实 trusted `CI policy` 验收可信锚；若失败，立即 revert PR #65 的最终 merge commit。

Bootstrap 分支不复制 PR #64 已更新的 72 张 Linux / Darwin 视觉基线。本地全量 E2E 应记录功能用例结果；`main` 既有 footer legal links 导致的 36 张陈旧视觉基线由 PR #64 当前 head 的已审核快照修复和 bootstrap 合入后的首个真实 trusted run 验收。

## 4. Phase B：PR #64 收口

Phase A 合入 `main` 后：

1. PR #64 使用普通 merge 合入最新 `origin/main`，禁止 rebase 后 force push。
2. `trusted-pr-ci.yml` 必须与合入后的 base contract 完全一致，不得在 #64 中加入分类、节流或其他语义修改；`ci.yml` 的 publisher job 同样恢复为 bootstrap/main 的精确结构。
3. 仅从候选 diagnostics 路径删除 `verify-trusted-policy.mjs`、Actions API 轮询、候选 job/step ledger 和临时 verifier；CI v2 的候选单 validation runner 可保留为开发反馈，但没有授权权力。
4. 当前 head 自动运行不可变 trusted workflow 的完整门禁；policy 绑定 base/head SHA、同一 run DAG 和 validation 结果。
5. 未来若确需把可信 classification / 节流迁入锚点，另建版本化 bootstrap 计划和 PR，不继承本次一次性例外。
6. 更新 PR 描述与复审评论，逐项映射 review `4890428099` 的四个 P1 和文档 P3。

## 5. 测试矩阵

- 合法 main publish workflow 通过结构化权限验证。
- flow / quoted / commented YAML、`write-all`、任意 write scope、`id-token: write`、缺失 permissions、alias/merge、额外 secrets 和未固定 action 全部失败。
- publisher registry/action/username/password 或 step graph 任一变化均失败；`github.token`、通配、索引、动态索引和 GitHub context 整体序列化均失败，普通 `github.actor` / `github.ref` 保持可用；checkout 保留凭据或显式 token input 同样失败。
- canonical workflow 删除、重复、空壳替换、symlink，以及 trusted trigger、候选 SHA、`--ignore-scripts`、same-run needs、`always()` 或 trusted evaluator 任一削弱均失败。
- trusted workflow 的 `if:false`、job / step `continue-on-error`、runner、run / shell、额外或重排 step 等任意结构语义变化均失败；仅注释、空白和 mapping key 顺序变化保持通过。
- reusable workflow `secrets: inherit`、大小写 checkout 和非 base-contract checkout SHA 均失败；canonical checkout 必须继续关闭凭据持久化且没有 token override。
- deletion-only diff 被识别为真实非空 diff，敏感路径扫描仍只检查 `ACMR` 路径。
- trusted policy 拒绝非法 event、非法或不一致 SHA、control/validation 的 failure、skipped、cancelled 和缺失结果。
- trusted workflow 只使用 `pull_request_target`，trusted/candidate checkout 隔离，candidate 精确绑定 head SHA，无 secrets、write、cache、polling 或 ledger。
- 完整 lint、typecheck、unit、contract、operations、build、数据库、E2E 和 Docker/Compose 门禁按 bootstrap 验收记录执行。

## 6. 风险与回滚

- 风险：Phase A 的不可变可信锚对所有 PR 运行完整门禁，计费高于分类模式；PR #64 只删除候选轮询和重复授权控制，不得直接修改可信锚。可信分类节流延后到另行批准的版本化 bootstrap。
- 风险：`pull_request_target` 执行候选代码；通过独立 runner/job、只读权限、无 secrets、无持久凭据、无共享 cache 和 base-owned 命令降低风险。
- 残余风险：免费私有仓库没有服务端 branch protection，同仓协作者和管理员仍需遵守双人控制面 Review；代码不能消除平台管理员绕过能力。
- 回滚：revert PR #65 的最终 merge commit；分支中的同步与多轮 review commit 不需要逐个回退。回滚不改变既有 main push、镜像 tag/digest 或 production 人工部署流程。
