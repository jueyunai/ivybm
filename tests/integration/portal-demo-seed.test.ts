import { randomUUID } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { seedPortalDemo } from '@/seed/portalDemo'

const DEMO_CONVERSATION_IDS = ['conv-001', 'conv-002', 'conv-003']
const DEMO_PLATFORM_IDS = [
  '108472910384721',
  '178414002938471',
  'urn:li:organization:98273641',
  'tiktok_ivybm_7829',
]

describe.sequential('Portal demo seed integration', () => {
  let payload: Payload
  let adminID = 0

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'portal-demo-seed-integration',
    })
    const admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `portal-demo-seed-${randomUUID()}@example.invalid`,
        password: `Portal-demo-${randomUUID()}`,
        role: 'admin',
      },
      overrideAccess: true,
    })
    adminID = admin.id
  })

  afterAll(async () => {
    if (!payload) return
    const database = payload.db as unknown as PostgresAdapter
    await database.pool.query(
      `DELETE FROM content_reviews
       WHERE content_id IN (
         SELECT id FROM generated_contents
         WHERE idempotency_key LIKE 'portal-content-studio:demo-%'
       )`,
    )
    await database.pool.query(
      "DELETE FROM generated_contents WHERE idempotency_key LIKE 'portal-content-studio:demo-%'",
    )
    await database.pool.query("DELETE FROM messages WHERE idempotency_key LIKE 'idemp-msg-%'")
    await database.pool.query('DELETE FROM conversations WHERE public_id = ANY($1::text[])', [
      DEMO_CONVERSATION_IDS,
    ])
    await database.pool.query(
      "DELETE FROM visitor_sessions WHERE idempotency_key LIKE 'idemp-vs-%'",
    )
    await database.pool.query("DELETE FROM leads WHERE idempotency_key LIKE 'idemp-lead-seed-%'")
    await database.pool.query(
      'DELETE FROM platform_accounts WHERE external_account_id = ANY($1::text[])',
      [DEMO_PLATFORM_IDS],
    )
    await database.pool.query('DELETE FROM users WHERE id = $1', [adminID])
    await payload.destroy()
  })

  it('is idempotent and keeps all demo states truthful', async () => {
    await seedPortalDemo(payload)

    const firstLeads = await payload.find({ collection: 'leads', limit: 100, overrideAccess: true })
    const firstConversations = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 100,
      overrideAccess: true,
    })
    const firstContents = await payload.find({
      collection: 'generated-contents',
      limit: 100,
      overrideAccess: true,
    })
    const firstPlatforms = await payload.find({
      collection: 'platform-accounts',
      limit: 100,
      overrideAccess: true,
    })

    const demoLeads = firstLeads.docs.filter((lead) =>
      lead.idempotencyKey?.startsWith('idemp-lead-seed-'),
    )
    const demoConversations = firstConversations.docs.filter((conversation) =>
      DEMO_CONVERSATION_IDS.includes(conversation.publicId),
    )
    const demoContents = firstContents.docs.filter((content) =>
      content.idempotencyKey.startsWith('portal-content-studio:demo-'),
    )
    const demoPlatforms = firstPlatforms.docs.filter((account) =>
      DEMO_PLATFORM_IDS.includes(account.externalAccountId ?? ''),
    )

    expect(demoLeads).toHaveLength(5)
    expect(demoConversations).toHaveLength(3)
    expect(demoContents).toHaveLength(4)
    expect(demoPlatforms).toHaveLength(4)
    expect(
      demoConversations.filter(({ handoffStatus }) => handoffStatus === 'handoff_requested'),
    ).toHaveLength(1)
    expect(
      demoConversations.filter(({ handoffStatus }) => handoffStatus === 'resolved'),
    ).toHaveLength(1)
    expect(demoConversations.every(({ channel }) => channel === 'website')).toBe(true)
    expect(demoContents.map(({ status }) => status).sort()).toEqual([
      'approved',
      'draft',
      'draft',
      'review',
    ])

    const messages = await payload.find({
      collection: 'messages',
      depth: 1,
      limit: 100,
      overrideAccess: true,
    })
    const demoMessages = messages.docs.filter((message) =>
      message.idempotencyKey.startsWith('idemp-msg-'),
    )
    expect(demoMessages).toHaveLength(6)
    expect(
      demoMessages
        .filter(({ author, status }) => author === 'ai' && status === 'sent')
        .every(
          ({ conversation }) =>
            typeof conversation === 'object' && conversation.channel === 'website',
        ),
    ).toBe(true)
    for (const account of demoPlatforms) {
      expect(account.authorization.state).toBe('not_started')
      expect(account.authorization.accessTokenConfigured).toBe(false)
      expect(account.authorization.refreshTokenConfigured).toBe(false)
      expect(account.authorization.accessToken).toBeFalsy()
      expect(account.authorization.refreshToken).toBeFalsy()
      expect(account.capabilities?.messagingInbound).toBe('not_started')
      expect(account.capabilities?.publishing).toBe('not_started')
      expect(account.aiAutoReplyEnabled).toBe(false)
    }

    await seedPortalDemo(payload)

    const secondLeads = await payload.find({
      collection: 'leads',
      limit: 100,
      overrideAccess: true,
    })
    const secondConversations = await payload.find({
      collection: 'conversations',
      limit: 100,
      overrideAccess: true,
    })
    const secondContents = await payload.find({
      collection: 'generated-contents',
      limit: 100,
      overrideAccess: true,
    })
    const secondPlatforms = await payload.find({
      collection: 'platform-accounts',
      limit: 100,
      overrideAccess: true,
    })
    expect(secondLeads.totalDocs).toBe(firstLeads.totalDocs)
    expect(secondConversations.totalDocs).toBe(firstConversations.totalDocs)
    expect(secondContents.totalDocs).toBe(firstContents.totalDocs)
    expect(secondPlatforms.totalDocs).toBe(firstPlatforms.totalDocs)
  })
})
