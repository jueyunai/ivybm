import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import { contentStudioInternalWriteContext } from '@/access/contentStudio'
import type { User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let req: PayloadRequest
let admin: User
let contentID = 0
let reviewID = 0
let jobID = 0
let logID = 0
let receiptID = 0

const errorCode = (error: unknown): unknown => {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } }
  return candidate?.code ?? candidate?.cause?.code
}

const expectRestrictedDelete = async (operation: Promise<unknown>) => {
  try {
    await operation
    throw new Error('Expected the delete to be restricted')
  } catch (error) {
    expect(errorCode(error)).toBe('23001')
  }
}

describe.sequential('Portal V1 required relationship deletes', () => {
  beforeAll(async () => {
    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'admin-portal-content-studio-relations',
    })
    const suffix = randomUUID()
    admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `portal-relations-${suffix}@example.invalid`,
        password: 'portal-content-relations-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
    req = await createLocalReq({ user: admin }, payload)
    const content = await payload.create({
      collection: 'generated-contents',
      context: contentStudioInternalWriteContext,
      data: {
        body: 'Approved internal content',
        contentLocale: 'en',
        contentType: 'post',
        createdBy: admin.id,
        creationFingerprint: 'a'.repeat(64),
        idempotencyKey: `portal-relations-content:${suffix}`,
        platform: 'linkedin',
        status: 'approved',
        title: 'Relationship delete guard',
      },
      overrideAccess: true,
      req,
    })
    contentID = content.id
    const review = await payload.create({
      collection: 'content-reviews',
      context: contentStudioInternalWriteContext,
      data: {
        checklist: {
          arabicProofread: true,
          factsTraceable: true,
          noCommercialCommitment: true,
          platformFormatChecked: true,
          technicalClaimsChecked: true,
        },
        content: contentID,
        decision: 'approved',
        reviewedBy: admin.id,
      },
      overrideAccess: true,
      req,
    })
    reviewID = review.id
    const job = await payload.create({
      collection: 'publish-jobs',
      context: contentStudioInternalWriteContext,
      data: {
        content: contentID,
        createdBy: admin.id,
        idempotencyKey: `portal-relations-job:${suffix}`,
        mode: 'assisted',
        platform: 'linkedin',
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        status: 'scheduled',
      },
      overrideAccess: true,
      req,
    })
    jobID = job.id
    const log = await payload.create({
      collection: 'publish-logs',
      context: contentStudioInternalWriteContext,
      data: {
        actor: admin.id,
        event: 'scheduled',
        publishJob: jobID,
        summary: 'Internal test schedule',
      },
      overrideAccess: true,
      req,
    })
    logID = log.id
    const receipt = await payload.create({
      collection: 'portal-command-receipts',
      context: { skipAudit: true },
      data: {
        actor: admin.id,
        fingerprint: 'b'.repeat(64),
        idempotencyKey: `portal-relations-receipt:${suffix}`,
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        ownerToken: randomUUID(),
        scope: 'portal.relations:test',
        status: 'completed',
      },
      overrideAccess: true,
      req,
    })
    receiptID = receipt.id
  })

  afterAll(async () => {
    if (!payload) return
    for (const [collection, id] of [
      ['portal-command-receipts', receiptID],
      ['publish-logs', logID],
      ['publish-jobs', jobID],
      ['content-reviews', reviewID],
      ['generated-contents', contentID],
      ['users', admin?.id],
    ] as const) {
      if (!id) continue
      await payload
        .delete({
          collection,
          context: { ...contentStudioInternalWriteContext, skipAudit: true },
          id,
          overrideAccess: true,
          req,
        })
        .catch(() => undefined)
    }
    await payload.destroy()
  })

  it('blocks deleting an actor while required audit records reference it', async () => {
    await expectRestrictedDelete(
      payload.delete({
        collection: 'users',
        context: { skipAudit: true },
        id: admin.id,
        overrideAccess: true,
        req,
      }),
    )
  })

  it('blocks deleting content while review and publication history reference it', async () => {
    await expectRestrictedDelete(
      payload.delete({
        collection: 'generated-contents',
        context: contentStudioInternalWriteContext,
        id: contentID,
        overrideAccess: true,
        req,
      }),
    )
  })

  it('blocks deleting a publication job while its audit log references it', async () => {
    await expectRestrictedDelete(
      payload.delete({
        collection: 'publish-jobs',
        context: contentStudioInternalWriteContext,
        id: jobID,
        overrideAccess: true,
        req,
      }),
    )
  })
})
