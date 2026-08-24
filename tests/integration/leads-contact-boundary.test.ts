import { randomUUID } from 'node:crypto'

import { type MigrateDownArgs, type PostgresAdapter } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, initTransaction, killTransaction, type Payload } from 'payload'

import { down as removeSocialLeadContact } from '@/migrations/20260824_125651_task13_social_lead_contact'
import type { User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let sourceID = 0
const leadIDs: Array<number | string> = []

const leadData = (suffix: string) => ({
  country: 'United Arab Emirates',
  idempotencyKey: `lead-contact-${suffix}`,
  intentLevel: 'unscored' as const,
  locale: 'en' as const,
  message: 'Lead contact boundary integration fixture.',
  name: 'Lead Contact Boundary',
  requestId: `lead-contact-${suffix}`,
  source: sourceID,
  status: 'new' as const,
})

describe.sequential('Lead contact boundary', () => {
  beforeAll(async () => {
    payload = await getPayload({ config, disableOnInit: true, key: 'lead-contact-boundary' })
    const suffix = randomUUID()
    admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `lead-contact-admin-${suffix}@example.invalid`,
        password: 'lead-contact-boundary-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
    const source = await payload.create({
      collection: 'lead-sources',
      context: { skipAudit: true },
      data: {
        channel: 'manual',
        isActive: true,
        key: `lead-contact-${suffix}`,
        name: 'Lead contact boundary source',
      },
      overrideAccess: true,
    })
    sourceID = source.id
  })

  afterAll(async () => {
    if (!payload) return
    for (const id of leadIDs) {
      await payload
        .delete({
          collection: 'leads',
          context: { skipAudit: true },
          id,
          overrideAccess: true,
        })
        .catch(() => undefined)
    }
    if (sourceID) {
      await payload
        .delete({
          collection: 'lead-sources',
          context: { skipAudit: true },
          id: sourceID,
          overrideAccess: true,
        })
        .catch(() => undefined)
    }
    if (admin) {
      await payload
        .delete({
          collection: 'users',
          context: { skipAudit: true },
          id: admin.id,
          overrideAccess: true,
        })
        .catch(() => undefined)
    }
    await payload.destroy()
  })

  it('rejects forged identity through ordinary create and preserves the trusted service path', async () => {
    const forgedSuffix = randomUUID()
    await expect(
      payload.create({
        collection: 'leads',
        context: { skipAudit: true },
        data: {
          ...leadData(forgedSuffix),
          messagingAccountExternalId: 'forged-page',
          messagingPlatform: 'facebook-messenger',
          messagingSenderExternalId: 'forged-sender',
          messagingThreadExternalId: 'forged-page:forged-sender',
        },
        overrideAccess: false,
        req: await createLocalReq({ user: admin }, payload),
      }),
    ).rejects.toThrow()
    await expect(
      payload.count({
        collection: 'leads',
        overrideAccess: true,
        where: { requestId: { equals: `lead-contact-${forgedSuffix}` } },
      }),
    ).resolves.toEqual({ totalDocs: 0 })

    const trustedSuffix = randomUUID()
    const trusted = await payload.create({
      collection: 'leads',
      context: { skipAudit: true },
      data: {
        ...leadData(trustedSuffix),
        messagingAccountExternalId: 'verified-page',
        messagingPlatform: 'facebook-messenger',
        messagingSenderExternalId: 'verified-sender',
        messagingThreadExternalId: 'verified-page:verified-sender',
      },
      overrideAccess: true,
    })
    leadIDs.push(trusted.id)
    expect(trusted).toMatchObject({
      email: null,
      phone: null,
      messagingAccountExternalId: 'verified-page',
      messagingPlatform: 'facebook-messenger',
      messagingSenderExternalId: 'verified-sender',
      messagingThreadExternalId: 'verified-page:verified-sender',
    })
  })

  it.each([
    {
      identity: {
        messagingAccountExternalId: 'page-partial',
        messagingPlatform: 'facebook-messenger' as const,
        messagingSenderExternalId: 'sender-partial',
      },
      label: 'partial',
    },
    {
      identity: {
        messagingAccountExternalId: '   ',
        messagingPlatform: 'facebook-messenger' as const,
        messagingSenderExternalId: 'sender-blank',
        messagingThreadExternalId: 'page-blank:sender-blank',
      },
      label: 'blank',
    },
  ])('rejects $label messaging identity even when email exists', async ({ identity }) => {
    const suffix = randomUUID()
    await expect(
      payload.create({
        collection: 'leads',
        context: { skipAudit: true },
        data: {
          ...leadData(suffix),
          email: `lead-contact-${suffix}@example.invalid`,
          ...identity,
        },
        overrideAccess: true,
      }),
    ).rejects.toMatchObject({
      data: {
        errors: [
          expect.objectContaining({
            message: expect.stringContaining('Messaging contact identity must include non-empty'),
          }),
        ],
      },
    })
  })

  it('rejects an ordinary update that clears the final contact channel', async () => {
    const suffix = randomUUID()
    const lead = await payload.create({
      collection: 'leads',
      context: { skipAudit: true },
      data: { ...leadData(suffix), email: `lead-contact-${suffix}@example.invalid` },
      overrideAccess: true,
    })
    leadIDs.push(lead.id)

    await expect(
      payload.update({
        collection: 'leads',
        context: { skipAudit: true },
        data: { email: null },
        id: lead.id,
        overrideAccess: false,
        req: await createLocalReq({ user: admin }, payload),
      }),
    ).rejects.toMatchObject({
      data: {
        errors: [
          expect.objectContaining({
            message: expect.stringContaining(
              'Lead requires an email, phone, or complete server-verified messaging identity',
            ),
          }),
        ],
      },
    })
    await expect(
      payload.findByID({ collection: 'leads', id: lead.id, overrideAccess: true }),
    ).resolves.toMatchObject({ email: `lead-contact-${suffix}@example.invalid` })
  })

  it('refuses the real down migration for NULL, empty, and blank email without partial rollback', async () => {
    const adapter = payload.db as unknown as PostgresAdapter
    const requestIDs = [randomUUID(), randomUUID(), randomUUID()].map(
      (suffix) => `migration-contact-${suffix}`,
    )
    const emails: Array<null | string> = [null, '', '   ']

    try {
      for (const [index, requestID] of requestIDs.entries()) {
        await adapter.pool.query(
          `INSERT INTO leads
            (request_id, idempotency_key, source_id, locale, name, country, email, phone, message)
           VALUES ($1, $2, $3, 'en', 'Migration Contact Boundary', 'UAE', $4, $5, 'Migration boundary fixture')`,
          [requestID, requestID, sourceID, emails[index], `+97150000${index}`],
        )
      }

      const request = await createLocalReq({}, payload)
      await initTransaction(request)
      const transactionID = await request.transactionID
      const transaction = transactionID ? adapter.sessions[String(transactionID)]?.db : undefined
      if (!transaction) throw new Error('Expected an isolated Lead migration transaction')

      try {
        await expect(
          removeSocialLeadContact({
            db: transaction as MigrateDownArgs['db'],
            payload,
            req: request,
          }),
        ).rejects.toThrow('Cannot restore required Lead email while email-less Leads exist')
      } finally {
        await killTransaction(request)
      }

      const persisted = await adapter.pool.query<{ email: null | string }>(
        'SELECT email FROM leads WHERE request_id = ANY($1::text[])',
        [requestIDs],
      )
      expect(persisted.rows.map(({ email }) => email)).toEqual(expect.arrayContaining(emails))

      const schema = await adapter.pool.query<{
        contact_constraint_exists: boolean
        email_is_nullable: boolean
        messaging_column_exists: boolean
      }>(`
        SELECT
          EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'leads_contact_channel_check' AND conrelid = 'leads'::regclass
          ) AS contact_constraint_exists,
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'leads'
              AND column_name = 'email' AND is_nullable = 'YES'
          ) AS email_is_nullable,
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'leads'
              AND column_name = 'messaging_platform'
          ) AS messaging_column_exists
      `)
      expect(schema.rows[0]).toEqual({
        contact_constraint_exists: true,
        email_is_nullable: true,
        messaging_column_exists: true,
      })
    } finally {
      await adapter.pool.query('DELETE FROM leads WHERE request_id = ANY($1::text[])', [requestIDs])
    }
  })
})
