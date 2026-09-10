import { getVisiblePortalModules } from './getVisiblePortalModules'
import type { PortalEnvironment, PortalPermissionUser, ResolvedPortalModule } from './types'

export interface PortalAvailabilityResolution {
  modules: readonly ResolvedPortalModule[]
  portalEnabled: boolean
}

export const resolvePortalAvailability = ({
  env,
  user,
}: {
  env: PortalEnvironment
  user: PortalPermissionUser
}): PortalAvailabilityResolution => ({
  modules: getVisiblePortalModules({ env, user }),
  portalEnabled: env.ADMIN_PORTAL_ENABLED === 'true',
})
