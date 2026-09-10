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
  if (
    module.id !== 'overview' &&
    module.id !== 'example' &&
    !hasPortalPermission(user, module.id, 'view')
  ) {
    return null
  }

  // The collaborator template is not a permission-backed business module, so it
  // keeps the manifest's demo role boundary instead of the shared matrix.
  if (module.id === 'example' && !module.allowedRoles.includes(user.role)) {
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
