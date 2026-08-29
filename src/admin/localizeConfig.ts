import type { CollectionConfig, Field, GlobalConfig } from 'payload'

type AdminText = { en: string; zh: string }
type AdminRecord = Record<string, unknown>

const text = (zh: string, en: string): AdminText => ({ en, zh })

const isRecord = (value: unknown): value is AdminRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const COLLECTION_LABELS: Record<string, { plural: AdminText; singular: AdminText }> = {
  'ai-model-profiles': {
    plural: text('AI 模型配置', 'AI Model Profiles'),
    singular: text('AI 模型配置', 'AI Model Profile'),
  },
  'ai-providers': {
    plural: text('AI 服务商', 'AI Providers'),
    singular: text('AI 服务商', 'AI Provider'),
  },
  'ai-usage-routes': {
    plural: text('AI 场景路由', 'AI Usage Routes'),
    singular: text('AI 场景路由', 'AI Usage Route'),
  },
  'ai-usage-logs': {
    plural: text('AI 用量记录', 'AI Usage Logs'),
    singular: text('AI 用量记录', 'AI Usage Log'),
  },
  'audit-logs': { plural: text('审计日志', 'Audit Logs'), singular: text('审计日志', 'Audit Log') },
  'conversation-commands': {
    plural: text('会话指令', 'Conversation Commands'),
    singular: text('会话指令', 'Conversation Command'),
  },
  conversations: { plural: text('会话', 'Conversations'), singular: text('会话', 'Conversation') },
  'feishu-connections': {
    plural: text('飞书连接', 'Feishu Connections'),
    singular: text('飞书连接', 'Feishu Connection'),
  },
  'feishu-mappings': {
    plural: text('飞书字段映射', 'Feishu Field Mappings'),
    singular: text('飞书字段映射', 'Feishu Field Mapping'),
  },
  downloads: { plural: text('下载资料', 'Downloads'), singular: text('下载资料', 'Download') },
  handoffs: { plural: text('人工接管', 'Handoffs'), singular: text('人工接管', 'Handoff') },
  jobs: { plural: text('任务', 'Jobs'), singular: text('任务', 'Job') },
  'knowledge-chunks': {
    plural: text('知识切片', 'Knowledge Chunks'),
    singular: text('知识切片', 'Knowledge Chunk'),
  },
  'knowledge-documents': {
    plural: text('知识文档', 'Knowledge Documents'),
    singular: text('知识文档', 'Knowledge Document'),
  },
  'knowledge-source-documents': {
    plural: text('知识来源资料', 'Knowledge Source Documents'),
    singular: text('知识来源资料', 'Knowledge Source Document'),
  },
  'knowledge-source-assets': {
    plural: text('知识来源图片', 'Knowledge Source Assets'),
    singular: text('知识来源图片', 'Knowledge Source Asset'),
  },
  'lead-sources': {
    plural: text('线索来源', 'Lead Sources'),
    singular: text('线索来源', 'Lead Source'),
  },
  leads: { plural: text('线索', 'Leads'), singular: text('线索', 'Lead') },
  'lead-attachments': { plural: text('线索附件', 'Lead Attachments'), singular: text('线索附件', 'Lead Attachment') },
  media: { plural: text('媒体素材', 'Media'), singular: text('媒体素材', 'Media Asset') },
  messages: { plural: text('消息', 'Messages'), singular: text('消息', 'Message') },
  pages: { plural: text('页面', 'Pages'), singular: text('页面', 'Page') },
  'platform-accounts': {
    plural: text('平台账号', 'Platform Accounts'),
    singular: text('平台账号', 'Platform Account'),
  },
  posts: { plural: text('文章', 'Posts'), singular: text('文章', 'Post') },
  'product-categories': {
    plural: text('产品分类', 'Product Categories'),
    singular: text('产品分类', 'Product Category'),
  },
  products: { plural: text('产品', 'Products'), singular: text('产品', 'Product') },
  'prompt-templates': {
    plural: text('提示词模板', 'Prompt Templates'),
    singular: text('提示词模板', 'Prompt Template'),
  },
  projects: { plural: text('项目案例', 'Projects'), singular: text('项目案例', 'Project') },
  users: { plural: text('用户', 'Users'), singular: text('用户', 'User') },
  'visitor-sessions': {
    plural: text('访客会话', 'Visitor Sessions'),
    singular: text('访客会话', 'Visitor Session'),
  },
}

