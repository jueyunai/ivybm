const jobTypeLabels = {
  en: {
    'feishu.connection.provision': 'Feishu Connection Setup',
    'feishu.handoff.notify': 'Feishu Handoff Notice',
    'feishu.lead.followup.reminder': 'Feishu Follow-up Reminder',
    'feishu.lead.sync': 'Feishu Lead Sync',
    'feishu.lead.sync.failure.notify': 'Feishu Sync Failure Notice',
    'knowledge.index': 'Knowledge Vector Indexing',
    'knowledge.ingest': 'Knowledge Document Ingestion',
    'platform.conversation.deliver': 'Social Message Delivery',
    'platform.event.dispatch': 'Social Event Dispatch',
    'platform.publication.execute': 'Social Content Publishing',
  },
  zh: {
    'feishu.connection.provision': '飞书连接配置',
    'feishu.handoff.notify': '飞书接管提醒通知',
    'feishu.lead.followup.reminder': '飞书线索跟进提醒',
    'feishu.lead.sync': '飞书线索同步',
    'feishu.lead.sync.failure.notify': '飞书同步失败提醒',
    'knowledge.index': '知识库向量索引',
    'knowledge.ingest': '知识库文档解析',
    'platform.conversation.deliver': '社媒消息发送',
    'platform.event.dispatch': '社媒事件分发',
    'platform.publication.execute': '社媒内容发布',
  },
} as const

export const formatJobTypeLabel = (type: string, locale: 'en' | 'zh' = 'zh'): string =>
  jobTypeLabels[locale][type.toLowerCase() as keyof (typeof jobTypeLabels)[typeof locale]] ??
  (locale === 'zh' ? '后台任务' : 'Background task')
