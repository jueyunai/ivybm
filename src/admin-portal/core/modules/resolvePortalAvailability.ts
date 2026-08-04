import { getVisiblePortalModules } from './getVisiblePortalModules'
import type { PortalEnvironment, PortalRole, ResolvedPortalModule } from './types'

export interface PortalAvailabilityResolution {
  modules: readonly ResolvedPortalModule[]
  portalEnabled: boolean
}

export const resolvePortalAvailability = ({
  env,
  role,
}: {
  env: PortalEnvironment
  role: PortalRole
}): PortalAvailabilityResolution => ({
  modules: getVisiblePortalModules({ env, role }),
  portalEnabled: env.ADMIN_PORTAL_ENABLED === 'true',
})
