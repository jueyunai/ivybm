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
import { AiModelProfiles } from './collections/AiModelProfiles'
import { AiProviders } from './collections/AiProviders'
import { AiUsageLogs } from './collections/AiUsageLogs'
import { AiUsageRoutes } from './collections/AiUsageRoutes'
import { Downloads } from './collections/Downloads'
import { Conversations } from './collections/Conversations'
import { ConversationCommands } from './collections/ConversationCommands'
import { Handoffs } from './collections/Handoffs'
import { Jobs } from './collections/Jobs'
import { KnowledgeChunks } from './collections/KnowledgeChunks'
import { KnowledgeDocuments } from './collections/KnowledgeDocuments'
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
      views: {
        dashboard: {
          Component: '/admin/views/OperationsDashboard',
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
    Pages,
    ProductCategories,
    Products,
    Projects,
    Posts,
    Downloads,
    KnowledgeDocuments,
    KnowledgeChunks,
    PromptTemplates,
    PlatformAccounts,
    LeadSources,
    Leads,
    VisitorSessions,
    Conversations,
    Messages,
    Handoffs,
    ConversationCommands,
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
      fileSize: 20 * 1024 * 1024,
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
