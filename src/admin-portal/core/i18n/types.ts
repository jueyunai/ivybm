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
  ai: {
    actionRequired: string
    apiKey: string
    apiKeyConfigured: string
    apiKeyDescription: string
    baseURL: string
    capability: string
    capabilities: Record<'embedding' | 'image' | 'text', string>
    cancel: string
    contentStudio: string
    configuredPendingVerification: string
    create: string
    delete: string
    deleteConfirm: string
    dimensions: string
    disabled: string
    edit: string
    embeddingRoute: string
    enabled: string
    encryptionKey: string
    encryptionKeyMissing: string
    error: string
    maxOutputTokens: string
    model: string
    modelName: string
    models: string
    newModel: string
    newProvider: string
    newRoute: string
    noModels: string
    noProviders: string
    noRoutes: string
    operation: string
    profile: string
    provider: string
    providerName: string
    providers: string
    readiness: string
    readinessReason: Record<
      'credential' | 'encryption-key' | 'profile' | 'provider' | 'route',
      string
    >
    reasoningEffort: string
    reasoningEnabled: string
    routeName: string
    routes: string
    save: string
    saved: string
    status: string
    temperature: string
    textGenerationContract: string
    textGenerationContractDescription: string
    textGenerationContracts: Record<'chat-completions' | 'responses', string>
    textRoute: string
    timeout: string
    title: string
    topP: string
    usageKey: string
    usageLabels: Record<
      'chat.reply' | 'content.image-generation' | 'knowledge.embedding' | 'knowledge.translation',
      string
    >
    customerChat: string
    knowledgeIndex: string
    knowledgeTranslation: string
  }
  accountDescription: string
  accountTitle: string
  addMember: string
  canUpdateSite: string
  cancelMember: string
  cancelSiteDetails: string
  changePassword: string
  changePasswordCancel: string
  changePasswordConfirm: string
  changePasswordDescription: string
  changePasswordError: string
  changePasswordSaved: string
  changePasswordTitle: string
  chinese: string
  confirmDeleteMember: string
  confirmEmailPrompt: string
  confirmInitialPassword: string
  confirmNewPassword: string
  confirmResetPassword: string
  contactEmail: string
  contactPhone: string
  currentPassword: string
  darkTheme: string
  deleteMember: string
  deleteMemberDescription: string
  deleteMemberError: string
  deleteMemberSuccess: string
  deleteMemberTitle: string
  deletingMember: string
  description: string
  editMember: string
  editMemberTitle: string
  editSiteDetails: string
  email: string
  english: string
  eyebrow: string
  initialPassword: string
  languageLabel: string
  lightTheme: string
  lockMember: string
  lockMemberConfirm: string
  lockMemberSuccess: string
  lockMemberTitle: string
  memberActions: string
  memberCreatedAt: string
  memberEmail: string
  memberLockedUntil: string
  memberRole: string
  memberSaved: string
  memberStale: string
  memberStatus: string
  memberNotFound: string
  moduleOwner: string
  moduleStatusDescription: string
  moduleStatusTitle: string
  newMemberTitle: string
  newPassword: string
  nextStep: string
  noSiteDescription: string
  noTeamMembers: string
  passwordLengthHint: string
  passwordMismatch: string
  permission: string
  preferencesDescription: string
  preferencesTitle: string
  readOnly: string
  reduceMotion: string
  reduceMotionDescription: string
  resetPassword: string
  resetPasswordDescription: string
  resetPasswordSuccess: string
  resetPasswordTitle: string
  retryTeamMembers: string
  role: string
  roleAdminOption: string
  roleOperatorOption: string
  roleSalesOption: string
  saveMember: string
  saveSiteDetails: string
  savingMember: string
  savingPassword: string
  savingSiteDetails: string
  selfLabel: string
  siteDescription: string
  siteDetailsDescription: string
  siteDetailsError: string
  siteDetailsSaved: string
  siteDetailsTitle: string
  siteLocaleArabic: string
  siteLocaleEnglish: string
  siteLocaleLabel: string
  siteName: string
  siteSummaryDescription: string
  siteSummaryTitle: string
  statusManuallyLocked: string
  statusNormal: string
  statusSecurityLocked: string
  systemTheme: string
  teamAccountDisabled: string
  teamDescription: string
  teamMembersTitle: string
  teamMembersReadError: string
  teamCommandResultUnknown: string
  teamOperationError: string
  teamErrorMessages: Record<string, string>
  teamAssignmentDetailLabels: Record<string, string>
  themeLabel: string
  title: string
  unlockMember: string
  unlockMemberConfirm: string
  unlockMemberSuccess: string
  unlockMemberTitle: string
}

