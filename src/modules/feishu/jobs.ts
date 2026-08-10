import { createHash } from 'node:crypto'

import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
  type CollectionAfterChangeHook,
} from 'payload'

import { PayloadJobQueue } from '@/modules/jobs/claim'
import type { JobHandler } from '@/modules/jobs/contracts'
import { isHighIntentLead } from '@/modules/leads/highIntent'

import { createFeishuClientForMapping } from './connectionClient'
import { findActiveFeishuMapping } from './config'
import {
  FeishuConfigurationError,
  type FeishuClientPort,
  type FeishuMappingConfig,
  type HandoffForFeishu,
  type LeadForFeishu,
} from './contracts'
import {
  notifyFollowUpDue,
  notifyHandoff,
  notifyHighIntentLead,
  notifyLeadSyncFailure,
  notifyNewLead,
} from './notify'
import { syncLead } from './syncLead'

export const FEISHU_LEAD_SYNC_JOB_TYPE = 'feishu.lead.sync'
export const FEISHU_HANDOFF_NOTIFY_JOB_TYPE = 'feishu.handoff.notify'
export const FEISHU_FOLLOW_UP_REMINDER_JOB_TYPE = 'feishu.lead.followup.reminder'
export const FEISHU_LEAD_SYNC_FAILURE_JOB_TYPE = 'feishu.lead.sync.failure.notify'

type FeishuJobPayload = {
  entityId: number | string
  mappingId: number | string
  mappingRevision: string
}

const FEISHU_LEAD_NOTIFICATION_INTENTS = ['none', 'new_lead', 'high_intent'] as const
type FeishuLeadNotificationIntent = (typeof FEISHU_LEAD_NOTIFICATION_INTENTS)[number]
type FeishuLeadSyncJobPayload = FeishuJobPayload & {
  entityRevision: string
  notificationEventRevision?: string
  notificationIntent: FeishuLeadNotificationIntent
}
type FeishuFollowUpJobPayload = FeishuJobPayload & { dueAt: string }
type FeishuSyncFailureJobPayload = FeishuJobPayload & {
  failureCycle: number
  sourceJobId: number
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

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

export const feishuLeadSyncRevision = (value: unknown): string => {
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
        nextFollowUpAt: lead.nextFollowUpAt ?? null,
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

const notificationIntent = (value: unknown): FeishuLeadNotificationIntent => {
  // Draft jobs created before notification intent existed are safe historical backfill.
  if (value === undefined || value === null) return 'none'
  if (FEISHU_LEAD_NOTIFICATION_INTENTS.some((intent) => intent === value)) {
    return value as FeishuLeadNotificationIntent
  }
  throw new FeishuConfigurationError('Feishu job notificationIntent is invalid')
}

const parseFeishuLeadSyncJobPayload = (value: unknown): FeishuLeadSyncJobPayload => {
  const notificationEventRevision = optionalString(record(value)?.notificationEventRevision)
  return {
    ...parseFeishuJobPayload(value),
    entityRevision: requiredString(record(value)?.entityRevision, 'entityRevision'),
    ...(notificationEventRevision ? { notificationEventRevision } : {}),
    notificationIntent: notificationIntent(record(value)?.notificationIntent),
  }
}

const leadChangeEventRevision = ({
  lead,
  previousRevision,
  previousUpdatedAt,
}: {
  lead: unknown
  previousRevision?: string
  previousUpdatedAt?: string
}): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        previousRevision: previousRevision ?? null,
        previousUpdatedAt: previousUpdatedAt ?? null,
        updatedAt: requiredString(record(lead)?.updatedAt, 'change updatedAt'),
      }),
    )
    .digest('hex')

const leadNotificationEventRevision = (
  changeEventRevision: string,
  intent: Exclude<FeishuLeadNotificationIntent, 'none'>,
): string =>
  createHash('sha256').update(JSON.stringify({ changeEventRevision, intent })).digest('hex')

const legacyNotificationEventRevision = ({
  id: jobId,
  intent,
}: {
  id: number | string
  intent: Exclude<FeishuLeadNotificationIntent, 'none'>
}): string => createHash('sha256').update(`legacy:${jobId}:${intent}`).digest('hex')

const dateString = (value: unknown, field: string): string => {
  const candidate = requiredString(value, field)
  const parsed = new Date(candidate)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== candidate) {
    throw new FeishuConfigurationError(`Feishu job ${field} is invalid`)
  }
  return candidate
}

