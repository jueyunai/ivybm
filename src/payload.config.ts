import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { en } from 'payload/i18n/en'
import { zh } from 'payload/i18n/zh'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { localizeAdminCollections, localizeAdminGlobals } from './admin/localizeConfig'
import { AuditLogs } from './collections/AuditLogs'
import { ContentReviews } from './collections/ContentReviews'
import { AiModelProfiles } from './collections/AiModelProfiles'
import { AiProviders } from './collections/AiProviders'
import { AiUsageLogs } from './collections/AiUsageLogs'
import { AiUsageRoutes } from './collections/AiUsageRoutes'
import { Downloads } from './collections/Downloads'
import { GeneratedContents } from './collections/GeneratedContents'
import { FeishuConnections } from './collections/FeishuConnections'
import { FeishuAppRegistrations } from './collections/FeishuAppRegistrations'
import { FeishuMappings } from './collections/FeishuMappings'
import { FeishuOAuthStates } from './collections/FeishuOAuthStates'
import { Conversations } from './collections/Conversations'
import { ConversationCommands } from './collections/ConversationCommands'
import { ConversationDeliveryIntents } from './collections/ConversationDeliveryIntents'
import { Handoffs } from './collections/Handoffs'
import { Jobs } from './collections/Jobs'
import { KnowledgeChunks } from './collections/KnowledgeChunks'
import { KnowledgeDocuments } from './collections/KnowledgeDocuments'
import { KnowledgeSourceAssets } from './collections/KnowledgeSourceAssets'
import { KnowledgeSourceDocuments } from './collections/KnowledgeSourceDocuments'
import { Leads } from './collections/Leads'
import { LeadSources } from './collections/LeadSources'
import { Media } from './collections/Media'
import { Messages } from './collections/Messages'
import { Pages } from './collections/Pages'
import { Posts } from './collections/Posts'
import { ProductCategories } from './collections/ProductCategories'
import { Products } from './collections/Products'
import { PromptTemplates } from './collections/PromptTemplates'
import { Projects } from './collections/Projects'
import { PlatformAccounts } from './collections/PlatformAccounts'
import { PortalCommandReceipts } from './collections/PortalCommandReceipts'
import { PublishJobs } from './collections/PublishJobs'
import { PublishLogs } from './collections/PublishLogs'
import { Users } from './collections/Users'
import { VisitorSessions } from './collections/VisitorSessions'
import { SiteSettings } from './globals/SiteSettings'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const payloadSecret = process.env.PAYLOAD_SECRET

if (process.env.NODE_ENV === 'production' && (!payloadSecret || payloadSecret.length < 32)) {
  throw new Error('PAYLOAD_SECRET must contain at least 32 characters in production')
}

export default buildConfig({
  admin: {
    components: {
      Nav: '/admin/components/OperationsNav',
      actions: ['/admin/components/AdminAccountMenu'],
      views: {
        dashboard: {
          Component: '/admin/views/OperationsDashboard',
        },
        feishu: {
          Component: '/admin/views/FeishuIntegration',
          path: '/feishu',
        },
        knowledgePlayground: {
          Component: '/admin/views/KnowledgePlayground',
          exact: true,
          path: '/knowledge-playground',
        },
      },
    },
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: localizeAdminCollections([
    Users,
    Media,
    AuditLogs,
    AiProviders,
    AiModelProfiles,
    AiUsageRoutes,
    AiUsageLogs,
    GeneratedContents,
    ContentReviews,
    PublishJobs,
    PublishLogs,
    Pages,
    ProductCategories,
    Products,
    Projects,
    Posts,
    Downloads,
    KnowledgeDocuments,
    KnowledgeSourceDocuments,
    KnowledgeSourceAssets,
    KnowledgeChunks,
    PromptTemplates,
    PlatformAccounts,
    PortalCommandReceipts,
    LeadSources,
    Leads,
    FeishuConnections,
    FeishuAppRegistrations,
    FeishuMappings,
    FeishuOAuthStates,
    VisitorSessions,
    Conversations,
    Messages,
    Handoffs,
    ConversationCommands,
    ConversationDeliveryIntents,
    Jobs,
  ]),
  editor: lexicalEditor(),
  globals: localizeAdminGlobals([SiteSettings]),
  i18n: {
    fallbackLanguage: 'zh',
    supportedLanguages: { zh, en },
  },
  localization: {
    defaultLocale: 'en',
    fallback: true,
    locales: [
      { code: 'en', label: 'English' },
      { code: 'ar', label: 'العربية', rtl: true },
    ],
  },
  secret: payloadSecret || 'local-development-only-secret-change-me',
  upload: {
    abortOnLimit: true,
    limits: {
      fileSize: 30 * 1024 * 1024,
      files: 1,
    },
    responseOnLimit: 'File size limit has been reached.',
  },
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    extensions: ['vector'],
    migrationDir: path.resolve(dirname, 'migrations'),
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
    push: false,
  }),
  sharp,
  plugins: [],
})
