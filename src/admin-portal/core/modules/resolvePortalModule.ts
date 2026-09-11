import { hasPortalPermission } from '@/access/roles'
import { getPortalFeatureState } from './getPortalFeatureState'
import type {
  PortalEnvironment,
  PortalModuleDefinition,
  PortalPermissionUser,
  ResolvedPortalModule,
} from './types'

export const resolvePortalModule = ({
  env,
  module,
  user,
}: {
  env: PortalEnvironment
  module: PortalModuleDefinition
  user: PortalPermissionUser
}): ResolvedPortalModule | null => {
  if (!module.allowedRoles.includes(user.role)) {
    return null
  }

  if (module.availability === 'admin-only' && user.role !== 'admin') {
    return null
  }

  if (
    module.id !== 'overview' &&
    module.id !== 'example' &&
    !hasPortalPermission(user, module.id, 'view')
  ) {
    return null
  }

  const featureState = getPortalFeatureState({ env, module })

  return {
    ...module,
    canNavigate: featureState.enabled,
    commands: featureState.enabled ? module.commands : [],
    featureState,
  }
}
