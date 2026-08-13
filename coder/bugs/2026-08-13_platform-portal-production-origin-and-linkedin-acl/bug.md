# Bug: 平台 Portal production 写操作与 LinkedIn 组织授权门禁失效

## 关联需求

- `docs/plans/2026-08-10-MVP范围冻结与交付冲刺.md` P0-D
- PR #83 `/dashboard/platforms` 三平台账号与 OAuth 管理

## 问题描述

1. 新平台账号 CRUD 与 disconnect 路由把 `Origin` 与 `request.url` 的 origin 直接比较。production 浏览器发送 `https://ivybm.com`，而反向代理后的应用请求 URL 可能是 `http://app:3000`，因此合法的客户操作会被误拒为 403。
2. LinkedIn Organization OAuth 使用 `/rest/organizationAcls?q=roleAssignee` 验证目标组织和发布角色，却没有请求该 ACL finder 所需的只读 organization-admin scope；同时接受的 `CONTENT_ADMIN` 与该 ACL API 的官方角色枚举 `CONTENT_ADMINISTRATOR` 不一致。

## 复现步骤

1. 构造 production 请求 URL `http://app:3000/api/platforms/accounts`，Header `Origin: https://ivybm.com`，并配置 `NEXT_PUBLIC_SERVER_URL=https://ivybm.com`。
2. 旧实现返回 `PlatformPortalRequestError: forbidden`。
3. 对 LinkedIn 组织账号读取授权 URL；旧实现只包含 `r_organization_social w_organization_social`，随后 callback 调用 `/rest/organizationAcls`。
4. 官方 ACL 文档要求 `r_organization_admin` 或 `rw_organization_admin`，角色表使用 `CONTENT_ADMINISTRATOR`。

## 根因分析

- 同源校验复用了应用看到的内部 URL，没有使用已经过 production preflight 的公开 origin。这与此前飞书扫码注册 production 403 属于同一反向代理边界问题，但新 helper 没有复用已验证的公开-origin规则。
- LinkedIn 实现把 Posts API 的 social scopes 与 Organization ACL finder 的权限/角色枚举混为同一契约，fixture 又按实现自造 `CONTENT_ADMIN`，没有锁定官方 API 的实际权限前置。

## 修复方案

- development/test 保持按请求 URL 做同源校验；production 必须使用合法的 `NEXT_PUBLIC_SERVER_URL` origin，缺失或非法时 fail closed。
- 增加公开浏览器 Origin + 内部 app URL 的 route/helper 回归，以及 production 缺失公开 origin 的反例。
- LinkedIn Organization OAuth 增加最小只读 `r_organization_admin` scope，保留发布所需 social scopes；将 ACL 角色改为 `CONTENT_ADMINISTRATOR` 并更新回归。
- 不修改 migration、Collection、CI 或 production 开关，不扩展到 OAuth UI 重构。
