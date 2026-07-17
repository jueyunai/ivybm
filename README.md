# IVYBM 建材出海 AI 获客系统

本目录是 IVYBM 项目的正式开发仓库。

一期目标是交付英文 / 阿语铝单板独立站、统一 CMS、AI 客服与知识库、会话管理、飞书 CRM 同步、AI 内容工作台及首批海外平台接入。

## 当前状态

- 已从前期资料目录迁入需求基线、技术架构和必要调研文档。
- 已将静态网站预览迁入 `references/website-prototype/`，仅作为 UI 和内容参考。
- Task 1 正式应用工程已初始化，当前具备 Next.js 前台、Payload Admin、REST API、GraphQL API 和基础测试能力。
- 当前技术栈：Next.js 16.2.6、Payload CMS 3.86.0、React 19.2.6、PostgreSQL Adapter、Node.js 24、pnpm 10.15.1。
- 后续按实施计划继续接入 PostgreSQL + pgvector、Docker Compose、1Panel OpenResty 及业务模块。

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
  website-prototype/  静态网站原型，仅供参考
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

一期执行依据：

- [`docs/requirements/一期需求说明文档.md`](docs/requirements/一期需求说明文档.md)
- [`docs/architecture/一期技术选型与部署架构规划.md`](docs/architecture/一期技术选型与部署架构规划.md)
- [`docs/plans/2026-07-16-一期开发实施计划.md`](docs/plans/2026-07-16-一期开发实施计划.md)

两人协作分支和 PR 规范见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

编码代理规则见 [`AGENTS.md`](AGENTS.md)；Claude Code 入口见 [`CLAUDE.md`](CLAUDE.md)。首次 clone 后运行：

```bash
bash scripts/install-git-hooks.sh
```
