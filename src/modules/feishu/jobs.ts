import { createHash } from 'node:crypto'

import type { Payload } from 'payload'

import { PayloadJobQueue } from '@/modules/jobs/claim'
import type { JobHandler } from '@/modules/jobs/contracts'

import { createFeishuClientForMapping } from './connectionClient'
import { findActiveFeishuMapping } from './config'
import {
  FeishuConfigurationError,
  type FeishuClientPort,
  type FeishuMappingConfig,
  type HandoffForFeishu,
  type LeadForFeishu,
} from './contracts'
import { notifyHandoff, notifyHighIntentLead, notifyNewLead } from './notify'
import { syncLead } from './syncLead'

export const FEISHU_LEAD_SYNC_JOB_TYPE = 'feishu.lead.sync'
export const FEISHU_HANDOFF_NOTIFY_JOB_TYPE = 'feishu.handoff.notify'

type FeishuJobPayload = {
  entityId: number | string
  mappingId: number | string
  mappingRevision: string
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const id = (value: unknown, field: string): number | string => {
  if (typeof value === 'number' || typeof value === 'string') return value
  throw new FeishuConfigurationError(`Feishu job ${field} is invalid`)
}

const requiredString = (value: unknown, field: string): string => {
  if (typeof value === 'string' && value.trim()) return value.trim()
  throw new FeishuConfigurationError(`Feishu job ${field} is invalid`)
}

const leadSyncRevision = (value: unknown): string => {
  const lead = record(value)
  if (!lead) throw new FeishuConfigurationError('Lead document is invalid')
  const assignedTo = record(lead.assignedTo)?.id ?? lead.assignedTo ?? null
  const source = record(lead.source)?.id ?? lead.source
  return createHash('sha256')
    .update(
      JSON.stringify({
        assignedTo,
        company: lead.company ?? null,
        country: lead.country,
        email: lead.email,
        id: lead.id,
        intentLevel: lead.intentLevel,
        interest: lead.interest ?? null,
        message: lead.message,
        name: lead.name,
        phone: lead.phone ?? null,
        source,
        status: lead.status,
        sourceURL: lead.sourceURL ?? null,
      }),
    )
    .digest('hex')
}

export const parseFeishuJobPayload = (value: unknown): FeishuJobPayload => {
  const input = record(value)
  if (!input) throw new FeishuConfigurationError('Feishu job payload is invalid')
  return {
    entityId: id(input.entityId, 'entityId'),
    mappingId: id(input.mappingId, 'mappingId'),
    mappingRevision: requiredString(input.mappingRevision, 'mappingRevision'),
  }
}

const relationshipLabel = (value: unknown): number | string | Record<string, unknown> => {
  if (typeof value === 'number' || typeof value === 'string') return value
  const item = record(value)
  if (item && (typeof item.id === 'number' || typeof item.id === 'string')) return item
  throw new FeishuConfigurationError('Feishu relationship value is invalid')
}

const leadForFeishu = (value: unknown): LeadForFeishu => {
  const lead = record(value)
  if (!lead) throw new FeishuConfigurationError('Lead document is invalid')
  const intentLevel = lead.intentLevel
  const status = lead.status
  if (!['a', 'b', 'c', 'unscored'].includes(String(intentLevel))) {
    throw new FeishuConfigurationError('Lead intentLevel is invalid')
  }
  if (!['contacted', 'disqualified', 'new', 'qualified'].includes(String(status))) {
    throw new FeishuConfigurationError('Lead status is invalid')
  }
  return {
    assignedTo: lead.assignedTo
      ? (relationshipLabel(lead.assignedTo) as LeadForFeishu['assignedTo'])
      : null,
    company: typeof lead.company === 'string' ? lead.company : null,
    country: requiredString(lead.country, 'lead country'),
    email: requiredString(lead.email, 'lead email'),
    id: id(lead.id, 'lead id'),
    intentLevel: intentLevel as LeadForFeishu['intentLevel'],
    interest: typeof lead.interest === 'string' ? lead.interest : null,
    message: requiredString(lead.message, 'lead message'),
    name: requiredString(lead.name, 'lead name'),
    phone: typeof lead.phone === 'string' ? lead.phone : null,
    requestId: requiredString(lead.requestId, 'lead requestId'),
    source: relationshipLabel(lead.source) as LeadForFeishu['source'],
    status: status as LeadForFeishu['status'],
    sourceURL: typeof lead.sourceURL === 'string' ? lead.sourceURL : null,
  }
}

const handoffForFeishu = (value: unknown): HandoffForFeishu => {
  const handoff = record(value)
  const conversation = record(handoff?.conversation)
  const source = handoff?.source
  if (source !== 'ai_policy' && source !== 'operator' && source !== 'visitor') {
    throw new FeishuConfigurationError('Handoff source is invalid')
  }
  return {
    conversationPublicId: requiredString(conversation?.publicId, 'conversation publicId'),
    domainEventId: requiredString(handoff?.domainEventId, 'handoff domainEventId'),
    publicId: requiredString(handoff?.publicId, 'handoff publicId'),
    reason: requiredString(handoff?.reason, 'handoff reason'),
    requestedAt: requiredString(handoff?.requestedAt, 'handoff requestedAt'),
    source,
  }
}

const currentMapping = async ({
  mappingId,
  mappingRevision,
  payload,
}: FeishuJobPayload & { payload: Payload }) => {
  const mapping = await findActiveFeishuMapping(payload)
  if (!mapping) return null
  if (String(mapping.id) !== String(mappingId) || mapping.revision !== mappingRevision) {
    return null
  }
  return mapping
}

export const createFeishuLeadSyncJobHandler =
  ({
    client = (mapping) => createFeishuClientForMapping({ mapping, payload }),
    payload,
  }: {
    client?: (mapping: FeishuMappingConfig) => FeishuClientPort | Promise<FeishuClientPort>
    payload: Payload
  }): JobHandler =>
  async (job, execution) => {
    const input = parseFeishuJobPayload(job.payload)
    const mapping = await currentMapping({ ...input, payload })
    if (!mapping) return
    const lead = leadForFeishu(
      await payload.findByID({
        collection: 'leads',
        depth: 1,
        id: input.entityId,
        overrideAccess: true,
      }),
    )
    execution.assertLease()
    const resolvedClient = await client(mapping)
    await syncLead({ client: resolvedClient, lead, mapping, signal: execution.signal })
    execution.assertLease()
    await notifyNewLead({ client: resolvedClient, lead, mapping, signal: execution.signal })
    execution.assertLease()
    if (lead.intentLevel === 'a') {
      await notifyHighIntentLead({
        client: resolvedClient,
        lead,
        mapping,
        signal: execution.signal,
      })
      execution.assertLease()
    }
  }

export const createFeishuHandoffNotifyJobHandler =
  ({
    client = (mapping) => createFeishuClientForMapping({ mapping, payload }),
    payload,
  }: {
    client?: (mapping: FeishuMappingConfig) => FeishuClientPort | Promise<FeishuClientPort>
    payload: Payload
  }): JobHandler =>
  async (job, execution) => {
    const input = parseFeishuJobPayload(job.payload)
    const mapping = await currentMapping({ ...input, payload })
    if (!mapping) return
    const handoff = handoffForFeishu(
      await payload.findByID({
        collection: 'handoffs',
        depth: 1,
        id: input.entityId,
        overrideAccess: true,
      }),
    )
    execution.assertLease()
    await notifyHandoff({
      client: await client(mapping),
      handoff,
      mapping,
      signal: execution.signal,
    })
    execution.assertLease()
  }

type RelayCounts = { created: number; duplicate: number }
type RelayResult = { enabled: boolean; handoffs: RelayCounts; leads: RelayCounts }

const emptyCounts = (): RelayCounts => ({ created: 0, duplicate: 0 })

export const enqueuePendingFeishuJobs = async ({
  payload,
}: {
  payload: Payload
}): Promise<RelayResult> => {
  const mapping = await findActiveFeishuMapping(payload)
  if (!mapping) return { enabled: false, handoffs: emptyCounts(), leads: emptyCounts() }
  const queue = new PayloadJobQueue({ payload })
  const result: RelayResult = { enabled: true, handoffs: emptyCounts(), leads: emptyCounts() }

  let page = 1
  while (true) {
    const leads = await payload.find({
      collection: 'leads',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      page,
      sort: 'id',
    })
    for (const lead of leads.docs) {
      const revision = leadSyncRevision(lead)
      const enqueued = await queue.enqueue({
        idempotencyKey: `${mapping.key}:lead:${lead.id}:${revision}`,
        payload: { entityId: lead.id, mappingId: mapping.id, mappingRevision: mapping.revision },
        type: FEISHU_LEAD_SYNC_JOB_TYPE,
      })
      result.leads[enqueued.state] += 1
    }
    if (!leads.hasNextPage) break
    page += 1
  }

  page = 1
  while (true) {
    const handoffs = await payload.find({
      collection: 'handoffs',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      page,
      sort: 'id',
    })
    for (const handoff of handoffs.docs) {
      const domainEventId = requiredString(handoff.domainEventId, 'handoff domainEventId')
      const enqueued = await queue.enqueue({
        idempotencyKey: `${mapping.key}:handoff:${domainEventId}`,
        payload: { entityId: handoff.id, mappingId: mapping.id, mappingRevision: mapping.revision },
        type: FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
      })
      result.handoffs[enqueued.state] += 1
    }
    if (!handoffs.hasNextPage) break
    page += 1
  }

  return result
}
