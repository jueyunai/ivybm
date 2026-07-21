# Task 14 staging 运行环境设计

> **状态：历史设计，已被 2026-07-20 的单一 production 基线取代。** 本文只保留当时本地 runtime 验证的背景；实际发布请遵循 [`2026-07-16-一期开发实施计划.md`](2026-07-16-一期开发实施计划.md) Task 14/15 和 [`../operations/部署手册.md`](../operations/部署手册.md)。

## 目标

第一阶段先交付可由客户访问的官网演示环境，覆盖英文 / 阿语官网、Payload CMS、演示内容、媒体和真实询盘入库。该阶段使用已登记的临时 Unsplash 素材，不代表最终 production 品牌资产验收。

AI 客服不使用 mock。官网 ChatWidget 只接入双方冻结的真实 `ChatService` contract；会话、AI、知识引用和人工接管服务仍由 xuemusi 负责，不在本 Task 14 分支中实现或伪造。

## 本分支范围

- 使用 Next.js standalone 输出构建 Node.js 24 多阶段镜像。
- runtime 容器使用非 root 用户，只运行 standalone `server.js`。
- tooling target 保留 migration / seed 所需源码和依赖，用于一次性任务。
- staging Compose 提供 PostgreSQL、migration、可选 seed 和 app 服务。
- app 仅绑定 loopback 地址，必须由服务器上的 OpenResty 提供 HTTPS 和可信代理头。
- PostgreSQL 与 Payload `media` 使用独立命名卷，容器重建后仍保留数据。
- staging 所有关键变量使用 Compose required expansion，不允许静默使用弱默认值。
- app readiness 依赖 `/api/health/ready`，数据库未就绪时容器保持 unhealthy。

## 部署顺序

1. 在服务器的 staging 环境文件中配置强 PostgreSQL 密码、`DATABASE_URL`、32 字符以上 `PAYLOAD_SECRET`、绝对 HTTPS `NEXT_PUBLIC_SERVER_URL` 和演示管理员凭据。
2. 运行 `docker compose -f compose.yaml -f compose.staging.yaml up -d --build db migrate app worker`。
3. 首次或需要重置演示数据时，显式运行 `docker compose -f compose.yaml -f compose.staging.yaml --profile tools run --rm seed`。
4. OpenResty 只代理本机 app 端口，并覆盖 `X-Real-IP` / `X-Forwarded-For`；不得把 app 或 PostgreSQL 端口直接暴露到公网。

## 后续独立 PR

- staging 全局 `noindex`、访问限制、smoke test 和上线检查表。
- 官网联系方式、社媒入口、下载页面和询盘 CTA 完善。
- 真实 ChatService contract、ChatWidget 与 xuemusi 服务联调。
- production 备份恢复、镜像发布、回滚和正式资产替换。

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
docker build --target runtime -t ivybm:staging .
docker compose -f compose.yaml -f compose.staging.yaml config
```

验收要求：镜像以非 root 用户启动；app 只监听容器内 3000 端口；Compose 合并后数据库不暴露公网，app 默认只绑定 `127.0.0.1`；数据库和媒体均使用持久卷；缺少任何必需 staging 变量时配置解析直接失败。
