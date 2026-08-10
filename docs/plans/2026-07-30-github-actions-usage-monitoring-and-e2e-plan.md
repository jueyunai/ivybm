# GitHub Actions 第二轮优化最终方案

日期：2026-07-30
状态：批准执行第一阶段；单 job 重构暂缓，等待监测阈值触发

## 1. 决策

本轮不直接重构为单 job。先执行低风险、高收益的流程节流与 E2E 准确性修正，并连续监测 7 天或至少 5 个代表性 workflow run。只有真实用量达到阈值，才启动单 job 重构。

这不是延后优化，而是避免在第一轮 CI 优化上线仅一天、尚无优化后 docs-only 样本时，对核心门禁做高风险重写。

## 2. 已确认基线

- CI v1 从 run #152 开始生效，此前本月的大量用量仍来自旧 workflow。
- 生产代码发布 #52：Ready PR #158 为 5 分 42 秒，main #159 为 7 分 48 秒；不含无效 Draft run 时，估算约 19 个计费 job 分钟。
- Draft opened #157 在 22 秒后因转 Ready 被取消，仍启动了多个短 job，理论上增加约 2-3 个计费分钟。
- 优化前同类 Task 6 发布约 20 分 57 秒墙钟、约 23 个计费 job 分钟；CI v1 已把墙钟缩短约 36%，但 job 分片和生命周期事件抵消了部分计费收益。
- 优化前 docs-only PR + main + 镜像约 22 分 43 秒；CI v1 对 docs-only 的理论成本已降至约 4-6 个计费分钟，但尚缺优化后的真实样本。
- 当前 GitHub Actions cache 约 735 MB，最近 main 的两个 Docker build record 合计不足 90 KB；缓存和 artifact 不是当前费用主因。

## 3. 第一阶段：立即执行

### 3.1 PR 与 push 节流

1. 本地 lint、typecheck、unit、定向测试、build、PR 描述、风险/回滚和 Review 边界全部完成时，任务级明确授权可直接创建 Ready PR。
2. 未完成上述条件时才创建 Draft，并保持 Draft 到真实 Ready 检查点；禁止创建后几十秒内立即转 Ready。
3. 同一轮小修改集中一次 push；禁止把 GitHub Actions 当远程调试器。
4. 保留 PR CI、main CI、fail-closed 分类、当前 head policy、不可变镜像和 digest 链路。

### 3.2 修复 E2E 分类准确性

以一个独立小 PR 修复，不重构 job 图：

- 将粗粒度 `ui_e2e` 拆为 `website_e2e`、`admin_e2e`、`chat_e2e`，或采用等价的保守枚举。
- 官网页面与 `src/components/website/**` 只选择 `tests/e2e/website.spec.ts`。
- Admin 变更选择 `tests/e2e/admin-visual.spec.ts`。
- ChatWidget / 会话接管变更选择 `tests/e2e/chat-handoff.spec.ts`。
- 多范围变更运行对应测试集合；未知路径、全局配置和分类错误继续 fail closed。
- 只有至少一个 E2E 标志启用时才安装 Chromium。
- 本 PR 不合并 Fast/Full job、不改数据库 service、不拆 runtime/worker 镜像 tag。

## 4. 监测窗口

监测 7 个自然日，或直到收集以下最小样本：

- 2 个 docs-only PR（含合并后的 main run）
- 2 个普通代码 PR
- 1 个触发 production image 的 main run

每个事件记录：run URL、event、head SHA、Draft/Ready、分类结果、job 数、各 job 秒数、墙钟时间、按 job 向上取整的理论计费分钟、是否取消、是否发布镜像。

GitHub `Usage metrics` 是最终账单依据；workflow 列表的 Total duration 只表示墙钟时间，不能直接等同计费分钟。

## 5. 单 job 重构触发阈值

监测期出现任一条件，才创建 CI v2 单 job 设计与实施 PR：

- Ready PR 平均超过 8 个理论计费分钟
- main 生产发布平均超过 11 个理论计费分钟
- docs-only PR + main 超过 4 个理论计费分钟
- 月中已消耗月度预算的 70%
- 预计每月有 8 次以上生产代码发布

未达到阈值则保留当前 job 架构。以现有发布频率，单 job 每次预计仅节省 4-6 分钟，而重构及独立 Review 本身预计消耗 25-40 分钟 CI，需要约 6-10 次生产发布才能回本。

## 8. 阈值触发后的 CI v2 批次授权（2026-08-07）

7 日监测窗口已达到多项单 job 触发阈值：Ready/full PR 平均 15.29 个理论计费分钟，main production-image 平均 16.17 个理论计费分钟，production publish 频率折算约 26 次/月。docs-only 样本不足，不能据此宣称该项阈值已验证。基于这些实测数据，任务级授权启动 CI v2 实施批次。

CI v2 仅合并 validation runner 内的分类、Fast CI、按需数据库 / E2E / operations 门禁和最终 policy ledger；production image publish 保持独立 job，仍仅由成功的 main current head 触发并拥有 `packages: write`。保留 PR/main CI、fail-closed、不可变 SHA/digest、数据库和 E2E 相关门禁、敏感路径边界及另一名开发者对 workflow、`scripts/ci/**`、CI policy 和 production image 边界的独立 Review。该批次不修改业务 runtime、Collection、migration、Compose 或部署脚本。

## 6. 后续单 job 的边界

如触发阈值，后续方案才允许研究：单 runner 完成分类、Fast 与重门禁；依赖只安装一次；数据库按需启动并 `always()` 清理；最终 policy 保持稳定；publish job 继续独立且仅 main 获得 `packages: write`。

不得为了节省分钟取消 PR CI、main 复验、fail-closed、独立 Review、不可变镜像或 production smoke test，也不得在 production 服务器运行 self-hosted CI runner。

## 7. 第一阶段验收

- 不再出现“Draft opened 后立即 Ready”产生的无效 run。
- 同一轮修改原则上只有一次 `synchronize`。
- Website、Admin、Chat 的 E2E 与改动范围匹配。
- docs-only 不运行 Fast、Full gate 或 production image。
- PR 不拥有 `packages: write`；production image 仍只由成功的 main current head 生成。
- 分类异常与未知路径继续完整 fail closed。
- workflow / classifier / policy 修改经过另一名开发者独立 Review。
- 监测记录完成后给出继续保留或启动单 job 的量化结论。