const GLOBAL_LABELS: Record<string, AdminText> = {
  'site-settings': text('站点设置', 'Site Settings'),
}

const GROUP_LABELS: Record<string, AdminText> = {
  'AI Management': text('AI 管理', 'AI Management'),
  Conversations: text('会话', 'Conversations'),
  'Knowledge Base': text('知识库', 'Knowledge Base'),
  'Lead Management': text('线索管理', 'Lead Management'),
  Operations: text('运维', 'Operations'),
  'Platform Accounts': text('平台账号', 'Platform Accounts'),
  'Website Content': text('官网内容', 'Website Content'),
  'Website Settings': text('站点设置', 'Website Settings'),
}

const FIELD_LABELS: Record<string, AdminText> = {
  acceptedAt: text('接受时间', 'Accepted At'),
  accessToken: text('访问令牌', 'Access Token'),
  accessTokenConfigured: text('访问令牌已配置', 'Access Token Configured'),
  accountKind: text('账号类型', 'Account Kind'),
  action: text('操作', 'Action'),
  actor: text('操作者', 'Actor'),
  address: text('地址', 'Address'),
  alt: text('替代文本', 'Alt Text'),
  apiKey: text('API 密钥', 'API Key'),
  apiKeyConfigured: text('API 密钥已配置', 'API Key Configured'),
  application: text('应用', 'Application'),
  appId: text('应用 ID', 'App ID'),
  assignedTo: text('负责人', 'Assigned To'),
  attempts: text('尝试次数', 'Attempts'),
  author: text('作者', 'Author'),
  baseURL: text('API 基础地址', 'API Base URL'),
  body: text('正文', 'Body'),
  campaign: text('推广活动', 'Campaign'),
  canonical: text('规范链接', 'Canonical URL'),
  capability: text('能力', 'Capability'),
  capabilities: text('能力状态', 'Capability Status'),
  card: text('卡片图', 'Card Image'),
  category: text('分类', 'Category'),
  channel: text('渠道', 'Channel'),
  citations: text('引用来源', 'Citations'),
  company: text('公司', 'Company'),
  completedAt: text('完成时间', 'Completed At'),
  connectionKey: text('连接标识', 'Connection Key'),
  contact: text('联系方式', 'Contact'),
  content: text('内容', 'Content'),
  conversation: text('会话', 'Conversation'),
  country: text('国家或地区', 'Country / Region'),
  coverImage: text('封面图', 'Cover Image'),
  customerVisible: text('对客户可见', 'Customer Visible'),
  clearAccessToken: text('清除访问令牌', 'Clear Access Token'),
  clearRefreshToken: text('清除刷新令牌', 'Clear Refresh Token'),
  defaultSeo: text('默认 SEO', 'Default SEO'),
  deadAt: text('终止时间', 'Marked Dead At'),
  description: text('描述', 'Description'),
  dimensions: text('向量维度', 'Dimensions'),
  document: text('文档', 'Document'),
  documentId: text('文档 ID', 'Document ID'),
  domainEventId: text('领域事件 ID', 'Domain Event ID'),
  email: text('邮箱', 'Email'),
  embeddedAt: text('向量生成时间', 'Embedded At'),
  embeddingDimensions: text('向量维度', 'Embedding Dimensions'),
  embeddingModel: text('向量模型', 'Embedding Model'),
  enabled: text('启用', 'Enabled'),
  errorCode: text('错误代码', 'Error Code'),
  estimatedCostUSD: text('预估成本（美元）', 'Estimated Cost (USD)'),
  excerpt: text('摘要', 'Excerpt'),
  expiresAt: text('过期时间', 'Expires At'),
  externalAccountId: text('外部账号 ID', 'External Account ID'),
  externalMessageId: text('外部消息 ID', 'External Message ID'),
  externalThreadId: text('外部会话 ID', 'External Thread ID'),
  featuredImage: text('特色图片', 'Featured Image'),
  file: text('文件', 'File'),
  footerText: text('页脚文案', 'Footer Text'),
  gallery: text('图库', 'Gallery'),
  generateSlug: text('自动生成 URL Slug', 'Generate URL Slug'),
  handoffStatus: text('接管状态', 'Handoff Status'),
  heroImage: text('横幅图片', 'Hero Image'),
  idempotencyKey: text('幂等键', 'Idempotency Key'),
  index: text('索引', 'Index'),
  indexStatus: text('索引状态', 'Index Status'),
  indexedAt: text('索引完成时间', 'Indexed At'),
  inputTokens: text('输入 Token', 'Input Tokens'),
  intentLevel: text('意向等级', 'Intent Level'),
  intentScore: text('意向分数', 'Intent Score'),
  interest: text('产品兴趣', 'Product Interest'),
  internalNotes: text('内部备注', 'Internal Notes'),
  isActive: text('已启用', 'Active'),
  isPublic: text('公开可见', 'Publicly Visible'),
  key: text('键', 'Key'),
  keywords: text('关键词', 'Keywords'),
  label: text('标签', 'Label'),
  large: text('大图', 'Large Image'),
  lastError: text('最后错误', 'Last Error'),
  lastMessageAt: text('最近消息时间', 'Last Message At'),
  lastSeenAt: text('最近查看时间', 'Last Seen At'),
  lead: text('线索', 'Lead'),
  leaseExpiresAt: text('租约过期时间', 'Lease Expires At'),
  locale: text('内容语言', 'Content Locale'),
  location: text('地址', 'Location'),
  logo: text('标志', 'Logo'),
  manualRetryCount: text('手动重试次数', 'Manual Retry Count'),
  messagingInbound: text('入站消息', 'Inbound Messaging'),
  maxAttempts: text('最大尝试次数', 'Maximum Attempts'),
  maxOutputTokens: text('最大输出 Token', 'Maximum Output Tokens'),
  medium: text('中图', 'Medium Image'),
  message: text('消息', 'Message'),
  model: text('模型', 'Model'),
  name: text('名称', 'Name'),
  navigation: text('导航', 'Navigation'),
  nextRunAt: text('下次执行时间', 'Next Run At'),
  noIndex: text('禁止搜索引擎索引', 'No Index'),
  ogImage: text('社交分享图片', 'Open Graph Image'),
  operation: text('操作类型', 'Operation'),
  outputTokens: text('输出 Token', 'Output Tokens'),
  ownerToken: text('所有者令牌', 'Owner Token'),
  page: text('页面', 'Page'),
  parameters: text('参数', 'Parameters'),
  payload: text('负载数据', 'Payload'),
  phone: text('电话', 'Phone'),
  platform: text('平台', 'Platform'),
  platformFamily: text('平台族', 'Platform Family'),
  profile: text('模型配置', 'Model Profile'),
  promptVersion: text('提示词版本', 'Prompt Version'),
  publishing: text('图文发布', 'Publishing'),
  protocol: text('协议', 'Protocol'),
  provider: text('服务商', 'Provider'),
  publicId: text('公开 ID', 'Public ID'),
  publishedAt: text('发布时间', 'Published At'),
  purpose: text('用途', 'Purpose'),
  reason: text('原因', 'Reason'),
  reasoningEffort: text('思考强度', 'Reasoning Effort'),
  reasoningEnabled: text('启用思考', 'Reasoning Enabled'),
  requestId: text('请求 ID', 'Request ID'),
  refreshToken: text('刷新令牌', 'Refresh Token'),
  refreshTokenConfigured: text('刷新令牌已配置', 'Refresh Token Configured'),
  requestedAt: text('请求时间', 'Requested At'),
  requestedBy: text('请求人', 'Requested By'),
  resolvedAt: text('解决时间', 'Resolved At'),
  resource: text('资源', 'Resource'),
  result: text('结果', 'Result'),
  reviewStatus: text('审核状态', 'Review Status'),
  reviewedAt: text('审核时间', 'Reviewed At'),
  reviewedBy: text('审核人', 'Reviewed By'),
  revision: text('修订版本', 'Revision'),
  role: text('角色', 'Role'),
  scope: text('范围', 'Scope'),
  scopes: text('授权范围', 'Authorization Scopes'),
  seo: text('SEO', 'SEO'),
  sessionTokenHash: text('会话令牌哈希', 'Session Token Hash'),
  shortDescription: text('简短描述', 'Short Description'),
  siteDescription: text('站点描述', 'Site Description'),
  siteName: text('站点名称', 'Site Name'),
  slug: text('URL Slug', 'URL Slug'),
  socialLinks: text('社交链接', 'Social Links'),
  sortOrder: text('排序', 'Sort Order'),
  source: text('来源说明', 'Source'),
  sourceFile: text('来源文件', 'Source File'),
  sourceTitle: text('来源标题', 'Source Title'),
  sourceType: text('来源类型', 'Source Type'),
  sourceURL: text('来源链接', 'Source URL'),
  sourceVersion: text('来源版本', 'Source Version'),
  specifications: text('规格参数', 'Specifications'),
  stableId: text('稳定 ID', 'Stable ID'),
  status: text('状态', 'Status'),
  state: text('授权状态', 'Authorization State'),
  summary: text('摘要', 'Summary'),
  temperature: text('温度', 'Temperature'),
  textGenerationContract: text('文本接口契约', 'Text API Contract'),
  template: text('模板', 'Template'),
  term: text('关键词', 'Term'),
  thumbnail: text('缩略图', 'Thumbnail'),
  timeoutMs: text('超时时间（毫秒）', 'Timeout (ms)'),
  title: text('标题', 'Title'),
  tokenUsage: text('Token 用量', 'Token Usage'),
  topP: text('Top-p', 'Top-p'),
  totalTokens: text('总 Token', 'Total Tokens'),
  type: text('类型', 'Type'),
  url: text('链接', 'URL'),
  usageKey: text('场景键', 'Usage Key'),
  utm: text('UTM 参数', 'UTM Parameters'),
  value: text('值', 'Value'),
  variables: text('变量', 'Variables'),
  version: text('版本', 'Version'),
  visitorSession: text('访客会话', 'Visitor Session'),
  whatsapp: text('WhatsApp', 'WhatsApp'),
}