const numericId = (value: unknown, field: string): number => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  throw new FeishuConfigurationError(`Feishu job ${field} is invalid`)
}

const nonNegativeInteger = (value: unknown, field: string): number => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  throw new FeishuConfigurationError(`Feishu job ${field} is invalid`)
}

const parseFollowUpJobPayload = (value: unknown): FeishuFollowUpJobPayload => ({
  ...parseFeishuJobPayload(value),
  dueAt: dateString(record(value)?.dueAt, 'dueAt'),
})

const parseSyncFailureJobPayload = (value: unknown): FeishuSyncFailureJobPayload => ({
  ...parseFeishuJobPayload(value),
  failureCycle: nonNegativeInteger(record(value)?.failureCycle, 'failureCycle'),
  sourceJobId: numericId(record(value)?.sourceJobId, 'sourceJobId'),
})

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
    nextFollowUpAt: typeof lead.nextFollowUpAt === 'string' ? lead.nextFollowUpAt : null,
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
  req,
}: FeishuJobPayload & { payload: Payload; req?: PayloadRequest }) => {
  const mapping = await findActiveFeishuMapping(payload, req)
  if (!mapping) return null
  if (String(mapping.id) !== String(mappingId) || mapping.revision !== mappingRevision) {
    return null
  }
  return mapping
}

const withLockedSyncFailure = async <T>({
  leadId,
  payload,
  run,
  sourceJobId,
}: {
  leadId: number | string
  payload: Payload
  run: (req: PayloadRequest) => Promise<T>
  sourceJobId: number
}): Promise<T | undefined> => {
  const req = await createLocalReq({}, payload)
  await initTransaction(req)
  try {
    const transactionID = await req.transactionID
    const adapter = payload.db as unknown as PostgresAdapter
    const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
    if (!database) {
      throw new FeishuConfigurationError('Feishu sync failure transaction is unavailable')
    }
    const lead = await database.execute(sql`
      SELECT "id" FROM "leads" WHERE "id" = ${leadId} FOR UPDATE
    `)
    if (!lead.rows[0]) {
      await commitTransaction(req)
      return undefined
    }
    // Match the Lead update hook's lead -> job lock order to avoid a deadlock
    // when an unchanged Lead revision collides with the source Job's key.
    const sourceJob = await database.execute(sql`
      SELECT "id" FROM "jobs" WHERE "id" = ${sourceJobId} FOR UPDATE
    `)
    if (!sourceJob.rows[0]) {
      await commitTransaction(req)
      return undefined
    }
    const result = await run(req)
    await commitTransaction(req)
    return result
  } catch (error) {
    await killTransaction(req).catch(() => undefined)
    throw error
  }
}

const withLockedLead = async <T>({
  leadId,
  payload,
  run,
}: {
  leadId: number | string
  payload: Payload
  run: (req: PayloadRequest) => Promise<T>
}): Promise<T | undefined> => {
  const req = await createLocalReq({}, payload)
  await initTransaction(req)
  try {
    const transactionID = await req.transactionID
    const adapter = payload.db as unknown as PostgresAdapter
    const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
    if (!database) {
      throw new FeishuConfigurationError('Feishu lead synchronization transaction is unavailable')
    }
    const locked = await database.execute(sql`
      SELECT "id" FROM "leads" WHERE "id" = ${leadId} FOR UPDATE
    `)
    if (!locked.rows[0]) {
      await commitTransaction(req)
      return undefined
    }
    const result = await run(req)
    await commitTransaction(req)
    return result
  } catch (error) {
    await killTransaction(req).catch(() => undefined)
    throw error
  }
}

