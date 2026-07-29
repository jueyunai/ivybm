import { getPortalFeatureState } from './getPortalFeatureState'
import type {
  PortalEnvironment,
  PortalModuleDefinition,
  PortalRole,
  ResolvedPortalModule,
} from './types'

export const resolvePortalModule = ({
  env,
  module,
  role,
}: {
  env: PortalEnvironment
  module: PortalModuleDefinition
  role: PortalRole
}): ResolvedPortalModule | null => {
  if (!(module.allowedRoles as readonly PortalRole[]).includes(role)) return null

  const featureState = getPortalFeatureState({ env, module })

  return {
    ...module,
    canNavigate: featureState.enabled,
    commands: featureState.enabled ? module.commands : [],
    featureState,
  }
}