const OPTION_LABELS: Record<string, Record<string, AdminText>> = {
  action: {
    create: text('创建', 'Create'),
    delete: text('删除', 'Delete'),
    login: text('登录', 'Login'),
    update: text('更新', 'Update'),
  },
  accountKind: {
    'facebook-page': text('Facebook 主页', 'Facebook Page'),
    'instagram-professional': text('Instagram 专业账号', 'Instagram Professional Account'),
    'linkedin-member': text('LinkedIn 个人账号', 'LinkedIn Member'),
    'linkedin-organization': text('LinkedIn 企业主页', 'LinkedIn Organization'),
    'tiktok-business': text('TikTok 商业账号', 'TikTok Business Account'),
  },
  author: {
    ai: text('AI', 'AI'),
    operator: text('运营人员', 'Operator'),
    system: text('系统', 'System'),
    visitor: text('访客', 'Visitor'),
  },
  capability: {
    embedding: text('向量', 'Embedding'),
    text: text('文本', 'Text'),
  },
  category: {
    company: text('公司动态', 'Company'),
    industry: text('行业资讯', 'Industry'),
    products: text('产品资讯', 'Products'),
    projects: text('项目案例', 'Projects'),
  },
  channel: {
    'ai-chat': text('AI 聊天', 'AI Chat'),
    facebook: text('Facebook', 'Facebook'),
    instagram: text('Instagram', 'Instagram'),
    manual: text('手动录入', 'Manual Entry'),
    social: text('社交平台', 'Social Platform'),
    website: text('官网', 'Website'),
    whatsapp: text('WhatsApp', 'WhatsApp'),
  },
  handoffStatus: {
    ai_active: text('AI 服务中', 'AI Active'),
    handoff_requested: text('等待人工接管', 'Handoff Requested'),
    human_active: text('人工服务中', 'Human Active'),
    resolved: text('已解决', 'Resolved'),
  },
  indexStatus: {
    failed: text('失败', 'Failed'),
    pending: text('待处理', 'Pending'),
    processing: text('处理中', 'Processing'),
    ready: text('已就绪', 'Ready'),
  },
  intentLevel: {
    a: text('A - 高意向', 'A - High Intent'),
    b: text('B - 中意向', 'B - Medium Intent'),
    c: text('C - 低意向', 'C - Low Intent'),
    unscored: text('未评分', 'Unscored'),
  },
  locale: {
    all: text('全部语言', 'All'),
    ar: text('阿拉伯语', 'Arabic'),
    en: text('英文', 'English'),
  },
  messagingInbound: {
    approved: text('已批准', 'Approved'),
    blocked: text('受阻', 'Blocked'),
    not_started: text('未开始', 'Not Started'),
    pending: text('待审核', 'Pending'),
  },
  operation: {
    embedding: text('向量', 'Embedding'),
    text: text('文本', 'Text'),
  },
  platform: {
    facebook: text('Facebook', 'Facebook'),
    instagram: text('Instagram', 'Instagram'),
    linkedin: text('LinkedIn', 'LinkedIn'),
    other: text('其他', 'Other'),
    tiktok: text('TikTok', 'TikTok'),
    youtube: text('YouTube', 'YouTube'),
  },
  platformFamily: {
    linkedin: text('LinkedIn', 'LinkedIn'),
    meta: text('Meta', 'Meta'),
    tiktok: text('TikTok', 'TikTok'),
  },
  protocol: {
    'openai-compatible': text('兼容 OpenAI 协议', 'OpenAI-compatible'),
  },
  textGenerationContract: {
    'chat-completions': text('Chat Completions', 'Chat Completions'),
    responses: text('Responses', 'Responses'),
  },
  publishing: {
    approved: text('已批准', 'Approved'),
    blocked: text('受阻', 'Blocked'),
    not_started: text('未开始', 'Not Started'),
    pending: text('待审核', 'Pending'),
  },
  purpose: {
    'content-generation': text('内容生成', 'Content Generation'),
    'conversation-summary': text('会话摘要', 'Conversation Summary'),
    'customer-chat': text('客户聊天', 'Customer Chat'),
    translation: text('翻译', 'Translation'),
  },
  reason: {
    ai_policy: text('AI 安全策略', 'AI Policy'),
    operator: text('运营人员', 'Operator'),
    visitor: text('访客请求', 'Visitor Request'),
  },
  reasoningEffort: {
    high: text('高', 'High'),
    low: text('低', 'Low'),
    max: text('最高', 'Max'),
    medium: text('中', 'Medium'),
    minimal: text('最小', 'Minimal'),
    none: text('不使用', 'None'),
    xhigh: text('很高', 'Extra High'),
  },
  reviewStatus: {
    archived: text('已归档', 'Archived'),
    draft: text('草稿', 'Draft'),
    reviewed: text('已审核', 'Reviewed'),
  },
  role: {
    admin: text('管理员', 'Administrator'),
    operator: text('运营人员', 'Operator'),
    sales: text('销售人员', 'Sales'),
  },
  sourceType: {
    faq: text('常见问题', 'FAQ'),
    other: text('其他', 'Other'),
    'product-manual': text('产品手册', 'Product Manual'),
    'project-case': text('项目案例', 'Project Case'),
    'sales-script': text('销售话术', 'Sales Script'),
    'technical-specification': text('技术规范', 'Technical Specification'),
  },
  source: {
    ai_policy: text('AI 安全策略', 'AI Policy'),
    operator: text('运营人员', 'Operator'),
    visitor: text('访客请求', 'Visitor Request'),
  },
  status: {
    active: text('启用', 'Active'),
    archived: text('已归档', 'Archived'),
    completed: text('已完成', 'Completed'),
    contacted: text('已联系', 'Contacted'),
    dead: text('已终止', 'Dead'),
    disqualified: text('不合格', 'Disqualified'),
    draft: text('草稿', 'Draft'),
    failed: text('失败', 'Failed'),
    new: text('新建', 'New'),
    pending: text('待处理', 'Pending'),
    processing: text('处理中', 'Processing'),
    qualified: text('已确认', 'Qualified'),
    requested: text('已请求', 'Requested'),
    resolved: text('已解决', 'Resolved'),
    sent: text('已发送', 'Sent'),
    succeeded: text('成功', 'Succeeded'),
  },
  state: {
    blocked: text('受阻', 'Blocked'),
    connected: text('已连接', 'Connected'),
    disabled: text('已停用', 'Disabled'),
    expired: text('已过期', 'Expired'),
    not_started: text('未开始', 'Not Started'),
    pending: text('待授权', 'Pending Authorization'),
  },
  type: {
    catalog: text('产品目录', 'Catalog'),
    certificate: text('证书', 'Certificate'),
    other: text('其他', 'Other'),
    'technical-data': text('技术资料', 'Technical Data'),
  },
}

