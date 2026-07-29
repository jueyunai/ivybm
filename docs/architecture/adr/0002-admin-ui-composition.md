# ADR-0002：Payload 原生 Admin 与自有 Custom Views

## 状态

Superseded by [ADR-0004](0004-modular-admin-portal.md)，2026-07-29。

本 ADR 记录的 Payload Admin Custom Views 路线已完成首轮 Nav、Dashboard 与账户菜单验证，
其实现仅作为 `/admin` 内部维护遗留能力保留，不再扩展，也不作为 Portal 产品回退；“一期不建设独立
`/dashboard`”的入口决策由 ADR-0004 取代。权限、领域服务、审计、敏感字段和有界查询约束继续有效。

## 背景

IVYBM 已在一个 Next.js + Payload 模块化单体中维护 23 个 Collection，并依赖 Payload 的认证、角色访问控制、上传、关系字段、国际化、内容草稿和审计。后台同时需要会话接管、运营待办、内容审核和发布等跨 Collection 的高频任务体验。

`payload-theme@0.7.0` 已在独立 POC 中验证。其视觉语言可借鉴，但它会无条件替换 Payload Nav 与 Dashboard，存在中文后台文案不完整、Dashboard 查询扇出、导航 DOM 在切换时重建及现有 Vitest ESM 兼容性失败。完整证据见 [`docs/research/payload-theme-poc-record.md`](../../research/payload-theme-poc-record.md)。

## 决策

采用受控混合模式：

| 层 | 责任 |
| --- | --- |
| Payload 原生 Admin | Collection / Global CRUD、字段验证、上传、关系、内容 locale、访问控制、审计与配置入口 |
| 项目自有 Custom Views | 运营 Dashboard、会话 Inbox、内容审核与发布、受控媒体工作区 |
| 领域服务 | ConversationService、PublishingService 和 Jobs 继续是命令、状态机、幂等、权限和审计的权威边界 |

不安装或 fork `payload-theme`。不在一期建设 React-admin、Refine、Ant Design Pro 或 shadcn/ui 驱动的独立后台。它们不是 Payload 的替换皮肤；一旦采用，仍需自建数据适配、登录会话、权限展示和错误状态，并重复维护一套后台应用。

## 约束

- Custom Root View 默认公开，必须在服务端检查登录和角色；隐藏链接不构成授权。
- 自定义读取使用当前 Payload request 的 Local API，`overrideAccess: false`，并限制字段、排序、列表长度和查询数量。
- 自定义命令不得直接写 `handoffStatus`、`assignedTo`、审计字段或平台 token；必须经过既有领域服务/API。
- 仅使用 Payload 公开的 Custom Component、Custom View、Template 和 UI API；不得依赖或覆盖内部 Nav DOM。
- 每个自定义视图必须有角色边界测试、键盘/焦点验证、桌面/窄屏截图和 Payload 升级后的视觉回归。

## 后果

正面：保留一套认证与数据模型，避免 2C4G 单机增加第二个后台应用，同时能为运营人员提供任务导向体验。

负面：Payload Admin 的壳仍限制页面形态；自定义视图需要自行维护权限守卫、读模型、可访问性和升级兼容性。

## 重新评估条件

当以下条件同时或显著成立时，再评估独立运营端，首选 Refine + 自有组件体系：

1. 多个 Custom View 已上线且 Payload 壳被证明阻碍核心交互；
2. 运营人员的大多数日常操作发生在独立工作台；
3. 需要独立发布节奏、实时交互或独立扩缩容；
4. 已有稳定的领域 API、认证和权限 contract，可以避免复制 Payload 的内部逻辑。

## 关联文档

- [`docs/plans/2026-07-21-admin-ui-redesign.md`](../../plans/2026-07-21-admin-ui-redesign.md)
- [`docs/research/payload-theme-poc-record.md`](../../research/payload-theme-poc-record.md)
- [`docs/architecture/一期技术选型与部署架构规划.md`](../一期技术选型与部署架构规划.md)
