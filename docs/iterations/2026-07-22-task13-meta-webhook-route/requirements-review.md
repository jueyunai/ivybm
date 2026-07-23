# Task 13 Meta Webhook Route：需求复核

## 目标

为已合并的 Meta durable inbound 链路增加受控公网入口：Facebook Messenger / Instagram DM 的 Meta challenge 与签名请求可进入既有 `Jobs` inbox。

## 范围

- `GET /api/webhooks/meta`：仅在服务器已配置 verify token 与 app secret 时通过 Meta subscription challenge。
- `POST /api/webhooks/meta`：限制原始 body、验证 `X-Hub-Signature-256`、归一化并原子写入既有 `platform.event.dispatch` Job。
- 环境变量模板、fake/fixture 单元测试和 PostgreSQL 集成测试。

## 非目标

- 不配置真实 Meta App、账号、secret、Webhook 订阅或生产公网入口。
- 不实现 Meta 出站、delivery/read status adapter、TikTok 私信或发布侧 adapter。
- 不创建 Collection、migration、Payload 注册或临时发布结构。

## 验收

1. challenge 正确时只回显 challenge；缺失或错误配置 fail closed。
2. POST 只接受受限 raw bytes、正确 HMAC 与 JSON；错误不泄露 token、secret、payload 或数据库细节。
3. 已验签的同一事件重投只产生一条 durable Job；语义冲突不部分写入。
4. 无真实平台网络调用；真实账号联调仍为 `conditional`。

## 外部依赖

- 代码阶段：无账号依赖。
- 真实联调阶段：Meta Business / App、Page、Instagram 商业账号绑定、App Review、公开 HTTPS callback 与服务器端 secret 注入。
