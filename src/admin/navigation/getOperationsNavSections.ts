import type { ClientConfig, SanitizedPermissions } from 'payload'

import type { AdminCopy, AdminLocale } from '../i18n'

export type OperationsNavSectionId =
  'workspace' | 'content' | 'intelligence' | 'operations' | 'system'

export type OperationsNavItem = {
  href: string
  id: string
  label: string
}

export type OperationsNavSection = {
  id: OperationsNavSectionId
  items: OperationsNavItem[]
  label: string
}

const WORKSPACE_COLLECTIONS = new Set(['conversations', 'leads'])

const CONTENT_COLLECTIONS = new Set([
  'media',
  'pages',
  'product-categories',
  'products',
  'projects',
  'posts',
  'downloads',
])

const INTELLIGENCE_COLLECTIONS = new Set([
  'ai-providers',
  'ai-model-profiles',
  'ai-usage-routes',
  'knowledge-documents',
  'knowledge-chunks',
  'prompt-templates',
])

const OPERATIONS_COLLECTIONS = new Set([
  'audit-logs',
  'handoffs',
  'jobs',
  'lead-sources',
  'messages',
  'platform-accounts',
  'visitor-sessions',
])

const INTERNAL_COLLECTIONS = new Set(['payload-locked-documents', 'payload-migrations'])

const SECTION_ORDER: OperationsNavSectionId[] = [
  'workspace',
  'content',
  'intelligence',
  'operations',
  'system',
]

const getLocalizedLabel = (
  value: Record<string, string> | string,
  language: AdminLocale,
): string => {
  if (typeof value === 'string') return value

  return value[language] ?? value.en ?? value.zh ?? Object.values(value)[0] ?? ''
}

const getCollectionSection = ({
  group,
  slug,
}: {
  group: string | undefined
  slug: string
}): OperationsNavSectionId => {
  if (WORKSPACE_COLLECTIONS.has(slug)) return 'workspace'
  if (CONTENT_COLLECTIONS.has(slug) || group === 'Website Content' || group === '官网内容')
    return 'content'
  if (
    INTELLIGENCE_COLLECTIONS.has(slug) ||
    group === 'AI Management' ||
    group === 'AI 管理' ||
    group === 'Knowledge Base' ||
    group === '知识库'
  )
    return 'intelligence'
  if (
    OPERATIONS_COLLECTIONS.has(slug) ||
    group === 'Conversations' ||
    group === '会话' ||
    group === 'Lead Management' ||
    group === '线索管理' ||
    group === 'Operations' ||
    group === '运维'
  )
    return 'operations'

  return 'system'
}

const canReadCollection = (permissions: SanitizedPermissions | undefined, slug: string): boolean =>
  permissions?.collections?.[slug]?.read === true

const canReadGlobal = (permissions: SanitizedPermissions | undefined, slug: string): boolean =>
  permissions?.globals?.[slug]?.read === true

export const getOperationsNavSections = ({
  config,
  copy,
  language,
  permissions,
}: {
  config: ClientConfig
  copy: AdminCopy
  language: AdminLocale
  permissions: SanitizedPermissions | undefined
}): OperationsNavSection[] => {
  const sections = new Map<OperationsNavSectionId, OperationsNavSection>(
    SECTION_ORDER.map((id) => [
      id,
      {
        id,
        items: [],
        label: copy.navSections[id],
      },
    ]),
  )
  const workspace = sections.get('workspace')

  if (workspace) {
    workspace.items.push({
      href: '/admin',
      id: 'workspace:overview',
      label: copy.workspaceNav,
    })
  }

  if (canReadCollection(permissions, 'knowledge-documents')) {
    sections.get('intelligence')?.items.push({
      href: '/admin/knowledge-playground',
      id: 'workspace:knowledge-playground',
      label: copy.knowledge.playgroundNav,
    })
  }

  for (const collection of config.collections) {
    if (
      INTERNAL_COLLECTIONS.has(collection.slug) ||
      !canReadCollection(permissions, collection.slug)
    )
      continue

    const sectionId = getCollectionSection({
      group: typeof collection.admin.group === 'string' ? collection.admin.group : undefined,
      slug: collection.slug,
    })
    const section = sections.get(sectionId)

    section?.items.push({
      href: `/admin/collections/${collection.slug}`,
      id: `collection:${collection.slug}`,
      label: getLocalizedLabel(collection.labels.plural, language),
    })
  }

  for (const global of config.globals) {
    if (!canReadGlobal(permissions, global.slug)) continue

    sections.get('system')?.items.push({
      href: `/admin/globals/${global.slug}`,
      id: `global:${global.slug}`,
      label:
        typeof global.label === 'function'
          ? global.slug
          : getLocalizedLabel(global.label, language),
    })
  }

  if (canReadCollection(permissions, 'feishu-connections')) {
    sections.get('operations')?.items.unshift({
      href: '/admin/feishu',
      id: 'view:feishu',
      label: language === 'en' ? 'Feishu CRM' : '飞书 CRM',
    })
  }

  return SECTION_ORDER.map((id) => sections.get(id)).filter(
    (section): section is OperationsNavSection => Boolean(section && section.items.length > 0),
  )
}
