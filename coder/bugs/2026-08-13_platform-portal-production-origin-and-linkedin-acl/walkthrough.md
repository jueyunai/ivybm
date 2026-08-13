# 修复记录：平台 Portal production Origin 与 LinkedIn ACL

## 问题原因

- production 反向代理把公网请求转给内部 app origin，旧同源检查比较了错误的基准。
- LinkedIn 组织授权把 Posts API scopes 当成 Organization ACL finder 的完整权限，并使用了不匹配的角色名。

## 修复内容

- `portalHttp.ts` 在 production 只信任校验后的 `NEXT_PUBLIC_SERVER_URL`；非 production 沿用请求 origin，避免影响本地独立环境。
- Portal route/unit 覆盖 `https://ivybm.com -> http://app:3000` 的正常写操作和内部 origin 伪造反例。
- LinkedIn Organization OAuth 增加 `r_organization_admin`，并把 ACL 内容管理员角色统一为 `CONTENT_ADMINISTRATOR`。
- 删除未使用的 `safeDeleteState`，避免新增 lint warning。

## 验证

- 修复前：反向代理 helper 回归 2 项失败；LinkedIn ACL scope / 角色回归失败。
- 修复后：平台 unit 42 files / 568 tests 通过，覆盖 Portal JSON/account routes 与 Meta、Instagram、LinkedIn OAuth。
- TypeScript、定向 ESLint、Prettier 与 `git diff --check` 通过。
- GitHub Draft CI 需要在新 head 上重新运行；本修复不授权 Ready、合并或 deployment。

## 外部依据

- LinkedIn Organization Access Control API：`/rest/organizationAcls` 的 finder 权限为 `r_organization_admin` / `rw_organization_admin`，角色枚举包含 `CONTENT_ADMINISTRATOR`。
- LinkedIn Posts API：组织发布使用 `w_organization_social`，因此组织授权需要同时满足 ACL 验证与发布两个权限域。