const DESCRIPTION_BY_PATH: Record<string, AdminText> = {
  'ai-model-profiles.model': text(
    '所选服务商接受的准确模型标识。',
    'Exact model identifier accepted by the selected provider.',
  ),
  'ai-model-profiles.parameters.temperature': text(
    '可选采样温度，范围为 0 到 2。',
    'Optional sampling temperature, from 0 to 2.',
  ),
  'ai-model-profiles.parameters.topP': text(
    '可选核采样 top-p 值，范围为 0 到 1。',
    'Optional nucleus-sampling top-p value, from 0 to 1.',
  ),
  'ai-providers.apiKey': text(
    '只写字段。输入值可设置或替换密钥；留空将保留现有密钥。',
    'Write-only. Enter a value to set or replace the key; leave blank to retain it.',
  ),
  'ai-providers.apiKeyConfigured': text(
    '此状态不会显示密钥内容。',
    'This indicator never reveals the key.',
  ),
  'ai-providers.baseURL': text(
    '请输入包含 API 版本前缀的端点，例如 https://api.openai.com/v1。',
    'Include the API version prefix, for example https://api.openai.com/v1.',
  ),
  'ai-providers.textGenerationContract': text(
    '请选择供应商实际支持的文本端点；系统不会自动猜测或降级。',
    'Select the exact text endpoint exposed by the provider; the system never guesses or falls back.',
  ),
  'ai-usage-routes.usageKey': text(
    '稳定的内部场景键，例如 chat.reply 或 knowledge.embedding。',
    'Stable internal key, for example chat.reply or knowledge.embedding.',
  ),
  'platform-accounts.authorization.accessToken': text(
    '只写字段。输入值可设置或替换令牌；留空将保留现有令牌。',
    'Write-only. Enter a value to set or replace the token; leave blank to retain it.',
  ),
  'platform-accounts.authorization.accessTokenConfigured': text(
    '此状态不会显示令牌内容。',
    'This indicator never reveals the token.',
  ),
  'platform-accounts.authorization.appId': text(
    '仅填写非敏感的提供方应用 ID，绝不可填写 App Secret 或 Client Secret。',
    'Non-secret provider application ID only. Never enter an App Secret or Client Secret here.',
  ),
  'platform-accounts.authorization.clearAccessToken': text(
    '仅在撤销凭据时使用；已连接账号无法在没有访问令牌的情况下保存。',
    'Use only when revoking a credential. A connected account cannot be saved without a token.',
  ),
  'platform-accounts.authorization.refreshToken': text(
    '只写字段。输入值可设置或替换刷新令牌；留空将保留现有令牌。',
    'Write-only. Enter a value to set or replace the refresh token; leave blank to retain it.',
  ),
  'platform-accounts.externalAccountId': text(
    '填写提供方侧的主页、专业账号、成员或组织 ID；未知时可暂时留空。',
    'Provider-side Page, professional account, member, or organization identifier. Leave blank until known.',
  ),
  'knowledge-documents.customerVisible': text(
    '只有已审核、已索引且勾选此项的文档可用于官网聊天。',
    'Only reviewed, indexed documents marked here may be used by the public website chat.',
  ),
  'lead-sources.key': text(
    '稳定的集成键。请新建来源，不要重命名此值。',
    'Stable integration key. Create a new source instead of renaming this value.',
  ),
  'media.isPublic': text(
    '允许匿名官网访客读取和下载此素材。',
    'Allow anonymous website visitors to read and download this asset.',
  ),
  'media.source': text(
    '此素材的版权方、许可或来源说明。',
    'Copyright owner, license, or source reference for this asset.',
  ),
}

