import { PORTAL_EN } from './en'
import type { PortalLocale, PortalMessages } from './types'
import { PORTAL_ZH } from './zh'

export const getPortalMessages = (locale: PortalLocale): PortalMessages =>
  locale === 'en' ? PORTAL_EN : PORTAL_ZH
