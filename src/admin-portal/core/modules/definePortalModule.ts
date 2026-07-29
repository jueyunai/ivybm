import {
  PORTAL_AVAILABILITY,
  PORTAL_MODULE_OWNERS,
  PORTAL_NAV_GROUPS,
  type PortalModuleDefinition,
} from './types'

const PORTAL_ROLES = new Set(['admin', 'operator', 'sales'])
const FEATURE_FLAG_PATTERN = /^ADMIN_PORTAL_[A-Z0-9_]+_ENABLED$/
const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]*$/

export const validatePortalModule = (module: PortalModuleDefinition): void => {
  if (!MODULE_ID_PATTERN.test(module.id)) {
    throw new Error(`Invalid Portal module id: ${module.id}`)
  }

  if (!PORTAL_MODULE_OWNERS.includes(module.owner)) {
    throw new Error(`Invalid owner for Portal module ${module.id}`)
  }

  if (!PORTAL_NAV_GROUPS.includes(module.navGroup)) {
    throw new Error(`Invalid nav group for Portal module ${module.id}`)
  }

  if (!PORTAL_AVAILABILITY.includes(module.availability)) {
    throw new Error(`Invalid availability for Portal module ${module.id}`)
  }

  if (module.href !== '/dashboard' && !module.href.startsWith('/dashboard/')) {
    throw new Error(`Portal module ${module.id} must stay under /dashboard`)
  }

  if (module.href.includes('/admin') || module.href.includes('\\')) {
    throw new Error(`Portal module ${module.id} cannot link to an internal maintenance route`)
  }

  if (!FEATURE_FLAG_PATTERN.test(module.featureFlag)) {
    throw new Error(`Portal module ${module.id} must declare an explicit feature flag`)
  }

  if (module.allowedRoles.length === 0 || module.allowedRoles.some((role) => !PORTAL_ROLES.has(role))) {
    throw new Error(`Portal module ${module.id} must declare valid roles`)
  }

  if (new Set(module.allowedRoles).size !== module.allowedRoles.length) {
    throw new Error(`Portal module ${module.id} contains duplicate roles`)
  }

  if (module.availability === 'admin-only') {
    const roles = [...module.allowedRoles]
    if (roles.length !== 1 || roles[0] !== 'admin') {
      throw new Error(`Admin-only Portal module ${module.id} must only allow admin`)
    }
  }

  if (
    (module.availability === 'dependency-gated' || module.availability === 'blocked') &&
    module.commands.length > 0
  ) {
    throw new Error(`Unavailable Portal module ${module.id} cannot register commands`)
  }

  const commandIds = new Set<string>()
  for (const command of module.commands) {
    if (!command.startsWith(`${module.id}:`) || command.length === module.id.length + 1) {
      throw new Error(`Portal module ${module.id} contains command owned by another module`)
    }
    if (commandIds.has(command)) {
      throw new Error(`Portal module ${module.id} contains duplicate command: ${command}`)
    }
    commandIds.add(command)
  }

  if (
    module.maintenance.responsibleOwner !== module.owner ||
    module.maintenance.nextStepKey !== module.id
  ) {
    throw new Error(`Portal module ${module.id} has inconsistent maintenance metadata`)
  }
}

export const definePortalModule = <const T extends PortalModuleDefinition>(module: T): T => {
  validatePortalModule(module)
  return Object.freeze({
    ...module,
    allowedRoles: Object.freeze([...module.allowedRoles]),
    commands: Object.freeze([...module.commands]),
    maintenance: Object.freeze({ ...module.maintenance }),
  }) as T
}
