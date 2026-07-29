import type { UserRole } from '@/access/roles'

export const PORTAL_MODULE_OWNERS = ['jueyunai', 'xuemusi'] as const
export const PORTAL_NAV_GROUPS = [
  'workspace',
  'content',
  'intelligence',
  'operations',
  'system',
] as const
export const PORTAL_AVAILABILITY = [
  'available',
  'dependency-gated',
  'blocked',
  'admin-only',
] as const
export const PORTAL_STATE_KEYS = [
  'loading',
  'empty',
  'error',
  'forbidden',
  'blocked',
  'dependency-gated',
  'portal-disabled',
  'module-disabled',
  'available',
  'admin-only',
] as const

export type PortalRole = UserRole
export type PortalModuleOwner = (typeof PORTAL_MODULE_OWNERS)[number]
export type PortalNavGroup = (typeof PORTAL_NAV_GROUPS)[number]
export type PortalAvailability = (typeof PORTAL_AVAILABILITY)[number]
export type PortalModuleId = string
export type PortalModuleLabelKey = string
export type PortalNextStepKey = string
export type PortalStateKey = (typeof PORTAL_STATE_KEYS)[number]
export type PortalHref = '/dashboard' | `/dashboard/${string}`
export type PortalFeatureFlag = `ADMIN_PORTAL_${string}_ENABLED`
export type PortalCommandId = `${PortalModuleId}:${string}`

export interface PortalModuleManifest {
  id: PortalModuleId
  owner: PortalModuleOwner
  navGroup: PortalNavGroup
  href: PortalHref
  labelKey: PortalModuleLabelKey
  allowedRoles: readonly PortalRole[]
  availability: PortalAvailability
  featureFlag: PortalFeatureFlag
}

export interface PortalModuleMaintenance {
  responsibleOwner: PortalModuleOwner
  nextStepKey: PortalNextStepKey
}

export interface PortalModuleDefinition extends PortalModuleManifest {
  commands: readonly PortalCommandId[]
  maintenance: PortalModuleMaintenance
}

export type PortalFeatureStateReason =
  | 'available'
  | 'portal-disabled'
  | 'module-disabled'
  | 'dependency-gated'
  | 'blocked'

export type PortalFeatureState =
  | { enabled: true; reason: 'available' }
  | {
      enabled: false
      reason: Exclude<PortalFeatureStateReason, 'available'>
    }

export interface ResolvedPortalModule extends PortalModuleDefinition {
  canNavigate: boolean
  commands: readonly PortalCommandId[]
  featureState: PortalFeatureState
}

export type PortalEnvironment = Readonly<Record<string, string | undefined>>