export const enqueueFeishuLeadChange: CollectionAfterChangeHook = async ({
  doc,
  operation,
  previousDoc,
  req,
}) => {
  const mapping = await findActiveFeishuMapping(req.payload, req)
  if (!mapping) return doc

  const transactionID = await req.transactionID
  const adapter = req.payload.db as unknown as PostgresAdapter
  const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
  if (!database) {
    throw new FeishuConfigurationError('Feishu lead relay transaction is unavailable')
  }

  let intent: FeishuLeadNotificationIntent =
    operation === 'create'
      ? 'new_lead'
      : isHighIntentLead(doc) && !isHighIntentLead(previousDoc)
        ? 'high_intent'
        : 'none'
  const revision = feishuLeadSyncRevision(doc)
  const previousRevision = record(previousDoc) ? feishuLeadSyncRevision(previousDoc) : undefined
  const contentChanged = operation === 'create' || previousRevision !== revision
  const changeEventRevision = contentChanged
    ? leadChangeEventRevision({
        lead: doc,
        previousRevision,
        previousUpdatedAt: optionalString(record(previousDoc)?.updatedAt),
      })
    : undefined
  let notificationEventRevision =
    intent === 'none' || !changeEventRevision
      ? undefined
      : leadNotificationEventRevision(changeEventRevision, intent)

  if (operation === 'update') {
    const pendingNotifications = await database.execute(sql`
      SELECT
        "id",
        "payload"->>'notificationEventRevision' AS "notification_event_revision",
        "payload"->>'notificationIntent' AS "notification_intent"
      FROM "jobs"
      WHERE "type" = ${FEISHU_LEAD_SYNC_JOB_TYPE}
        AND "status" <> 'succeeded'
        AND "payload"->>'entityId' = ${String(doc.id)}
        AND "payload"->>'mappingId' = ${String(mapping.id)}
        AND "payload"->>'mappingRevision' = ${mapping.revision}
      ORDER BY "id" DESC
    `)
    const carried = pendingNotifications.rows
      .map((value) => {
        const row = record(value)
        const carriedIntent = row?.notification_intent
        if (carriedIntent !== 'new_lead' && carriedIntent !== 'high_intent') return undefined
        return {
          eventRevision:
            optionalString(row?.notification_event_revision) ??
            legacyNotificationEventRevision({
              id: id(row?.id, 'pending notification id'),
              intent: carriedIntent,
            }),
          intent: carriedIntent,
        }
      })
      .filter((value) => value !== undefined)
    const carriedNewLead = carried.find((value) => value.intent === 'new_lead')
    const carriedHighIntent = carried.find((value) => value.intent === 'high_intent')
    if (carriedNewLead) {
      intent = 'new_lead'
      notificationEventRevision = carriedNewLead.eventRevision
    } else if (intent === 'none' && carriedHighIntent) {
      intent = 'high_intent'
      notificationEventRevision = carriedHighIntent.eventRevision
    }
  }

  if (intent !== 'none' && !notificationEventRevision) {
    notificationEventRevision = leadNotificationEventRevision(
      changeEventRevision ??
        leadChangeEventRevision({
          lead: doc,
          previousRevision,
          previousUpdatedAt: optionalString(record(previousDoc)?.updatedAt),
        }),
      intent,
    )
  }
  const now = new Date().toISOString()
  const jobPayload: FeishuLeadSyncJobPayload = {
    entityId: doc.id,
    entityRevision: revision,
    mappingId: mapping.id,
    mappingRevision: mapping.revision,
    ...(notificationEventRevision ? { notificationEventRevision } : {}),
    notificationIntent: intent,
  }
  const baseIdempotencyKey = `${mapping.key}:lead:${doc.id}:${revision}`
  let idempotencyKey = baseIdempotencyKey
  if (changeEventRevision) {
    const existingBaseJob = await database.execute(sql`
      SELECT "id"
      FROM "jobs"
      WHERE "type" = ${FEISHU_LEAD_SYNC_JOB_TYPE}
        AND "idempotency_key" = ${baseIdempotencyKey}
      LIMIT 1
    `)
    if (existingBaseJob.rows[0]) {
      idempotencyKey = `${baseIdempotencyKey}:change:${changeEventRevision}`
    }
  }
  await database.execute(sql`
    INSERT INTO "jobs" (
      "type", "idempotency_key", "payload", "status", "attempts", "max_attempts",
      "next_run_at", "manual_retry_count", "updated_at", "created_at"
    ) VALUES (
      ${FEISHU_LEAD_SYNC_JOB_TYPE},
      ${idempotencyKey},
      ${JSON.stringify(jobPayload)}::jsonb,
      'pending', 0, 5, ${now}, 0, ${now}, ${now}
    )
    ON CONFLICT ("type", "idempotency_key") DO NOTHING
  `)
  return doc
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
    const input = parseFeishuLeadSyncJobPayload(job.payload)
    const mapping = await currentMapping({ ...input, payload })
    if (!mapping) return
    execution.assertLease()
    const resolvedClient = await client(mapping)
    const lead = await withLockedLead({
      leadId: input.entityId,
      payload,
      run: async (req) => {
        const document = await payload.findByID({
          collection: 'leads',
          depth: 1,
          id: input.entityId,
          overrideAccess: true,
          req,
        })
        if (feishuLeadSyncRevision(document) !== input.entityRevision) return undefined
        const currentLead = leadForFeishu(document)
        execution.assertLease()
        await syncLead({
          client: resolvedClient,
          lead: currentLead,
          mapping,
          signal: execution.signal,
        })
        execution.assertLease()
        return currentLead
      },
    })
    if (!lead) return
    execution.assertLease()
    if (input.notificationIntent === 'new_lead') {
      await notifyNewLead({
        client: resolvedClient,
        eventRevision: input.notificationEventRevision,
        lead,
        mapping,
        signal: execution.signal,
      })
      execution.assertLease()
    }
    if (input.notificationIntent !== 'none' && isHighIntentLead(lead)) {
      await notifyHighIntentLead({
        client: resolvedClient,
        eventRevision: input.notificationEventRevision,
        lead,
        mapping,
        signal: execution.signal,
      })
      execution.assertLease()
    }
  }

