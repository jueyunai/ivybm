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

export interface PortalOverviewMessages {
  dependencyDescription: string
  dependencyItems: Record<
    'content-review' | 'feishu-failures' | 'publishing-today',
    { description: string; label: string }
  >
  dependencyStatus: string
  dependencyTitle: string
  description: string
  emptyDescription: string
  emptyTitle: string
  eyebrow: string
  priorityDescription: string
  priorityKinds: Record<
    'active-conversation' | 'handoff-request' | 'job' | 'lead',
    { description: string; label: string }
  >
  priorityTitle: string
  queue: {
    activeConversations: { description: string; label: string }
    failedJobs: { description: string; label: string }
    handoffRequested: { description: string; label: string }
    newQualifiedLeads: { description: string; label: string }
  }
  readErrorDescription: string
  readErrorTitle: string
  roleNotice: Record<'admin' | 'operator' | 'sales', string>
  roleNoticeTitle: string
  scopeBadge: string
  statuses: Record<
    'dead' | 'failed' | 'handoff_requested' | 'human_active' | 'new' | 'qualified',
    string
  >
  title: string
  updatedAt: string
}

export interface PortalWebsiteContentMessages {
  allStatuses: string
  arabic: string
  collections: Record<
    'downloads' | 'pages' | 'posts' | 'product-categories' | 'products' | 'projects',
    string
  >
  description: string
  editorDescription: string
  editorStatus: string
  editorTitle: string
  emptyDescription: string
  emptyTitle: string
  english: string
  eyebrow: string
  filterLabel: string
  forbiddenDescription: string
  forbiddenTitle: string
  itemCount: string
  lastUpdated: string
  localeCompleteness: string
  moduleDisabledDescription: string
  moduleDisabledTitle: string
  nextPage: string
  noPreview: string
  preview: string
  previousPage: string
  readErrorDescription: string
  readErrorTitle: string
  resetFilters: string
  searchLabel: string
  searchPlaceholder: string
  searchSubmit: string
  selectedItem: string
  slug: string
  status: string
  statuses: Record<'active' | 'always-visible' | 'draft' | 'inactive' | 'published', string>
  title: string
  total: string
}

export interface PortalMediaMessages {
  allKinds: string
  allVisibility: string
  altText: string
  description: string
  detailTitle: string
  dimensions: string
  editorStatus: string
  emptyDescription: string
  emptyTitle: string
  eyebrow: string
  filename: string
  forbiddenDescription: string
  forbiddenTitle: string
  gridView: string
  images: string
  itemCount: string
  kindLabel: string
  lastUpdated: string
  lastUsed: string
  libraryTitle: string
  listView: string
  moduleDisabledDescription: string
  moduleDisabledTitle: string
  nextPage: string
  noAlt: string
  paginationLabel: string
  pdfs: string
  previewPdf: string
  previewUnavailable: string
  previousPage: string
  private: string
  public: string
  readErrorDescription: string
  readErrorTitle: string
  resetFilters: string
  searchLabel: string
  searchPlaceholder: string
  searchSubmit: string
  selectAsset: string
  sourceLabel: string
  sourcePlaceholder: string
  title: string
  total: string
  typeAndSize: string
  upload: string
  uploadDisabledTitle: string
  uploadLimits: string
  uploadLimitsTitle: string
  usageGated: string
  viewLabel: string
  visibilityLabel: string
}

export interface PortalMessages {
  modules: Record<PortalModuleLabelKey, string>
  navGroups: Record<PortalNavGroup, string>
  states: Record<PortalStateKey, string>
  nextSteps: Record<PortalNextStepKey, string>
  overview: PortalOverviewMessages
  mediaWorkspace: PortalMediaMessages
  settings: PortalSettingsMessages
  shell: PortalShellMessages
  websiteContent: PortalWebsiteContentMessages
}