const SHARED_DESCRIPTION_BY_PATH: Record<string, AdminText> = {
  generateSlug: text(
    '启用后，系统会在保存或自动保存时根据标题字段自动生成 URL Slug。',
    'When enabled, the slug will auto-generate from the title field on save and autosave.',
  ),
  canonical: text('此语言版本可选的规范链接。', 'Optional canonical URL for this locale.'),
  keywords: text(
    '以逗号分隔的搜索与内容规划关键词。',
    'Comma-separated keywords for search and content planning.',
  ),
  internalNotes: text(
    '仅供内部备注，不会显示在官网。',
    'Internal notes only. Not rendered on the public website.',
  ),
  slug: text(
    '所有内容语言共用的稳定 URL slug。请使用拉丁字母、数字和连字符。',
    'Stable URL slug shared by all locales. Use Latin letters, numbers, and hyphens.',
  ),
}

const getDescription = (entity: string, path: string): AdminText | undefined => {
  const sharedPath = Object.keys(SHARED_DESCRIPTION_BY_PATH).find(
    (candidate) => path === candidate || path.endsWith(`.${candidate}`),
  )

  return (
    DESCRIPTION_BY_PATH[`${entity}.${path}`] ??
    (sharedPath ? SHARED_DESCRIPTION_BY_PATH[sharedPath] : undefined)
  )
}

