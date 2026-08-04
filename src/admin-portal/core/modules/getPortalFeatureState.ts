import type {
  PortalEnvironment,
  PortalFeatureState,
  PortalModuleDefinition,
} from './types'

const isExplicitlyEnabled = (value: string | undefined): boolean => value === 'true'

export const getPortalFeatureState = ({
  env,
  module,
}: {
  env: PortalEnvironment
  module: PortalModuleDefinition
}): PortalFeatureState => {
  if (!isExplicitlyEnabled(env.ADMIN_PORTAL_ENABLED)) {
    return { enabled: false, reason: 'portal-disabled' }
  }

  if (!isExplicitlyEnabled(env[module.featureFlag])) {
    return { enabled: false, reason: 'module-disabled' }
  }

  if (module.availability === 'dependency-gated') {
    return { enabled: false, reason: 'dependency-gated' }
  }

  if (module.availability === 'blocked') {
    return { enabled: false, reason: 'blocked' }
  }

  return { enabled: true, reason: 'available' }
}
