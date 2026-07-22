export type AdminLocale = 'en' | 'zh'

export type AdminCopy = {
  activeConversations: string
  account: string
  brandKicker: string
  closeNavigation: string
  conversations: string
  dashboardDescription: string
  dashboardTitle: string
  emptyUrgentItems: string
  failedJobs: string
  handoffRequested: string
  leads: string
  navHeading: string
  newQualifiedLeads: string
  navSections: {
    content: string
    intelligence: string
    operations: string
    system: string
    workspace: string
  }
  openQueue: string
  queuesHeading: string
  roleAdmin: string
  roleOperator: string
  roleSales: string
  signOut: string
  urgentConversation: (reference: string) => string
  urgentHeading: string
  urgentJob: (reference: string) => string
  urgentLead: (reference: string) => string
  updatedAt: string
  workspaceDescription: string
  workspaceNav: string
  status: {
    failed: string
    handoffRequested: string
    highIntent: string
  }
}

export const ADMIN_COPY: Record<AdminLocale, AdminCopy> = {
  zh: {
    activeConversations: '人工服务中',
    account: '账户设置',
    brandKicker: 'AI 获客运营后台',
    closeNavigation: '关闭菜单',
    conversations: '会话中心',
    dashboardDescription: '仅展示在当前权限范围内需要关注的运营事项。',
    dashboardTitle: '今日运营要务',
    emptyUrgentItems: '当前没有需要立即处理的事项。',
    failedJobs: '失败任务',
    handoffRequested: '等待人工接管',
    leads: '线索队列',
    navHeading: '任务工作台',
    navSections: {
      content: '官网内容',
      intelligence: '知识库与 AI',
      operations: '运营记录',
      system: '系统与设置',
      workspace: '工作台',
    },
    newQualifiedLeads: '新增高意向线索',
    openQueue: '查看队列',
    queuesHeading: '待处理队列',
    roleAdmin: '管理员',
    roleOperator: '运营人员',
    roleSales: '销售人员',
    signOut: '退出登录',
    status: {
      failed: '失败',
      handoffRequested: '等待人工接管',
      highIntent: '高意向',
    },
    urgentConversation: (reference) => `会话 ${reference}`,
    urgentHeading: '需要优先关注',
    urgentJob: (reference) => `任务 ${reference}`,
    urgentLead: (reference) => `线索 #${reference}`,
    updatedAt: '更新时间',
    workspaceDescription: '人工接管、线索和系统异常集中处理。',
    workspaceNav: '运营总览',
  },
  en: {
    activeConversations: 'Human-active conversations',
    account: 'Account settings',
    brandKicker: 'AI acquisition operations',
    closeNavigation: 'Close menu',
    conversations: 'Conversation center',
    dashboardDescription:
      'Only operational work that is visible within your current permissions is shown.',
    dashboardTitle: "Today's operations",
    emptyUrgentItems: 'There are no items requiring immediate attention.',
    failedJobs: 'Failed jobs',
    handoffRequested: 'Handoff requests',
    leads: 'Lead queue',
    navHeading: 'Task workspace',
    navSections: {
      content: 'Website content',
      intelligence: 'Knowledge and AI',
      operations: 'Operational records',
      system: 'System and settings',
      workspace: 'Workspace',
    },
    newQualifiedLeads: 'New qualified leads',
    openQueue: 'Open queue',
    queuesHeading: 'Action queues',
    roleAdmin: 'Administrator',
    roleOperator: 'Operator',
    roleSales: 'Sales',
    signOut: 'Sign out',
    status: {
      failed: 'Failed',
      handoffRequested: 'Handoff requested',
      highIntent: 'High intent',
    },
    urgentConversation: (reference) => `Conversation ${reference}`,
    urgentHeading: 'Needs attention',
    urgentJob: (reference) => `Job ${reference}`,
    urgentLead: (reference) => `Lead #${reference}`,
    updatedAt: 'Updated',
    workspaceDescription: 'One place for handoffs, leads, and system exceptions.',
    workspaceNav: 'Operations overview',
  },
}

export const getAdminLocale = (language: string | undefined): AdminLocale =>
  language === 'en' ? 'en' : 'zh'

export const getAdminCopy = (language: string | undefined): AdminCopy =>
  ADMIN_COPY[getAdminLocale(language)]
