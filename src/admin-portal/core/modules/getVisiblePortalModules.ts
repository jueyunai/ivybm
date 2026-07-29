import { getPortalFeatureState } from './getPortalFeatureState'
import { PORTAL_MODULES } from './registry'
import type { PortalEnvironment, PortalRole, ResolvedPortalModule } from './types'

export const getVisiblePortalModules = ({
  env,
  role,
}: {
  env: PortalEnvironment
  role: PortalRole
}): readonly ResolvedPortalModule[] =>
  PORTAL_MODULES.filter((portalModule) =>
    (portalModule.allowedRoles as readonly PortalRole[]).includes(role),
  ).map((portalModule) => {
    const featureState = getPortalFeatureState({ env, module: portalModule })

    return {
      ...portalModule,
      canNavigate: featureState.enabled,
      commands: featureState.enabled ? portalModule.commands : [],
      featureState,
    }
  })
