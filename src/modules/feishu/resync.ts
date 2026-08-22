import { createHash } from 'node:crypto'

import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload'

import { PayloadJobQueue } from '@/modules/jobs/claim'

import { findActiveFeishuMapping } from './config'
import { FEISHU_LEAD_SYNC_JOB_TYPE, feishuLeadSyncRevision } from './jobs'

export const MAX_FEISHU_LEAD_RESYNC_IDS = 50

export type FeishuLeadResyncPlanItem = {
  id: number
  revision: string
  updatedAt: string
}

export type FeishuLeadResyncPlan = {
  leadIds: number[]
  mappingId: number | string
  mappingKey: string
  mappingRevision: string
  planHash: string
  items: FeishuLeadResyncPlanItem[]
}

type FeishuResyncOptions = {
  leadIds: number[]
  payload: Payload
  req?: PayloadRequest
}

const positiveLeadID = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('Feishu resync Lead IDs must be positive integers')
  }
  return value
}

const normalizeLeadIDs = (leadIds: number[]): number[] => {
  const normalized = [...new Set(leadIds.map(positiveLeadID))].sort((left, right) => left - right)
  if (normalized.length === 0) throw new Error('At least one Lead ID is required')
  if (normalized.length > MAX_FEISHU_LEAD_RESYNC_IDS) {
    throw new Error(`At most ${MAX_FEISHU_LEAD_RESYNC_IDS} Lead IDs may be resynced at once`)
  }
  return normalized
}

const planHash = (value: Omit<FeishuLeadResyncPlan, 'planHash'>): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

export const createFeishuLeadResyncPlan = async ({
  leadIds,
  payload,
  req,
}: FeishuResyncOptions): Promise<FeishuLeadResyncPlan> => {
  const normalizedLeadIDs = normalizeLeadIDs(leadIds)
  const mapping = await findActiveFeishuMapping(payload, req)
  if (!mapping) throw new Error('An active Feishu mapping is required for Lead resync')

  const items: FeishuLeadResyncPlanItem[] = []
  for (const leadID of normalizedLeadIDs) {
    const lead = await payload.findByID({
      collection: 'leads',
      depth: 0,
      id: leadID,
      overrideAccess: true,
      ...(req ? { req } : {}),
    })
    if (!lead) throw new Error(`Lead ${leadID} was not found`)
    if (typeof lead.updatedAt !== 'string' || !lead.updatedAt.trim()) {
      throw new Error(`Lead ${leadID} has no valid updatedAt revision`)
    }
    items.push({
      id: leadID,
      revision: feishuLeadSyncRevision(lead),
      updatedAt: lead.updatedAt,
    })
  }

  const withoutHash = {
    items,
    leadIds: normalizedLeadIDs,
    mappingId: mapping.id,
    mappingKey: mapping.key,
    mappingRevision: mapping.revision,
  }
  return { ...withoutHash, planHash: planHash(withoutHash) }
}

export const executeFeishuLeadResync = async ({
  payload,
  plan,
  requestedBy,
}: {
  payload: Payload
  plan: FeishuLeadResyncPlan
  requestedBy: number
}): Promise<{
  duplicate: number
  jobs: Array<{ id: number; leadId: number; state: 'created' | 'duplicate' }>
  created: number
  planHash: string
}> => {
  positiveLeadID(requestedBy)
  const requestedByUser = await payload.findByID({
    collection: 'users',
    depth: 0,
    id: requestedBy,
    overrideAccess: true,
  })
  if (requestedByUser.role !== 'admin') {
    throw new Error('Feishu resync requires an administrator actor')
  }
  const freshPlan = await createFeishuLeadResyncPlan({ leadIds: plan.leadIds, payload })
  if (freshPlan.planHash !== plan.planHash) {
    throw new Error('The Feishu resync plan changed; run dry-run again before executing')
  }

  const req = await createLocalReq({}, payload)
  await initTransaction(req)
  try {
    const transactionPlan = await createFeishuLeadResyncPlan({
      leadIds: plan.leadIds,
      payload,
      req,
    })
    if (transactionPlan.planHash !== plan.planHash) {
      throw new Error('The Feishu resync plan changed during execution')
    }

    const queue = new PayloadJobQueue({ payload })
    const jobs: Array<{ id: number; leadId: number; state: 'created' | 'duplicate' }> = []
    for (const item of transactionPlan.items) {
      const enqueued = await queue.enqueue(
        {
          idempotencyKey: `${transactionPlan.mappingKey}:lead-resync:${transactionPlan.planHash}:${item.id}:${item.revision}`,
          payload: {
            entityId: item.id,
            entityRevision: item.revision,
            mappingId: transactionPlan.mappingId,
            mappingRevision: transactionPlan.mappingRevision,
            notificationIntent: 'none',
          },
          type: FEISHU_LEAD_SYNC_JOB_TYPE,
        },
        req,
      )
      if (enqueued.state === 'created') {
        await payload.create({
          collection: 'audit-logs',
          context: { skipAudit: true },
          data: {
            action: 'update',
            actor: requestedBy,
            documentId: String(item.id),
            resource: `feishu.lead.resync:${transactionPlan.planHash}`,
          },
          overrideAccess: true,
          req,
        })
      }
      jobs.push({ id: enqueued.job.id, leadId: item.id, state: enqueued.state })
    }
    await commitTransaction(req)
    return {
      created: jobs.filter(({ state }) => state === 'created').length,
      duplicate: jobs.filter(({ state }) => state === 'duplicate').length,
      jobs,
      planHash: transactionPlan.planHash,
    }
  } catch (error) {
    await killTransaction(req).catch(() => undefined)
    throw error
  }
}
