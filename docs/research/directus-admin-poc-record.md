# Directus 管理后台 POC 验证记录

> **后续决策说明，2026-07-29：** 拒绝 Directus、保留 Payload 控制平面和单一数据/认证体系的
> 实验结论继续有效；“只在 `/admin` 内扩展、独立 `/dashboard` 仅为 Future”的入口结论
> 已被 [ADR-0004](../architecture/adr/0004-modular-admin-portal.md) 取代。新 Portal 仍在同一
> Next/Payload 应用内运行，不采用 Directus，也不创建第二套认证或数据访问路径。

## 验证范围

- 日期：2026-07-27 至 2026-07-28
- 分支：`feat/task-directus-admin-poc`
- 基线：`origin/main` 的 `41b5493`
- 试用版本：Directus `12.1.1`
- 目标：在不改动 production Payload 数据链路的前提下，验证 Directus Studio 是否能为 Products、Posts、Media 和 Site Settings 提供明显更现代、更友好的运营体验。
- 隔离边界：使用独立 Docker Compose project、独立 PostgreSQL、独立端口和 volumes；Studio 仅绑定 `127.0.0.1:8055`；未修改 production Collection、migration、Compose、数据库或媒体卷。

## 已完成的技术验证

- 已搭建可重复启动的 Directus + PostgreSQL 隔离环境，并实现幂等 schema 配置与 seed。
- 已建立英文 / 阿语翻译、产品分类、产品、文章、媒体和站点设置模型，覆盖草稿、发布、富文本、图库和 singleton 场景。
- 已验证 Studio 中的产品、文章、媒体和站点设置编辑流程；修复了 translations 与 gallery junction metadata 不完整导致的关系界面错误。
- 已实现 server-only Directus adapter 与 `/directus-poc/[locale]` 预览，显式限制字段、只读取 published 内容、只代理 public media，并禁止向浏览器暴露 reader token。
- 已验证匿名 API 关闭、operator 可写、sales 只读、发布 / 取消发布、public media 过滤和 seed 幂等。
- POC 期间通过的主要验证包括：Directus live contract `8/8`、operations `31/31`、Directus mapper/config unit `7/7`、typecheck，以及 feature enabled / disabled build 与英文 / 阿语 preview smoke。

这些结果说明 Directus 在数据建模、多语言内容、媒体关系和基础 CRUD 上可以工作，也能够在隔离架构中安全接入现有 Next.js 应用。POC 失败并非因为核心功能无法实现。

## 决定性失败原因

本次 POC 的核心评价标准是“是否值得为更现代、更友好的管理体验迁移 CMS”。实际浏览器验证后，Directus Studio 仍然呈现传统通用 CMS 的信息架构和表单式操作方式，视觉品质、操作效率和业务工作流体验没有达到 IVYBM 对现代 SaaS 工作台的目标。

具体结论如下：

| 评价项 | 验证结果 | 结论 |
| --- | --- | --- |
| 基础 CRUD / 多语言 / 媒体 | 可实现，关系元数据修正后可正常使用 | 技术可行 |
| 默认视觉与信息密度 | 仍是通用 CMS 后台风格 | 不满足现代化目标 |
| 高频运营工作流 | 仍以集合列表、详情表单和保存为中心 | 无法显著改善操作体验 |
| 业务定制成本 | 要达到 Cmd+K、Master-Detail、Kanban、Data Grid、AI Copilot 等目标，仍需大量自研 | 迁移收益不足 |
| 权限能力 | Directus 12.1.1 Core 无许可时拒绝自定义 row / field permission rules | 增加许可或适配层约束 |
| 迁移代价 | 需要复制 schema、权限、内容适配、预览和运维链路 | 不值得为默认 Studio UI 承担 |

## 最终决策（实验结论保留，入口路线已被取代）

**拒绝将 IVYBM 管理后台迁移到 Directus。**

保留现有 Payload CMS v3 + PostgreSQL 作为数据模型、Auth、权限、版本、多语言、Local API / REST API 和技术维护后台，不引入 Directus 生产依赖，也不迁移 production 数据。

以下为 2026-07-28 POC 结束时的历史入口判断，已于 2026-07-29 被 ADR-0004 取代：

- Payload CMS v3 继续承载 Admin runtime、认证、权限、Collection CRUD 和 Custom View 扩展点。
- `/admin` 使用自有 Nav、Operations Dashboard 和后续 Custom Views，把高频运营任务组织成业务工作区；需要时仍可回退到受权限控制的 Collection 页面。
- 独立 `/dashboard` 以及引入 shadcn/ui / Tailwind CSS 仅保留为未来提案，不是一期架构契约，也不能据此创建第二套认证、导航或数据访问路径。
- Cmd+K、Master-Detail、Kanban、Data Grid 和 AI Copilot 可作为未来设计手法评估，必须按真实数据、权限和依赖逐项落地，不能被描述为当前已实现能力。
- 所有业务写操作继续复用 Payload access control 与领域服务；Custom View 不得直接改权威状态、审计字段或平台凭据。

当前有效路线仍保留 Payload 作为唯一后端控制平面，但在同一 Next/Payload
应用内新增自研 `/dashboard` 运营门户，`/admin` 作为技术后台和 fallback。该双轨只是两个前端体验层，
不是两套认证、数据或部署系统；以 [ADR-0004](../architecture/adr/0004-modular-admin-portal.md) 为准。

Directus POC 中产生的 schema、fixtures、adapter、preview 和专属测试只属于失败试验，不合并到生产分支。对应 worktree 和本地 POC 资源在记录结论后删除。

## 可复用经验

1. 更换通用 CMS 不等于获得现代化业务工作台；默认 Admin UI 的差异不足以抵消迁移数据模型、权限和运维链路的成本。
2. 对运营效率有决定性影响的是任务编排、跨实体上下文和就地操作，而不是表单主题、圆角或配色。
3. Payload 应继续负责后端能力与 Admin runtime；面向运营人员的体验可在同一应用内通过独立路由和 Portal Core 渐进改善，但不复制认证、数据模型或领域服务。
4. 后续选型 POC 应把“完成一个真实业务任务的步骤数、上下文切换次数和可恢复性”作为主要验收指标，而不是只验证 CRUD 是否可用。