export const createFeishuFollowUpReminderJobHandler =
  ({
    client = (mapping) => createFeishuClientForMapping({ mapping, payload }),
    clock = () => new Date(),
    payload,
  }: {
    client?: (mapping: FeishuMappingConfig) => FeishuClientPort | Promise<FeishuClientPort>
    clock?: () => Date
    payload: Payload
  }): JobHandler =>
  async (job, execution) => {
    const input = parseFollowUpJobPayload(job.payload)
    const mapping = await currentMapping({ ...input, payload })
    if (!mapping) return
    execution.assertLease()
    const resolvedClient = await client(mapping)
    await withLockedLead({
      leadId: input.entityId,
      payload,
      run: async (req) => {
        const lead = leadForFeishu(
          await payload.findByID({
            collection: 'leads',
            depth: 1,
            id: input.entityId,
            overrideAccess: true,
            req,
          }),
        )
        if (
          lead.status === 'disqualified' ||
          lead.nextFollowUpAt !== input.dueAt ||
          Date.parse(input.dueAt) > clock().getTime()
        ) {
          return
        }
        execution.assertLease()
        await notifyFollowUpDue({
          client: resolvedClient,
          dueAt: input.dueAt,
          lead,
          mapping,
          signal: execution.signal,
        })
        execution.assertLease()
      },
    })
    execution.assertLease()
  }

