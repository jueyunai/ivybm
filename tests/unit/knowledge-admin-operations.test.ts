import type { ClientConfig, SanitizedPermissions } from 'payload'
import { describe, expect, it } from 'vitest'

import { getKnowledgeIndexActionState } from '@/admin/knowledge/getKnowledgeIndexActionState'
import { getAdminCopy } from '@/admin/i18n'
import { getOperationsNavSections } from '@/admin/navigation/getOperationsNavSections'
import config from '@/payload.config'

describe('knowledge operations Admin extensions', () => {
  it('registers the document action and knowledge playground through public extension points', async () => {
    const payloadConfig = await config
    const knowledge = payloadConfig.collections?.find(
      (collection) => collection.slug === 'knowledge-documents',
    )

    expect(knowledge?.admin?.components?.edit?.beforeDocumentControls).toContain(
      '/admin/components/KnowledgeIndexActions',
    )
    expect(payloadConfig.admin?.components?.views?.knowledgePlayground).toMatchObject({
      Component: '/admin/views/KnowledgePlayground',
      exact: true,
      path: '/knowledge-playground',
    })
  })

  it('adds an access-aware knowledge playground navigation item', () => {
    const config = {
      collections: [
        {
          admin: { group: 'Knowledge Base' },
          labels: { plural: 'Knowledge documents', singular: 'Knowledge document' },
          slug: 'knowledge-documents',
        },
      ],
      globals: [],
    } as unknown as ClientConfig
    const permissions = {
      collections: {
        'knowledge-documents': { fields: {}, read: true },
      },
      globals: {},
    } as SanitizedPermissions

    const items = getOperationsNavSections({
      config,
      copy: getAdminCopy('zh'),
      language: 'zh',
      permissions,
    }).flatMap((section) => section.items)

    expect(items).toContainEqual({
      href: '/admin/knowledge-playground',
      id: 'workspace:knowledge-playground',
      label: getAdminCopy('zh').knowledge.playgroundNav,
    })
  })

  it('derives safe actions from review, index and role state', () => {
    expect(
      getKnowledgeIndexActionState({
        hasDocument: true,
        indexStatus: 'pending',
        reviewStatus: 'draft',
        role: 'operator',
      }),
    ).toEqual({ action: 'submit', enabled: false, reason: 'review_required' })
    expect(
      getKnowledgeIndexActionState({
        hasDocument: true,
        indexStatus: 'pending',
        reviewStatus: 'reviewed',
        role: 'operator',
      }),
    ).toEqual({ action: 'submit', enabled: true })
    expect(
      getKnowledgeIndexActionState({
        hasDocument: true,
        indexStatus: 'processing',
        reviewStatus: 'reviewed',
        role: 'admin',
      }),
    ).toEqual({ action: 'processing', enabled: false, reason: 'processing' })
    expect(
      getKnowledgeIndexActionState({
        hasDocument: true,
        indexStatus: 'ready',
        reviewStatus: 'reviewed',
        role: 'operator',
      }),
    ).toEqual({ action: 'reindex', enabled: true })
    expect(
      getKnowledgeIndexActionState({
        hasDocument: true,
        indexStatus: 'failed',
        reviewStatus: 'reviewed',
        role: 'operator',
      }),
    ).toEqual({ action: 'retry', enabled: false, reason: 'admin_retry_required' })
    expect(
      getKnowledgeIndexActionState({
        hasDocument: true,
        indexStatus: 'failed',
        reviewStatus: 'reviewed',
        role: 'admin',
      }),
    ).toEqual({ action: 'retry', enabled: true })
  })
})
