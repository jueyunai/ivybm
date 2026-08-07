import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { ClientConfig, SanitizedPermissions } from 'payload'
import { describe, expect, it } from 'vitest'

import { ADMIN_COPY, getAdminCopy } from '@/admin/i18n'
import { getOperationsNavSections } from '@/admin/navigation/getOperationsNavSections'
import config from '@/payload.config'

const collection = ({ group, label, slug }: { group?: string; label: string; slug: string }) =>
  ({
    admin: { group },
    labels: { plural: label, singular: label },
    slug,
  }) as ClientConfig['collections'][number]

const global = ({ label, slug }: { label: string; slug: string }) =>
  ({
    admin: {},
    label,
    slug,
  }) as ClientConfig['globals'][number]

describe('task-oriented Admin navigation', () => {
  it('adds separate Meta and Instagram OAuth controls without replacing Payload controls', async () => {
    const payloadConfig = await config
    const platformAccounts = payloadConfig.collections?.find(
      (collectionConfig) => collectionConfig.slug === 'platform-accounts',
    )

    expect(platformAccounts?.admin?.components?.edit?.beforeDocumentControls).toEqual([
      '/admin/components/PlatformAccountOAuthControls',
      '/admin/components/InstagramAccountOAuthControls',
    ])
    expect(platformAccounts?.admin?.components?.edit?.PublishButton).toBeUndefined()
    expect(platformAccounts?.admin?.components?.edit?.SaveButton).toBeUndefined()
  })

  it('uses the public Nav and Dashboard extension points', async () => {
    const payloadConfig = await config
    const components = payloadConfig.admin?.components

    expect(components?.Nav).toEqual('/admin/components/OperationsNav')
    expect(components?.actions).toContain('/admin/components/AdminAccountMenu')
    expect(components?.beforeNavLinks).toBeUndefined()
    expect(components?.views?.dashboard).toMatchObject({
      Component: '/admin/views/OperationsDashboard',
    })
  })

  it('builds bilingual, access-aware sections without duplicating task collections', () => {
    const clientConfig = {
      collections: [
        collection({ group: 'Conversations', label: 'Conversations', slug: 'conversations' }),
        collection({ group: 'Lead Management', label: 'Leads', slug: 'leads' }),
        collection({ group: 'Website Content', label: 'Products', slug: 'products' }),
        collection({
          group: 'Knowledge Base',
          label: 'Knowledge documents',
          slug: 'knowledge-documents',
        }),
        collection({ group: 'AI 管理', label: 'AI providers', slug: 'ai-providers' }),
        collection({ group: 'Operations', label: 'Jobs', slug: 'jobs' }),
        collection({ label: 'Payload migrations', slug: 'payload-migrations' }),
        collection({ label: 'Users', slug: 'users' }),
      ],
      globals: [global({ label: 'Site settings', slug: 'site-settings' })],
    } as ClientConfig
    const permissions = {
      collections: {
        conversations: { fields: {}, read: true },
        'ai-providers': { fields: {}, read: true },
        jobs: { fields: {}, read: true },
        leads: { fields: {}, read: true },
        'payload-migrations': { fields: {}, read: true },
        products: { fields: {}, read: true },
        users: { fields: {} },
      },
      globals: {
        'site-settings': { fields: {}, read: true },
      },
    } as SanitizedPermissions

    const sections = getOperationsNavSections({
      config: clientConfig,
      copy: getAdminCopy('zh'),
      language: 'zh',
      permissions,
    })
    const allItems = sections.flatMap((section) => section.items)

    expect(sections.map((section) => section.id)).toEqual([
      'workspace',
      'content',
      'intelligence',
      'operations',
      'system',
    ])
    expect(sections[0]).toMatchObject({
      label: ADMIN_COPY.zh.navSections.workspace,
      items: [
        { href: '/admin', id: 'workspace:overview' },
        { href: '/admin/collections/conversations', id: 'collection:conversations' },
        { href: '/admin/collections/leads', id: 'collection:leads' },
      ],
    })
    expect(
      allItems.filter((item) => item.href === '/admin/collections/conversations'),
    ).toHaveLength(1)
    expect(allItems.filter((item) => item.href === '/admin/collections/leads')).toHaveLength(1)
    expect(allItems.map((item) => item.href)).toContain('/admin/collections/products')
    expect(allItems.map((item) => item.href)).toContain('/admin/collections/ai-providers')
    expect(allItems.map((item) => item.href)).toContain('/admin/collections/jobs')
    expect(allItems.map((item) => item.href)).toContain('/admin/globals/site-settings')
    expect(allItems.map((item) => item.href)).not.toContain(
      '/admin/collections/knowledge-documents',
    )
    expect(allItems.map((item) => item.href)).not.toContain('/admin/collections/users')
    expect(allItems.map((item) => item.href)).not.toContain('/admin/collections/payload-migrations')
    expect(ADMIN_COPY.en.navSections.workspace).toEqual(expect.any(String))
    expect(ADMIN_COPY.en.navSections.system).toEqual(expect.any(String))
    expect(ADMIN_COPY.en.signingOut).toEqual(expect.any(String))
    expect(ADMIN_COPY.zh.signOutError).toEqual(expect.any(String))
  })

  it('defines an owned navigation shell with scoped Payload layout integration', () => {
    const navSource = readFileSync(
      path.join(process.cwd(), 'src/admin/components/OperationsNav.tsx'),
      'utf8',
    )
    const navStyles = readFileSync(
      path.join(process.cwd(), 'src/admin/styles/admin-nav.css'),
      'utf8',
    )
    const tokenStyles = readFileSync(
      path.join(process.cwd(), 'src/admin/styles/tokens.css'),
      'utf8',
    )

    expect(navSource).toContain('useAuth')
    expect(navSource).toContain('useConfig')
    expect(navSource).toContain('useNav')
    expect(navSource).toContain('NavWrapper')
    expect(navSource).toContain('operations-nav-close')
    expect(navSource).not.toContain('ops-admin-nav__footer')
    expect(navStyles).toContain('.ops-admin-nav')
    expect(navStyles).toContain('.ops-admin-nav__close')
    expect(navStyles).toContain('.ops-admin-nav__section')
    expect(navStyles).toContain('block-size: 100dvh')
    expect(navStyles).toContain('background: var(--ops-accent-soft)')
    expect(tokenStyles.match(/--ops-accent-soft:/g)).toHaveLength(2)
    expect(navStyles).toContain('.template-default__nav-toggler-wrapper')
    expect(navStyles).toContain('inset-inline-start: var(--nav-width)')
    expect(navStyles).toContain('.nav__scroll')
    expect(navStyles).not.toMatch(/\.nav-group/)
  })

  it('keeps account settings and sign out in the header avatar menu', () => {
    const accountMenuSource = readFileSync(
      path.join(process.cwd(), 'src/admin/components/AdminAccountMenu.tsx'),
      'utf8',
    )

    expect(accountMenuSource).toContain('ops-account-menu__trigger')
    expect(accountMenuSource).toContain('aria-haspopup="menu"')
    expect(accountMenuSource).toContain('href={accountHref}')
    expect(accountMenuSource).toContain('requestAdminLogout')
    expect(accountMenuSource).toContain('setUser(null)')
    expect(accountMenuSource).toContain('window.location.assign(loginHref)')
    expect(accountMenuSource).toContain("document.addEventListener('pointerdown'")
    expect(accountMenuSource).toContain('triggerRef.current?.focus()')
    expect(accountMenuSource).toContain('handleMenuKeyDown')
    expect(accountMenuSource).toContain("'ArrowDown'")
    expect(accountMenuSource).toContain("'ArrowUp'")
    expect(accountMenuSource).toContain("'Home'")
    expect(accountMenuSource).toContain("'End'")
    expect(accountMenuSource).toContain('disabled={signingOut}')
    expect(accountMenuSource).toContain('role="alert"')
  })
})
