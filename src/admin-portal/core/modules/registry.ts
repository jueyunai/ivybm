import { definePortalModule, validatePortalModule } from './definePortalModule'
import type { PortalModuleDefinition } from './types'
import { OVERVIEW_MODULE } from '@/admin-portal/modules/overview/manifest'
import { SETTINGS_MODULE } from '@/admin-portal/modules/settings/manifest'
import { WEBSITE_CONTENT_MODULE } from '@/admin-portal/modules/website-content/manifest'
import { MEDIA_MODULE } from '@/admin-portal/modules/media/manifest'

export const PORTAL_MODULES = Object.freeze([
  OVERVIEW_MODULE,
  definePortalModule({
    id: 'conversations',
    owner: 'xuemusi',
    navGroup: 'workspace',
    href: '/dashboard/conversations',
    labelKey: 'conversations',
    allowedRoles: ['admin', 'operator', 'sales'],
    availability: 'dependency-gated',
    featureFlag: 'ADMIN_PORTAL_CONVERSATIONS_ENABLED',
    commands: [],
    maintenance: { responsibleOwner: 'xuemusi', nextStepKey: 'conversations' },
  }),
  definePortalModule({
    id: 'leads',
    owner: 'jueyunai',
    navGroup: 'workspace',
    href: '/dashboard/leads',
    labelKey: 'leads',
    allowedRoles: ['admin', 'operator', 'sales'],
    availability: 'dependency-gated',
    featureFlag: 'ADMIN_PORTAL_LEADS_ENABLED',
    commands: [],
    maintenance: { responsibleOwner: 'jueyunai', nextStepKey: 'leads' },
  }),
  WEBSITE_CONTENT_MODULE,
  MEDIA_MODULE,
  definePortalModule({
    id: 'content-studio',
    owner: 'jueyunai',
    navGroup: 'content',
    href: '/dashboard/content-studio',
    labelKey: 'content-studio',
    allowedRoles: ['admin', 'operator'],
    availability: 'dependency-gated',
    featureFlag: 'ADMIN_PORTAL_CONTENT_STUDIO_ENABLED',
    commands: [],
    maintenance: { responsibleOwner: 'jueyunai', nextStepKey: 'content-studio' },
  }),
  definePortalModule({
    id: 'knowledge',
    owner: 'xuemusi',
    navGroup: 'intelligence',
    href: '/dashboard/knowledge',
    labelKey: 'knowledge',
    allowedRoles: ['admin', 'operator'],
    availability: 'dependency-gated',
    featureFlag: 'ADMIN_PORTAL_KNOWLEDGE_ENABLED',
    commands: [],
    maintenance: { responsibleOwner: 'xuemusi', nextStepKey: 'knowledge' },
  }),
  definePortalModule({
    id: 'platforms',
    owner: 'xuemusi',
    navGroup: 'operations',
    href: '/dashboard/platforms',
    labelKey: 'platforms',
    allowedRoles: ['admin'],
    availability: 'admin-only',
    featureFlag: 'ADMIN_PORTAL_PLATFORMS_ENABLED',
    commands: [],
    maintenance: { responsibleOwner: 'xuemusi', nextStepKey: 'platforms' },
  }),
  definePortalModule({
    id: 'operations',
    owner: 'jueyunai',
    navGroup: 'operations',
    href: '/dashboard/operations',
    labelKey: 'operations',
    allowedRoles: ['admin'],
    availability: 'admin-only',
    featureFlag: 'ADMIN_PORTAL_OPERATIONS_ENABLED',
    commands: [],
    maintenance: { responsibleOwner: 'jueyunai', nextStepKey: 'operations' },
  }),
  SETTINGS_MODULE,
] as const satisfies readonly PortalModuleDefinition[])

export const validatePortalModuleRegistry = (modules: readonly PortalModuleDefinition[]): void => {
  const ids = new Set<string>()
  const hrefs = new Set<string>()
  const labelKeys = new Set<string>()
  const featureFlags = new Set<string>()
  const commandIds = new Set<string>()

  for (const portalModule of modules) {
    validatePortalModule(portalModule)

    if (ids.has(portalModule.id)) throw new Error(`Duplicate module id: ${portalModule.id}`)
    if (hrefs.has(portalModule.href)) {
      throw new Error(`Duplicate module href: ${portalModule.href}`)
    }
    if (labelKeys.has(portalModule.labelKey)) {
      throw new Error(`Duplicate module label key: ${portalModule.labelKey}`)
    }
    if (featureFlags.has(portalModule.featureFlag)) {
      throw new Error(`Duplicate module feature flag: ${portalModule.featureFlag}`)
    }
    for (const command of portalModule.commands) {
      if (commandIds.has(command)) throw new Error(`Duplicate Portal command: ${command}`)
      commandIds.add(command)
    }

    ids.add(portalModule.id)
    hrefs.add(portalModule.href)
    labelKeys.add(portalModule.labelKey)
    featureFlags.add(portalModule.featureFlag)
  }
}

validatePortalModuleRegistry(PORTAL_MODULES)
