import { PORTAL_MODULES } from './registry'
import { resolvePortalModule } from './resolvePortalModule'
import type { PortalEnvironment, PortalRole, ResolvedPortalModule } from './types'

export const getVisiblePortalModules = ({
  env,
  role,
}: {
  env: PortalEnvironment
  role: PortalRole
}): readonly ResolvedPortalModule[] =>
  PORTAL_MODULES.flatMap((portalModule) => {
    const resolved = resolvePortalModule({ env, module: portalModule, role })
    return resolved ? [resolved] : []
  })
