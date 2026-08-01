import { validatePortalModule } from './definePortalModule'
import type { PortalModuleDefinition } from './types'
import { OVERVIEW_MODULE } from '@/admin-portal/modules/overview/manifest'
import { SETTINGS_MODULE } from '@/admin-portal/modules/settings/manifest'
import { WEBSITE_CONTENT_MODULE } from '@/admin-portal/modules/website-content/manifest'
import { MEDIA_MODULE } from '@/admin-portal/modules/media/manifest'
import { KNOWLEDGE_MODULE } from '@/admin-portal/modules/knowledge/manifest'
import { CONVERSATIONS_MODULE } from '@/admin-portal/modules/conversations/manifest'
import { LEADS_MODULE } from '@/admin-portal/modules/leads/manifest'
import { CONTENT_STUDIO_MODULE } from '@/admin-portal/modules/content-studio/manifest'
import { PLATFORMS_MODULE } from '@/admin-portal/modules/platforms/manifest'
import { OPERATIONS_MODULE } from '@/admin-portal/modules/operations/manifest'

export const PORTAL_MODULES = Object.freeze([
  OVERVIEW_MODULE,
  CONVERSATIONS_MODULE,
  LEADS_MODULE,
  WEBSITE_CONTENT_MODULE,
  MEDIA_MODULE,
  CONTENT_STUDIO_MODULE,
  KNOWLEDGE_MODULE,
  PLATFORMS_MODULE,
  OPERATIONS_MODULE,
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
