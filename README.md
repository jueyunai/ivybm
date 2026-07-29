# IVYBM 建材出海 AI 获客系统

本目录是 IVYBM 项目的正式开发仓库。

一期目标是交付英文 / 阿语铝单板独立站、统一 CMS、AI 客服与知识库、会话管理、飞书 CRM 同步、AI 内容工作台及首批海外平台接入。

当前一期平台范围：会话接入 Facebook Messenger、Instagram DM、TikTok 私信；图文发布接入 Facebook、Instagram、LinkedIn。WhatsApp 不纳入一期系统接入，二期再评估网页插件等替代方案；官网静态外链不代表系统接入。

## 当前状态

- 已从前期资料目录迁入需求基线、技术架构和必要调研文档。
- 已将客户提供并确认的官网原型迁入 `references/website-prototype/`，作为正式官网 UI / 交互验收基准；生产实现使用 Next.js / Payload 重写，但必须高保真还原原型效果。
- Task 1 正式应用工程已初始化，当前具备 Next.js 前台、Payload Admin、REST API、GraphQL API 和基础测试能力。
- 当前技术栈：Next.js 16.2.6、Payload CMS 3.86.0、React 19.2.6、PostgreSQL Adapter、Node.js 24、pnpm 10.15.1。
- 当前已具备 PostgreSQL + pgvector、Docker Compose 和 1Panel OpenResty 的运行时基础；后续按实施计划继续完成 production 镜像发布和业务模块。
- 管理后台目标架构已冻结为“Payload 唯一控制平面 + 自研 `/dashboard` 运营门户 + `/admin` 技术后台/fallback”；当前为文档与设计基线，按模块化实施计划逐步开发。

## 本地开发

准备 Node.js 24、pnpm 10.15.1 和 PostgreSQL，然后执行：

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev
```

默认访问地址：

- 前台：`http://localhost:3000/`
- Payload Admin：`http://localhost:3000/admin`
- 运营门户（目标路由，按计划开发中）：`http://localhost:3000/dashboard`
- REST API：`http://localhost:3000/api`
- GraphQL API：`http://localhost:3000/api/graphql`

提交前运行：

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
```

## 目录

```text
docs/
  requirements/   一期需求和业务背景
  architecture/   技术架构与架构图
  research/       平台、供应商和邮箱调研
  plans/          经确认的实施设计与计划
references/
  website-prototype/  客户确认的官网 UI / 交互验收基准
src/
  app/            Next.js 前台、Payload Admin 与 API 路由
  collections/    Payload Collections
  lib/            共享服务与工具
tests/
  unit/           Vitest 单元测试
```

## 安全约定

- 不提交 `.env`、云平台密钥、证书私钥和服务器密码。
- 不提交客户合同、已填写签署件、报价成品和客户原始会议资料。
- 不提交数据库、上传文件、备份、浏览器日志和构建产物。

项目进度见 [`docs/开发进度.md`](docs/开发进度.md)。

## 单一 production 发布

GitHub CI 只负责质量门禁与私有镜像发布；1Panel 手动拉取指定 Git SHA + digest 镜像并发布，不使用服务器现场构建或公网 SSH。完整流程见 [`docs/operations/部署手册.md`](docs/operations/部署手册.md)。

一期执行依据：

- [`docs/requirements/一期需求说明文档.md`](docs/requirements/一期需求说明文档.md)
- [`docs/architecture/一期技术选型与部署架构规划.md`](docs/architecture/一期技术选型与部署架构规划.md)
- [`docs/plans/2026-07-16-一期开发实施计划.md`](docs/plans/2026-07-16-一期开发实施计划.md)
- [`docs/architecture/adr/0004-modular-admin-portal.md`](docs/architecture/adr/0004-modular-admin-portal.md)
- [`docs/architecture/管理后台模块化架构与责任边界.mermaid`](docs/architecture/管理后台模块化架构与责任边界.mermaid)
- [`docs/plans/2026-07-29-modular-admin-portal-implementation.md`](docs/plans/2026-07-29-modular-admin-portal-implementation.md)

两人协作分支、PR 和本地 worktree 规范见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。本地固定保留 `ivybm` 作为干净的 `main` 基线；开发使用短期 `ivybm-task*`、`ivybm-fix-*` 或 `ivybm-docs-*`，协作者 PR 审查使用临时 `ivybm-review-pr-<编号>`，完成后按规范清理。

编码代理规则见 [`AGENTS.md`](AGENTS.md)；Claude Code 入口见 [`CLAUDE.md`](CLAUDE.md)。首次 clone 后运行：

```bash
bash scripts/install-git-hooks.sh
```