const localizeOptions = (options: unknown, name: string): unknown => {
  if (!Array.isArray(options)) return options

  const labels = OPTION_LABELS[name]
  if (!labels) return options

  return options.map((option) => {
    if (typeof option === 'string') {
      const label = labels[option]
      return label ? { label, value: option } : option
    }
    if (!isRecord(option) || typeof option.value !== 'string') return option

    const label = labels[option.value]
    return label ? { ...option, label } : option
  })
}

const localizeFields = (fields: Field[], entity: string, parentPath = ''): Field[] =>
  fields.map((field) => {
    const localized = { ...field } as AdminRecord
    const name = typeof localized.name === 'string' ? localized.name : undefined
    const path = name ? (parentPath ? `${parentPath}.${name}` : name) : parentPath

    if (name && localized.label !== false && FIELD_LABELS[name]) {
      localized.label = FIELD_LABELS[name]
    }
    if (name && Array.isArray(localized.options)) {
      localized.options = localizeOptions(localized.options, name)
    }

    const description = getDescription(entity, path)
    if (description && isRecord(localized.admin)) {
      localized.admin = { ...localized.admin, description }
    }
    if (Array.isArray(localized.fields)) {
      localized.fields = localizeFields(localized.fields as Field[], entity, path)
    }
    if (Array.isArray(localized.tabs)) {
      localized.tabs = localized.tabs.map((tab) =>
        isRecord(tab) && Array.isArray(tab.fields)
          ? { ...tab, fields: localizeFields(tab.fields as Field[], entity, path) }
          : tab,
      )
    }
    if (Array.isArray(localized.blocks)) {
      localized.blocks = localized.blocks.map((block) =>
        isRecord(block) && Array.isArray(block.fields)
          ? { ...block, fields: localizeFields(block.fields as Field[], entity, path) }
          : block,
      )
    }

    return localized as Field
  })

const localizeAdminGroup = (admin: unknown): unknown => {
  if (!isRecord(admin) || typeof admin.group !== 'string') return admin

  return { ...admin, group: GROUP_LABELS[admin.group] ?? admin.group }
}

export const localizeAdminCollections = (collections: CollectionConfig[]): CollectionConfig[] =>
  collections.map((collection) => {
    const labels = COLLECTION_LABELS[collection.slug]

    return {
      ...collection,
      ...(labels ? { labels: { ...collection.labels, ...labels } } : {}),
      admin: localizeAdminGroup(collection.admin) as CollectionConfig['admin'],
      fields: localizeFields(collection.fields, collection.slug),
    }
  })

export const localizeAdminGlobals = (globals: GlobalConfig[]): GlobalConfig[] =>
  globals.map((global) => ({
    ...global,
    ...(GLOBAL_LABELS[global.slug] ? { label: GLOBAL_LABELS[global.slug] } : {}),
    admin: localizeAdminGroup(global.admin) as GlobalConfig['admin'],
    fields: localizeFields(global.fields, global.slug),
  }))
