import { describe, expect, it } from 'vitest'

import config from '@/payload.config'

const findCollection = async (slug: string) => {
  const payloadConfig = await config
  const collection = payloadConfig.collections.find((candidate) => candidate.slug === slug)

  if (!collection) throw new Error(`Collection not found: ${slug}`)
  return collection
}

const findNamedField = (
  fields: Awaited<typeof config>['collections'][number]['fields'],
  name: string,
) => {
  const field = fields.find((candidate) => 'name' in candidate && candidate.name === name)

  if (!field) throw new Error(`Field not found: ${name}`)
  return field
}

const isBilingualText = (value: unknown): value is { en: string; zh: string } =>
  Boolean(value) &&
  typeof value === 'object' &&
  typeof (value as { en?: unknown }).en === 'string' &&
  typeof (value as { zh?: unknown }).zh === 'string'

const PROJECT_COLLECTION_SLUGS = new Set([
  'ai-model-profiles',
  'ai-providers',
  'ai-usage-routes',
  'audit-logs',
  'conversation-commands',
  'conversations',
  'downloads',
  'handoffs',
  'jobs',
  'knowledge-chunks',
  'knowledge-documents',
  'lead-sources',
  'leads',
  'media',
  'messages',
  'pages',
  'posts',
  'platform-accounts',
  'product-categories',
  'products',
  'prompt-templates',
  'projects',
  'users',
  'visitor-sessions',
])

describe('Payload Admin interface localization', () => {
  it('defaults the Admin interface to Simplified Chinese while retaining English and public content locales', async () => {
    const payloadConfig = await config
    const localization = payloadConfig.localization
    const { en, zh } = payloadConfig.i18n.supportedLanguages

    if (!localization) throw new Error('Public content localization must remain enabled')
    if (!zh || !en) throw new Error('Admin interface languages must be configured')

    expect(payloadConfig.i18n.fallbackLanguage).toBe('zh')
    expect(Object.keys(payloadConfig.i18n.supportedLanguages)).toEqual(['zh', 'en'])
    expect(zh.translations.general.thisLanguage).toBe('中文 (简体)')
    expect(en.translations.general.thisLanguage).toBe('English')
    expect(localization.defaultLocale).toBe('en')
    expect(localization.locales.map(({ code }) => code)).toEqual(['en', 'ar'])
  })

  it('localizes business navigation, field labels, options, and help text without changing stored values', async () => {
    const payloadConfig = await config
    const provider = await findCollection('ai-providers')
    const apiKey = findNamedField(provider.fields, 'apiKey')
    const protocol = findNamedField(provider.fields, 'protocol')

    if (!('label' in apiKey) || !('admin' in apiKey)) {
      throw new Error('API key field must expose localized Admin metadata')
    }
    if (!('options' in protocol)) throw new Error('Protocol field must expose localized options')

    expect(provider.labels).toMatchObject({
      plural: { en: 'AI Providers', zh: 'AI 服务商' },
      singular: { en: 'AI Provider', zh: 'AI 服务商' },
    })
    expect(provider.admin).toMatchObject({ group: { en: 'AI Management', zh: 'AI 管理' } })
    expect(apiKey.label).toEqual({ en: 'API Key', zh: 'API 密钥' })
    expect(apiKey.admin).toMatchObject({
      description: {
        en: 'Write-only. Enter a value to set or replace the key; leave blank to retain it.',
        zh: '只写字段。输入值可设置或替换密钥；留空将保留现有密钥。',
      },
    })
    expect(protocol.options).toEqual([
      { label: { en: 'OpenAI-compatible', zh: '兼容 OpenAI 协议' }, value: 'openai-compatible' },
    ])

    const pages = await findCollection('pages')
    expect(pages.labels).toMatchObject({ plural: { en: 'Pages', zh: '页面' } })
    expect(pages.admin).toMatchObject({ group: { en: 'Website Content', zh: '官网内容' } })

    const siteSettings = payloadConfig.globals.find(({ slug }) => slug === 'site-settings')
    if (!siteSettings) throw new Error('Site settings global must be registered')

    const defaultSeo = findNamedField(siteSettings.fields, 'defaultSeo')
    if (!('fields' in defaultSeo) || !Array.isArray(defaultSeo.fields)) {
      throw new Error('Default SEO field must contain nested fields')
    }

    const keywords = findNamedField(defaultSeo.fields, 'keywords')
    if (!('admin' in keywords)) throw new Error('SEO keywords field must expose Admin metadata')

    expect(keywords.admin).toMatchObject({
      description: {
        en: 'Comma-separated keywords for search and content planning.',
        zh: '以逗号分隔的搜索与内容规划关键词。',
      },
    })
  })

  it('does not leave project-defined navigation strings in a single language', async () => {
    const payloadConfig = await config
    const missing: string[] = []

    for (const collection of payloadConfig.collections) {
      if (!PROJECT_COLLECTION_SLUGS.has(collection.slug)) continue
      if (typeof collection.admin === 'function') continue
      if (!isBilingualText(collection.labels?.singular)) missing.push(`${collection.slug} singular`)
      if (!isBilingualText(collection.labels?.plural)) missing.push(`${collection.slug} plural`)
      if (collection.admin?.group !== undefined && !isBilingualText(collection.admin.group)) {
        missing.push(`${collection.slug} group`)
      }
    }

    for (const global of payloadConfig.globals) {
      if (!isBilingualText(global.label)) missing.push(`${global.slug} label`)
      if (global.admin?.group !== undefined && !isBilingualText(global.admin.group)) {
        missing.push(`${global.slug} group`)
      }
    }

    expect(missing).toEqual([])
  })
})