export interface PortalOverviewMessages {
  dependencyDescription: string
  dependencyItems: Record<'feishu-failures', { description: string; label: string }>
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
  showAllPriorities: string
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
  completenessComplete: string
  completenessMissing: string
  collections: Record<
    'downloads' | 'knowledge' | 'pages' | 'posts' | 'product-categories' | 'products' | 'projects',
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
  previewArabic: string
  previewEnglish: string
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
  statuses: Record<
    'active' | 'always-visible' | 'draft' | 'inactive' | 'published' | 'unpublished',
    string
  >
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
  uploadLimits: string
  uploadLimitsTitle: string
  usageGated: string
  viewLabel: string
  visibilityLabel: string
}

export interface PortalKnowledgeMessages {
  addDocument: string
  adminOnly: string
  adminRetryRequired: string
  aiAdminOnlyDescription: string
  aiAdminOnlyTitle: string
  aiRoutesTitle: string
  allIndexStatuses: string
  allLocales: string
  allReviewStatuses: string
  allSourceTypes: string
  allVisibility: string
  alreadyProcessing: string
  applyFilters: string
  arabic: string
  credentialsNeverShown: string
  customerVisible: string
  description: string
  documentColumn: string
  documentCount: string
  documentListTitle: string
  documentNotFound: string
  documentTableLabel: string
  embeddingRoute: string
  emptyDescription: string
  emptyTitle: string
  english: string
  eyebrow: string
  forbiddenDescription: string
  forbiddenTitle: string
  indexAccepted: string
  indexColumn: string
  indexDuplicate: string
  indexLabel: string
  indexRateLimited: string
  indexStatuses: Record<'failed' | 'pending' | 'processing' | 'ready', string>
  indexUnavailable: string
  indexing: string
  internalOnly: string
  invalidDocument: string
  localeColumn: string
  localeLabel: string
  metrics: {
    draft: string
    draftCaption: string
    failed: string
    failedCaption: string
    processing: string
    processingCaption: string
    ready: string
    readyCaption: string
  }
  metricsLabel: string
  moduleDisabledDescription: string
  moduleDisabledTitle: string
  nextPage: string
  no: string
  noPrompts: string
  operatorMaintainable: string
  paginationLabel: string
  previousPage: string
  promptImmutableDescription: string
  promptImmutableTitle: string
  promptPurposes: Record<
    'content-generation' | 'conversation-summary' | 'customer-chat' | 'translation',
    string
  >
  promptsTitle: string
  promptStatuses: Record<'active' | 'archived' | 'draft', string>
  readErrorDescription: string
  readErrorTitle: string
  recoveryDescription: string
  recoveryTitle: string
  resetFilters: string
  reviewColumn: string
  reviewLabel: string
  reviewRequired: string
  reviewStatuses: Record<'archived' | 'draft' | 'reviewed', string>
  routeActionRequired: string
  routeReady: string
  routeUnconfigured: string
  searchLabel: string
  searchPlaceholder: string
  selectDocument: string
  sourceTypeLabel: string
  sourceTypes: Record<
    | 'faq'
    | 'other'
    | 'product-manual'
    | 'project-case'
    | 'sales-script'
    | 'technical-specification',
    string
  >
  startIndex: string
  textRoute: string
  title: string
  updatedColumn: string
  visibilityColumn: string
  visibilityLabel: string
  yes: string
  ingestion: {
    adminRetry: string
    arabic: string
    archived: string
    chooseFile: string
    english: string
    errorSummaries: Record<string, string>
    failed: string
    file: string
    imageCount: string
    language: string
    needsReview: string
    nextPage: string
    noSources: string
    originalLanguage: string
    outputDrafts: string
    pageLabel: string
    previousPage: string
    processing: string
    queued: string
    retry: string
    retryError: string
    retrySuccess: string
    riskTopics: Record<
      | 'certification'
      | 'customs'
      | 'discount'
      | 'fire-performance'
      | 'freight'
      | 'insurance'
      | 'lead-time'
      | 'liability'
      | 'lifespan'
      | 'payment'
      | 'price'
      | 'structural-performance'
      | 'warranty',
      string
    >
    riskWarning: string
    sourceTitle: string
    sourceCountLabel: string
    sourcePagination: string
    sourceType: string
    sourceVersion: string
    submit: string
    stages: Record<'complete' | 'finalizing' | 'parsing' | 'queued' | 'translating', string>
    title: string
    uploadDescription: string
    uploadError: string
    uploadSuccess: string
  }
}

export interface PortalMessages {
  modules: Record<PortalModuleLabelKey, string>
  navGroups: Record<PortalNavGroup, string>
  states: Record<PortalStateKey, string>
  nextSteps: Record<PortalNextStepKey, string>
  knowledgeWorkspace: PortalKnowledgeMessages
  overview: PortalOverviewMessages
  mediaWorkspace: PortalMediaMessages
  settings: PortalSettingsMessages
  shell: PortalShellMessages
  websiteContent: PortalWebsiteContentMessages
}
