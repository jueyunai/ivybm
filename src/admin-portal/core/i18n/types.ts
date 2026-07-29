import type {
  PortalModuleLabelKey,
  PortalNavGroup,
  PortalNextStepKey,
  PortalStateKey,
} from '../modules/types'

export type PortalLocale = 'en' | 'zh'

export interface PortalShellMessages {
  accountMenu: string
  accountSettings: string
  brandName: string
  brandProduct: string
  changeLanguage: string
  closeNavigation: string
  collapseNavigation: string
  expandNavigation: string
  localEnvironment: string
  navigationLabel: string
  noNotifications: string
  openNavigation: string
  productionEnvironment: string
  roleAdmin: string
  roleOperator: string
  roleSales: string
  signOut: string
  signOutError: string
  signingOut: string
  systemStatus: string
}

export interface PortalSettingsMessages {
  accountDescription: string
  accountTitle: string
  canUpdateSite: string
  chinese: string
  darkTheme: string
  description: string
  english: string
  languageLabel: string
  lightTheme: string
  moduleOwner: string
  moduleStatusDescription: string
  moduleStatusTitle: string
  nextStep: string
  noSiteDescription: string
  preferencesDescription: string
  preferencesTitle: string
  readOnly: string
  reduceMotion: string
  reduceMotionDescription: string
  siteDescription: string
  siteName: string
  siteSummaryDescription: string
  siteSummaryTitle: string
  systemTheme: string
  themeLabel: string
  title: string
}

export interface PortalMessages {
  modules: Record<PortalModuleLabelKey, string>
  navGroups: Record<PortalNavGroup, string>
  states: Record<PortalStateKey, string>
  nextSteps: Record<PortalNextStepKey, string>
  settings: PortalSettingsMessages
  shell: PortalShellMessages
}
