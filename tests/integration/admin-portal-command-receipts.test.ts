import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { createLocalReq, getPayload, type Payload } from 'payload'

import {
  executePortalCommand,
  portalCommandFingerprint,
  PortalCommandReceiptError,
} from '@/admin-portal/core/commands/portalCommandReceipts'
import type { User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let pageID = 0

describe.sequential('Portal command receipts', () => {
  beforeAll(async () => {
    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'admin-portal-command-receipts',
    })
    const suffix = randomUUID()
    admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `portal-receipt-${suffix}@example.invalid`,
        password: 'portal-command-receipt-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
    const page = await payload.create({
      collection: 'pages',
      context: { skipAudit: true },
      data: { _status: 'draft', slug: `receipt-${suffix}`, title: 'Receipt CAS test' },
      locale: 'en',
      overrideAccess: true,
    })
    pageID = page.id
  })

  afterAll(async () => {
    if (!payload) return
    await payload
      .delete({
        collection: 'portal-command-receipts',
        overrideAccess: true,
        where: { actor: { equals: admin?.id } },
      })
      .catch(() => undefined)
    if (pageID) {
      await payload
        .delete({
          collection: 'pages',
          context: { skipAudit: true },
          id: pageID,
          overrideAccess: true,
        })
        .catch(() => undefined)
    }
    if (admin?.id) {
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

  it('replays a completed command and rejects a changed fingerprint', async () => {
    const req = await createLocalReq({ user: admin }, payload)
    const operation = vi.fn(async () => ({ accepted: true, id: pageID }))
    const idempotencyKey = `portal-receipt:${randomUUID()}`
    const first = await executePortalCommand({
      fingerprintInput: { action: 'save', id: pageID },
      idempotencyKey,
      operation,
      payload,
      req,
      scope: `portal.pages:update:${pageID}`,
      target: { collection: 'pages', id: pageID },
    })
    const replay = await executePortalCommand({
      fingerprintInput: { action: 'save', id: pageID },
      idempotencyKey,
      operation,
      payload,
      req,
      scope: `portal.pages:update:${pageID}`,
      target: { collection: 'pages', id: pageID },
    })
    expect(first).toEqual({ accepted: true, id: pageID })
    expect(replay).toEqual(first)
    expect(operation).toHaveBeenCalledTimes(1)

    await expect(
      executePortalCommand({
        fingerprintInput: { action: 'publish', id: pageID },
        idempotencyKey,
        operation,
        payload,
        req,
        scope: `portal.pages:update:${pageID}`,
        target: { collection: 'pages', id: pageID },
      }),
    ).rejects.toMatchObject({
      code: 'portal-idempotency-conflict',
      status: 409,
    } satisfies Partial<PortalCommandReceiptError>)
  })

  it('serializes stale writers with a target row lock', async () => {
    const initial = await payload.findByID({
      collection: 'pages',
      id: pageID,
      overrideAccess: true,
    })
    const expectedUpdatedAt = initial.updatedAt
    const req = await createLocalReq({ user: admin }, payload)
    const update = (title: string) =>
      executePortalCommand({
        fingerprintInput: { expectedUpdatedAt, title },
        idempotencyKey: `portal-receipt:${randomUUID()}`,
        operation: async (transactionReq) => {
          const current = await payload.findByID({
            collection: 'pages',
            id: pageID,
            overrideAccess: true,
            req: transactionReq,
          })
          if (current.updatedAt !== expectedUpdatedAt) {
            throw new PortalCommandReceiptError('portal-stale', 'Stale command', 409)
          }
          return payload.update({
            collection: 'pages',
            context: { skipAudit: true },
            data: { title },
            id: pageID,
            locale: 'en',
            overrideAccess: true,
            req: transactionReq,
          })
        },
        payload,
        req,
        scope: `portal.pages:update:${pageID}`,
        target: { collection: 'pages', id: pageID },
      })

    const results = await Promise.allSettled([update('CAS winner A'), update('CAS winner B')])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { code: 'portal-stale', status: 409 },
    })
  })

  it('preserves the ownership conflict when another owner reclaims completion', async () => {
    const req = await createLocalReq({ user: admin }, payload)
    const idempotencyKey = `portal-receipt:${randomUUID()}`
    const scope = `portal.pages:ownership:${pageID}`

    await expect(
      executePortalCommand({
        fingerprintInput: { action: 'save', id: pageID },
        idempotencyKey,
        operation: async () => {
          await (payload.db as unknown as PostgresAdapter).pool.query(
            `UPDATE portal_command_receipts
             SET owner_token = $1, updated_at = $2
             WHERE scope = $3 AND idempotency_key = $4`,
            [randomUUID(), new Date().toISOString(), scope, idempotencyKey],
          )
          return { accepted: true }
        },
        payload,
        req,
        scope,
      }),
    ).rejects.toMatchObject({
      code: 'portal-command-conflict',
      status: 409,
    } satisfies Partial<PortalCommandReceiptError>)
  })

  it('does not replay an external command after an expired lease', async () => {
    const req = await createLocalReq({ user: admin }, payload)
    const input = { action: 'generate', brief: 'lease-expiry replay' }
    const idempotencyKey = `portal-receipt:${randomUUID()}`
    const scope = 'portal.content-studio:generate'
    await payload.create({
      collection: 'portal-command-receipts',
      context: { skipAudit: true },
      data: {
        actor: admin.id,
        fingerprint: portalCommandFingerprint(input),
        idempotencyKey,
        leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        ownerToken: randomUUID(),
        scope,
        status: 'processing',
      },
      overrideAccess: true,
    })
    const operation = vi.fn(async () => ({ generated: true }))

    await expect(
      executePortalCommand({
        atomic: false,
        fingerprintInput: input,
        idempotencyKey,
        operation,
        payload,
        replayPolicy: 'unknown-on-expiry',
        req,
        scope,
      }),
    ).rejects.toMatchObject({ code: 'portal-command-result-unknown', status: 409 })
    expect(operation).not.toHaveBeenCalled()
  })

  it('does not retry an external command whose failure outcome is unknown', async () => {
    const req = await createLocalReq({ user: admin }, payload)
    const input = { action: 'ai-debug', question: 'unknown response' }
    const idempotencyKey = `portal-receipt:${randomUUID()}`
    const scope = 'portal.knowledge:ai-debug'
    const operation = vi.fn(async () => {
      throw new Error('connection closed after request dispatch')
    })
    const command = () =>
      executePortalCommand({
        atomic: false,
        fingerprintInput: input,
        idempotencyKey,
        operation: async (_transactionReq, execution) => {
          execution.markExternalDispatch()
          return operation()
        },
        payload,
        replayPolicy: 'unknown-on-expiry',
        req,
        scope,
      })

    await expect(command()).rejects.toThrow('connection closed after request dispatch')
    await expect(command()).rejects.toMatchObject({
      code: 'portal-command-result-unknown',
      status: 409,
    })
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('keeps deterministic pre-dispatch failures retryable under the external policy', async () => {
    const req = await createLocalReq({ user: admin }, payload)
    const input = { action: 'generate', brief: 'configuration missing' }
    const idempotencyKey = `portal-receipt:${randomUUID()}`
    const operation = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('model is not configured'), { code: 'invalid_request' }))
      .mockResolvedValueOnce({ generated: true })
    const command = () =>
      executePortalCommand({
        atomic: false,
        fingerprintInput: input,
        idempotencyKey,
        operation,
        payload,
        replayPolicy: 'unknown-on-expiry',
        req,
        scope: 'portal.content-studio:generate',
      })

    await expect(command()).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(command()).resolves.toEqual({ generated: true })
    expect(operation).toHaveBeenCalledTimes(2)
  })
})
