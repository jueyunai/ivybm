# 飞书扫码注册反向代理 Origin 修复

## 来源与目标

- 来源：2026-08-11 production `/dashboard/leads` 截图；管理员点击“扫码连接飞书”后，
  `POST /api/portal/feishu/registration` 返回 `403 invalid-origin`。
- 目标：浏览器来源为已配置公开站点、而服务端 `request.url` 为反向代理内部 URL 时，扫码注册继续进入
  配置预检；缺失、非法或恶意来源仍返回 403。
- 非目标：不关闭 CSRF / 同源保护，不修改 UI、Collection、migration、飞书凭据或 production 环境，
  不在本 PR 中部署 production。

## 技术设计

扫码注册路由不再把 `request.url` 当成公网安全边界。它从
`NEXT_PUBLIC_SERVER_URL` 解析可信公开 Origin，并与请求的 `Origin`（无则 `Referer`）做精确 origin
比较。配置缺失、URL 非法、协议不是 HTTP(S)、请求来源缺失或不匹配时全部 fail closed。

该改动不信任客户端可伪造的 `X-Forwarded-*` 来扩大允许列表；OpenResty 仍应正确覆盖 Host、
X-Forwarded-Host 和 X-Forwarded-Proto，但代理内部地址不再导致合法公网请求被误拒绝。

## 验收与测试

| ID | 场景 | 预期 | 证据 |
| --- | --- | --- | --- |
| ORIGIN-01 | `request.url=http://app:3000/...`，Origin 与 `NEXT_PUBLIC_SERVER_URL=https://ivybm.com` 一致 | 通过同源门禁并进入飞书配置预检 | integration test |
| ORIGIN-02 | 缺少 Origin / Referer | 403 `invalid-origin` | integration test |
| ORIGIN-03 | Origin 为恶意外域 | 403 `invalid-origin` | integration test |
| ORIGIN-04 | 可信公开 URL 缺失或非法 | fail closed，不启动 registration | integration / typecheck |

定向门禁：相关 ESLint、TypeScript typecheck、`tests/integration/feishu-routes.test.ts`、
`git diff --check`。部署后由管理员在 `https://ivybm.com/dashboard/leads` 点击扫码，预期 registration
从 403 变为 202/200 并显示二维码；production 部署仍需负责人单独批准。
