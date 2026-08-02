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
  knowledge: {
    accessDenied: string
    citationsTitle: string
    handoffDefault: string
    handoffReasons: Record<string, string>
    handoffTitle: string
    indexDescription: string
    indexFailed: string
    indexReady: string
    indexReasons: Record<string, string>
    indexTitle: string
    jobAlreadyQueued: string
    jobQueued: string
    localeLabel: string
    modelLabel: string
    openJob: string
    playgroundDescription: string
    playgroundEyebrow: string
    playgroundNav: string
    playgroundTitle: string
    preview: string
    previewFailed: string
    previewing: string
    processing: string
    pollingTimedOut: string
    promptVersionLabel: string
    queryLabel: string
    queryPlaceholder: string
    rateLimited: string
    refreshFailed: string
    reindex: string
    resultEmpty: string
    resultTitle: string
    retry: string
    reviewRequired: string
    submitFailed: string
    submitIndex: string
    tokensLabel: string
    waitingForWorker: string
  }
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
  signingOut: string
  signOutError: string
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
    knowledge: {
      accessDenied: '只有管理员和运营人员可以使用知识问答测试。',
      citationsTitle: '命中知识',
      handoffDefault: '当前问题需要转人工处理。',
      handoffReasons: {
        high_risk_topic: '问题涉及价格、交期、付款、认证或质保等高风险主题。',
        reviewed_knowledge_unavailable: '没有可用的已审核知识或 Active 客服提示词。',
      },
      handoffTitle: '按正式规则转人工',
      indexDescription: '索引使用当前已保存、已审核的文档版本。',
      indexFailed: '索引失败，请检查任务详情后由管理员重试。',
      indexReady: '索引完成，文档已经可以参与知识检索。',
      indexReasons: {
        admin_retry_required: '失败任务只能由管理员重新启用。',
        processing: 'worker 正在处理当前文档。',
        review_required: '先把审核状态改为“已审核”并保存。',
        save_changes: '先保存当前修改，再提交索引。',
        save_document: '先保存新文档，再提交索引。',
      },
      indexTitle: '知识索引',
      jobAlreadyQueued: '相同文档版本已经有索引任务。',
      jobQueued: '索引任务已提交。',
      localeLabel: '问题语言',
      modelLabel: '模型',
      openJob: '查看任务',
      playgroundDescription: '使用与官网客服相同的知识可见性、提示词和转人工规则进行验收。',
      playgroundEyebrow: '知识库验收',
      playgroundNav: '知识问答测试',
      playgroundTitle: '知识问答测试',
      preview: '测试回答',
      previewFailed: '知识问答测试暂时不可用。',
      previewing: '正在检索并生成…',
      processing: '索引处理中',
      pollingTimedOut: '任务仍在后台运行，请稍后刷新页面查看结果。',
      promptVersionLabel: '提示词版本',
      queryLabel: '客户问题',
      queryPlaceholder: '输入需要验收的英文或阿语问题',
      rateLimited: '请求过于频繁，请稍后再试。',
      refreshFailed: '任务已提交，但状态刷新失败，请手动刷新页面。',
      reindex: '重新索引',
      resultEmpty: '提交问题后，这里会显示回答、转人工原因和命中知识。',
      resultTitle: '验收结果',
      retry: '重试索引',
      reviewRequired: '只有已审核文档可以索引。',
      submitFailed: '索引任务提交失败，请稍后重试。',
      submitIndex: '提交索引',
      tokensLabel: 'Token 总量',
      waitingForWorker: '任务已提交，正在等待 worker 完成。',
    },
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
    signingOut: '正在退出…',
    signOutError: '退出失败，请重试。',
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
    knowledge: {
      accessDenied: 'Only administrators and operators can use knowledge preview.',
      citationsTitle: 'Knowledge citations',
      handoffDefault: 'This question requires human follow-up.',
      handoffReasons: {
        high_risk_topic: 'The question involves pricing, delivery, payment, certification, or warranty.',
        reviewed_knowledge_unavailable: 'No reviewed knowledge or active customer-chat prompt is available.',
      },
      handoffTitle: 'Handoff under production rules',
      indexDescription: 'Indexing uses the currently saved and reviewed document revision.',
      indexFailed: 'Indexing failed. Review the job before an administrator retries it.',
      indexReady: 'Indexing completed. The document can now participate in retrieval.',
      indexReasons: {
        admin_retry_required: 'Only an administrator can re-arm a failed job.',
        processing: 'The worker is processing this document.',
        review_required: 'Set the review status to Reviewed and save first.',
        save_changes: 'Save the current changes before indexing.',
        save_document: 'Save the new document before indexing.',
      },
      indexTitle: 'Knowledge indexing',
      jobAlreadyQueued: 'This document revision already has an indexing job.',
      jobQueued: 'The indexing job was submitted.',
      localeLabel: 'Question language',
      modelLabel: 'Model',
      openJob: 'Open job',
      playgroundDescription: 'Validate answers with the same visibility, prompt, and handoff rules as website chat.',
      playgroundEyebrow: 'Knowledge acceptance',
      playgroundNav: 'Knowledge Q&A test',
      playgroundTitle: 'Knowledge Q&A test',
      preview: 'Test answer',
      previewFailed: 'Knowledge preview is temporarily unavailable.',
      previewing: 'Retrieving and generating…',
      processing: 'Indexing',
      pollingTimedOut: 'The job is still running. Refresh the page later to check the result.',
      promptVersionLabel: 'Prompt version',
      queryLabel: 'Customer question',
      queryPlaceholder: 'Enter an English or Arabic acceptance question',
      rateLimited: 'Too many requests. Please try again later.',
      refreshFailed: 'The job was submitted, but status refresh failed. Refresh the page manually.',
      reindex: 'Re-index',
      resultEmpty: 'Submit a question to see the answer, handoff reason, and citations.',
      resultTitle: 'Acceptance result',
      retry: 'Retry indexing',
      reviewRequired: 'Only reviewed documents can be indexed.',
      submitFailed: 'The indexing job could not be submitted. Please try again.',
      submitIndex: 'Submit indexing',
      tokensLabel: 'Total tokens',
      waitingForWorker: 'The job was submitted and is waiting for the worker.',
    },
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
    signingOut: 'Signing out…',
    signOutError: 'Sign out failed. Please try again.',
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
