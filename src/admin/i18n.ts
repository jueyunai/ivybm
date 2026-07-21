export type AdminLocale = 'en' | 'zh'

type AdminCopy = {
  activeConversations: string
  conversations: string
  dashboardDescription: string
  dashboardTitle: string
  emptyUrgentItems: string
  failedJobs: string
  handoffRequested: string
  leads: string
  navHeading: string
  newQualifiedLeads: string
  openQueue: string
  queuesHeading: string
  roleAdmin: string
  roleOperator: string
  roleSales: string
  taskNavLabel: string
  urgentConversation: (reference: string) => string
  urgentHeading: string
  urgentJob: (reference: string) => string
  urgentLead: (reference: string) => string
  updatedAt: string
  workspace: string
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
    conversations: '会话中心',
    dashboardDescription: '仅展示在当前权限范围内需要关注的运营事项。',
    dashboardTitle: '今日运营要务',
    emptyUrgentItems: '当前没有需要立即处理的事项。',
    failedJobs: '失败任务',
    handoffRequested: '等待人工接管',
    leads: '线索队列',
    navHeading: '任务工作台',
    newQualifiedLeads: '新增高意向线索',
    openQueue: '查看队列',
    queuesHeading: '待处理队列',
    roleAdmin: '管理员',
    roleOperator: '运营人员',
    roleSales: '销售人员',
    status: {
      failed: '失败',
      handoffRequested: '等待人工接管',
      highIntent: '高意向',
    },
    taskNavLabel: '任务快捷导航',
    urgentConversation: (reference) => `会话 ${reference}`,
    urgentHeading: '需要优先关注',
    urgentJob: (reference) => `任务 ${reference}`,
    urgentLead: (reference) => `线索 #${reference}`,
    updatedAt: '更新时间',
    workspace: '运营总览',
    workspaceDescription: '人工接管、线索和系统异常集中处理。',
    workspaceNav: '运营总览',
  },
  en: {
    activeConversations: 'Human-active conversations',
    conversations: 'Conversation center',
    dashboardDescription:
      'Only operational work that is visible within your current permissions is shown.',
    dashboardTitle: "Today's operations",
    emptyUrgentItems: 'There are no items requiring immediate attention.',
    failedJobs: 'Failed jobs',
    handoffRequested: 'Handoff requests',
    leads: 'Lead queue',
    navHeading: 'Task workspace',
    newQualifiedLeads: 'New qualified leads',
    openQueue: 'Open queue',
    queuesHeading: 'Action queues',
    roleAdmin: 'Administrator',
    roleOperator: 'Operator',
    roleSales: 'Sales',
    status: {
      failed: 'Failed',
      handoffRequested: 'Handoff requested',
      highIntent: 'High intent',
    },
    taskNavLabel: 'Task shortcuts',
    urgentConversation: (reference) => `Conversation ${reference}`,
    urgentHeading: 'Needs attention',
    urgentJob: (reference) => `Job ${reference}`,
    urgentLead: (reference) => `Lead #${reference}`,
    updatedAt: 'Updated',
    workspace: 'Operations overview',
    workspaceDescription: 'One place for handoffs, leads, and system exceptions.',
    workspaceNav: 'Operations overview',
  },
}

export type TaskNavLabelKey = 'conversations' | 'leads' | 'workspaceNav'

export const TASK_NAV_ITEMS: ReadonlyArray<{
  href: string
  labelKey: TaskNavLabelKey
}> = [
  { href: '/admin', labelKey: 'workspaceNav' },
  { href: '/admin/collections/conversations', labelKey: 'conversations' },
  { href: '/admin/collections/leads', labelKey: 'leads' },
]

export const getAdminLocale = (language: string | undefined): AdminLocale =>
  language === 'en' ? 'en' : 'zh'

export const getAdminCopy = (language: string | undefined): AdminCopy =>
  ADMIN_COPY[getAdminLocale(language)]