export const createFeishuLeadSyncFailureJobHandler =
  ({
    client = (mapping) => createFeishuClientForMapping({ mapping, payload }),
    payload,
  }: {
    client?: (mapping: FeishuMappingConfig) => FeishuClientPort | Promise<FeishuClientPort>
    payload: Payload
  }): JobHandler =>
  async (job, execution) => {
    const input = parseSyncFailureJobPayload(job.payload)
    await withLockedSyncFailure({
      leadId: input.entityId,
      payload,
      sourceJobId: input.sourceJobId,
      run: async (req) => {
        const sourceJob = await payload.findByID({
          collection: 'jobs',
          depth: 0,
          id: input.sourceJobId,
          overrideAccess: true,
          req,
        })
        if (
          sourceJob.type !== FEISHU_LEAD_SYNC_JOB_TYPE ||
          sourceJob.status !== 'dead' ||
          sourceJob.manualRetryCount !== input.failureCycle
        ) {
          return
        }
        const sourceInput = parseFeishuLeadSyncJobPayload(sourceJob.payload)
        if (String(sourceInput.entityId) !== String(input.entityId)) return
        const mapping = await currentMapping({ ...input, payload, req })
        if (!mapping) return
        if (
          String(sourceInput.mappingId) !== String(mapping.id) ||
          sourceInput.mappingRevision !== mapping.revision
        ) {
          return
        }
        const document = await payload.findByID({
          collection: 'leads',
          depth: 1,
          id: input.entityId,
          overrideAccess: true,
          req,
        })
        if (feishuLeadSyncRevision(document) !== sourceInput.entityRevision) return
        execution.assertLease()
        await notifyLeadSyncFailure({
          client: await client(mapping),
          failureCycle: input.failureCycle,
          lead: leadForFeishu(document),
          mapping,
          signal: execution.signal,
          sourceJobId: sourceJob.id,
        })
        execution.assertLease()
      },
    })
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
type RelayResult = {
  enabled: boolean
  failures: RelayCounts
  handoffs: RelayCounts
  leads: RelayCounts
  reminders: RelayCounts
}

const emptyCounts = (): RelayCounts => ({ created: 0, duplicate: 0 })

export const enqueuePendingFeishuJobs = async ({
  clock = () => new Date(),
  payload,
}: {
  clock?: () => Date
  payload: Payload
}): Promise<RelayResult> => {
  const mapping = await findActiveFeishuMapping(payload)
  if (!mapping) {
    return {
      enabled: false,
      failures: emptyCounts(),
      handoffs: emptyCounts(),
      leads: emptyCounts(),
      reminders: emptyCounts(),
    }
  }
  const queue = new PayloadJobQueue({ clock, payload })
  const result: RelayResult = {
    enabled: true,
    failures: emptyCounts(),
    handoffs: emptyCounts(),
    leads: emptyCounts(),
    reminders: emptyCounts(),
  }

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
      const revision = feishuLeadSyncRevision(lead)
      const enqueued = await queue.enqueue({
        idempotencyKey: `${mapping.key}:lead:${lead.id}:${revision}`,
        payload: {
          entityId: lead.id,
          entityRevision: revision,
          mappingId: mapping.id,
          mappingRevision: mapping.revision,
          notificationIntent: 'none',
        },
        type: FEISHU_LEAD_SYNC_JOB_TYPE,
      })
      result.leads[enqueued.state] += 1
    }
    if (!leads.hasNextPage) break
    page += 1
  }

  page = 1
  while (true) {
    const dueLeads = await payload.find({
      collection: 'leads',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      page,
      sort: 'id',
      where: {
        and: [
          { nextFollowUpAt: { less_than_equal: clock().toISOString() } },
          { status: { not_equals: 'disqualified' } },
        ],
      },
    })
    for (const lead of dueLeads.docs) {
      if (!lead.nextFollowUpAt) continue
      const dueAt = new Date(lead.nextFollowUpAt).toISOString()
      const enqueued = await queue.enqueue({
        idempotencyKey: `${mapping.key}:${mapping.revision}:lead:${lead.id}:followup:${dueAt}`,
        payload: {
          dueAt,
          entityId: lead.id,
          mappingId: mapping.id,
          mappingRevision: mapping.revision,
        },
        type: FEISHU_FOLLOW_UP_REMINDER_JOB_TYPE,
      })
      result.reminders[enqueued.state] += 1
    }
    if (!dueLeads.hasNextPage) break
    page += 1
  }

  page = 1
  while (true) {
    const deadJobs = await payload.find({
      collection: 'jobs',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      page,
      sort: 'id',
      where: {
        and: [{ type: { equals: FEISHU_LEAD_SYNC_JOB_TYPE } }, { status: { equals: 'dead' } }],
      },
    })
    for (const deadJob of deadJobs.docs) {
      let source: FeishuLeadSyncJobPayload
      try {
        source = parseFeishuLeadSyncJobPayload(deadJob.payload)
      } catch {
        continue
      }
      if (
        String(source.mappingId) !== String(mapping.id) ||
        source.mappingRevision !== mapping.revision
      ) {
        continue
      }
      const currentLead = await payload
        .findByID({
          collection: 'leads',
          depth: 0,
          id: source.entityId,
          overrideAccess: true,
        })
        .catch(() => null)
      if (!currentLead || feishuLeadSyncRevision(currentLead) !== source.entityRevision) continue
      const failureCycle = nonNegativeInteger(deadJob.manualRetryCount, 'manualRetryCount')
      const enqueued = await queue.enqueue({
        idempotencyKey: `${mapping.key}:lead-sync-dead:${deadJob.id}:cycle:${failureCycle}`,
        payload: {
          entityId: source.entityId,
          failureCycle,
          mappingId: mapping.id,
          mappingRevision: mapping.revision,
          sourceJobId: deadJob.id,
        },
        type: FEISHU_LEAD_SYNC_FAILURE_JOB_TYPE,
      })
      result.failures[enqueued.state] += 1
    }
    if (!deadJobs.hasNextPage) break
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
