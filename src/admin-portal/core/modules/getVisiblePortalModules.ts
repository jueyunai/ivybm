import { PORTAL_MODULES } from './registry'
import { resolvePortalModule } from './resolvePortalModule'
import type { PortalEnvironment, PortalPermissionUser, ResolvedPortalModule } from './types'

export const getVisiblePortalModules = ({
  env,
  user,
}: {
  env: PortalEnvironment
  user: PortalPermissionUser
}): readonly ResolvedPortalModule[] =>
  PORTAL_MODULES.flatMap((portalModule) => {
    const resolved = resolvePortalModule({ env, module: portalModule, user })
    return resolved ? [resolved] : []
  })
