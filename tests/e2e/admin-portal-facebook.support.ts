import { createHmac, randomUUID } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import type { ConversationResponder } from '@/modules/conversations/service'
import type {
  FeishuClientPort,
  FeishuSendTextInput,
  FeishuUpsertRecordInput,
} from '@/modules/feishu/contracts'
import {
  createFeishuHandoffNotifyJobHandler,
  createFeishuLeadSyncJobHandler,
  enqueuePendingFeishuJobs,
  FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
  FEISHU_LEAD_SYNC_JOB_TYPE,
} from '@/modules/feishu/jobs'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import { JobWorker } from '@/modules/jobs/worker'
import { createPlatformConversationDeliveryService } from '@/modules/platforms/conversationDelivery'
import {
  createPlatformConversationDeliveryJobHandler,
  PLATFORM_CONVERSATION_DELIVERY_JOB_TYPE,
} from '@/modules/platforms/conversationDeliveryJobs'
import {
  createPlatformEventJobHandler,
  PLATFORM_EVENT_JOB_TYPE,
} from '@/modules/platforms/eventJobs'
import {
  createFakePlatformConversationOutboundPort,
  type FakePlatformConversationOutboundPort,
} from '@/modules/platforms/fakeConversationOutboundPort'
import { PayloadPlatformConversationPort } from '@/modules/platforms/payloadConversationPort'
import { PayloadPlatformConversationDeliveryAuthority } from '@/modules/platforms/payloadConversationDeliveryAuthority'
import { PayloadPlatformMessagingAccountAuthorizer } from '@/modules/platforms/payloadMessagingAccountAuthorizer'
import { platformEventKeyV2 } from '@/modules/platforms/types'

import { E2E_META_APP_SECRET, E2E_META_PAGE_ID } from './admin-portal-facebook.constants'

type Relationship = number | { id: number }

type FacebookConversationState = {
  conversation: {
    externalAccountId?: string | null
    externalSenderId?: string | null
    handoffStatus: string
    id: number
    publicId: string
  }
  deliveryIntent: {
    accountExternalId: string
    deliveryKey: string
    id: number
    platform: 'facebook-messenger' | 'instagram'
    recipientExternalId: string
    status: string
  }
  jobs: Array<{ id: number; idempotencyKey?: string | null; status: string; type: string }>
  messages: Array<{
    author: string
    content: string
    externalMessageId?: string | null
    id: number
    status: string
  }>
}

type FacebookHighIntentState = FacebookConversationState & {
  handoffs: Array<{ id: number; reason: string; source: string; status: string }>
  leads: Array<{
    company?: string | null
    email: string
    id: number
    intentLevel: string
    projectStage?: string | null
    quantitySquareMeters?: number | null
  }>
}

type CleanupSentinels = {
  auditIDs: number[]
  jobIDs: number[]
}

const relationshipID = (value: Relationship): number =>
  typeof value === 'number' ? value : value.id

const deterministicResponder: ConversationResponder = {
  async generateReply() {
    return {
      content: 'E2E deterministic response. Which country is the project located in?',
      estimatedCostUSD: 0,
      model: 'e2e-deterministic-model',
      promptVersion: 1,
      tokenUsage: { inputTokens: 4, outputTokens: 9, totalTokens: 13 },
    }
  },
}

export const createSignedFacebookMessage = ({
  messageId,
  senderExternalId,
  text,
  timestamp = Date.now(),
}: {
  messageId: string
  senderExternalId: string
  text: string
  timestamp?: number
}) => {
  const body = JSON.stringify({
    entry: [
      {
        id: E2E_META_PAGE_ID,
        messaging: [
          {
            message: { mid: messageId, text },
            recipient: { id: E2E_META_PAGE_ID },
            sender: { id: senderExternalId },
            timestamp,
          },
        ],
      },
    ],
    object: 'page',
  })
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${createHmac('sha256', E2E_META_APP_SECRET)
        .update(body)
        .digest('hex')}`,
    },
  }
}

export class FacebookE2EHarness {
  readonly feishuMessages: FeishuSendTextInput[]
  readonly feishuUpserts: FeishuUpsertRecordInput[]
  readonly outbound: FakePlatformConversationOutboundPort
  readonly payload: Payload
  private readonly accountIDs: number[] = []
  private readonly eventKeys: string[] = []
  private readonly externalThreadIDs: string[] = []
  private readonly leadRequestIDs: string[] = []
  private readonly mappingIDs: number[] = []
  private readonly cleanupSentinels: CleanupSentinels = { auditIDs: [], jobIDs: [] }
  private readonly queue: PayloadJobQueue
  private readonly worker: JobWorker

  private constructor({
    feishuClient,
    feishuMessages,
    feishuUpserts,
    outbound,
    payload,
  }: {
    feishuClient: FeishuClientPort
    feishuMessages: FeishuSendTextInput[]
    feishuUpserts: FeishuUpsertRecordInput[]
    outbound: FakePlatformConversationOutboundPort
    payload: Payload
  }) {
    this.feishuMessages = feishuMessages
    this.feishuUpserts = feishuUpserts
    this.outbound = outbound
    this.payload = payload
    this.queue = new PayloadJobQueue({ payload })
    this.worker = new JobWorker({
      handlers: {
        [FEISHU_HANDOFF_NOTIFY_JOB_TYPE]: createFeishuHandoffNotifyJobHandler({
          client: () => feishuClient,
          payload,
        }),
        [FEISHU_LEAD_SYNC_JOB_TYPE]: createFeishuLeadSyncJobHandler({
          client: () => feishuClient,
          payload,
        }),
        [PLATFORM_CONVERSATION_DELIVERY_JOB_TYPE]: createPlatformConversationDeliveryJobHandler({
          delivery: createPlatformConversationDeliveryService({
            authority: new PayloadPlatformConversationDeliveryAuthority(payload),
            outbound,
          }),
          payload,
        }),
        [PLATFORM_EVENT_JOB_TYPE]: createPlatformEventJobHandler({
          accountAuthorizer: new PayloadPlatformMessagingAccountAuthorizer({ payload }),
          conversations: new PayloadPlatformConversationPort({
            payload,
            responder: deterministicResponder,
          }),
        }),
      },
      heartbeatIntervalMs: 1_000,
      queue: this.queue,
    })
  }

  static async create(): Promise<FacebookE2EHarness> {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Facebook E2E')
    const payload = await getPayload({
      config,
      disableOnInit: true,
      key: `facebook-e2e-${randomUUID()}`,
    })
    const feishuMessages: FeishuSendTextInput[] = []
    const feishuUpserts: FeishuUpsertRecordInput[] = []
    const feishuClient: FeishuClientPort = {
      async sendText(input) {
        feishuMessages.push(structuredClone(input))
        return { messageId: `e2e-feishu-message-${feishuMessages.length}` }
      },
      async upsertRecord(input) {
        feishuUpserts.push(structuredClone(input))
        return { recordId: 'e2e-feishu-record', state: 'updated' }
      },
    }
    return new FacebookE2EHarness({
      feishuClient,
      feishuMessages,
      feishuUpserts,
      outbound: createFakePlatformConversationOutboundPort(),
      payload,
    })
  }

  private get pool(): PostgresAdapter['pool'] {
    return (this.payload.db as unknown as PostgresAdapter).pool
  }

  async createFacebookAccount(): Promise<void> {
    const account = await this.payload.create({
      collection: 'platform-accounts',
      context: { skipAudit: true },
      data: {
        accountKind: 'facebook-page',
        authorizationRevision: 0,
        authorization: {
          accessToken: `e2e-meta-access-token-${randomUUID()}`,
          accessTokenConfigured: false,
          appId: 'e2e-meta-app',
          clearAccessToken: false,
          clearRefreshToken: false,
          expiresAt: null,
          refreshToken: null,
          refreshTokenConfigured: false,
          scopes: [{ scope: 'pages_messaging' }],
          state: 'connected',
        },
        capabilities: { messagingInbound: 'approved', publishing: 'not_started' },
        connectionKey: null,
        externalAccountId: E2E_META_PAGE_ID,
        name: `e2e-fb-page-${randomUUID().slice(0, 8)}`,
        notes: null,
        platformFamily: 'meta',
      },
      overrideAccess: true,
    })
    this.accountIDs.push(account.id)
  }

  async createBlockedPlatformAccount({
    accountKind,
    externalAccountId,
    name,
  }: {
    accountKind: 'instagram-professional' | 'linkedin-member'
    externalAccountId: string
    name: string
  }): Promise<void> {
    const account = await this.payload.create({
      collection: 'platform-accounts',
      context: { skipAudit: true },
      data: {
        accountKind,
        authorizationRevision: 0,
        authorization: {
          accessToken: null,
          accessTokenConfigured: false,
          appId: null,
          clearAccessToken: false,
          clearRefreshToken: false,
          expiresAt: null,
          refreshToken: null,
          refreshTokenConfigured: false,
          scopes: [],
          state: 'not_started',
        },
        capabilities: {
          messagingInbound: accountKind === 'instagram-professional' ? 'blocked' : 'not_started',
          publishing: 'blocked',
        },
        connectionKey: null,
        externalAccountId,
        name,
        notes: null,
        platformFamily: accountKind === 'instagram-professional' ? 'meta' : 'linkedin',
      },
      overrideAccess: true,
    })
    this.accountIDs.push(account.id)
  }

  async createFeishuMapping(): Promise<void> {
    const mapping = await this.payload.create({
      collection: 'feishu-mappings',
      context: { skipAudit: true },
      data: {
        appToken: 'e2e-feishu-app-token',
        fieldMappings: [
          { localField: 'localLeadId', required: true, targetField: 'Local Lead ID' },
          { localField: 'customerName', required: true, targetField: 'Customer' },
          { localField: 'country', targetField: 'Country' },
          { localField: 'source', required: true, targetField: 'Source' },
          { localField: 'intentLevel', required: true, targetField: 'Intent' },
          { localField: 'email', targetField: 'Email' },
          { localField: 'originalInquiry', targetField: 'Original Inquiry' },
        ],
        key: `e2e-facebook-${randomUUID()}`,
        name: 'e2e Facebook leads',
        notificationRecipients: [
          {
            enabled: true,
            label: 'E2E sales group',
            receiveId: 'e2e-sales-chat',
            receiveIdType: 'chat_id',
          },
        ],
        status: 'active',
        tableId: 'e2e-feishu-table',
      },
      overrideAccess: true,
    })
    this.mappingIDs.push(mapping.id)
  }

  trackMessage({
    messageId,
    senderExternalId,
  }: {
    messageId: string
    senderExternalId: string
  }): void {
    this.eventKeys.push(platformEventKeyV2('facebook-messenger', E2E_META_PAGE_ID, messageId))
    this.externalThreadIDs.push(`${E2E_META_PAGE_ID}:${senderExternalId}`)
  }

  trackLeadRequest(requestId: string): void {
    this.leadRequestIDs.push(requestId)
  }

  async runUntilIdle(maximumJobs = 4): Promise<Array<'failed' | 'idle' | 'succeeded'>> {
    const outcomes: Array<'failed' | 'idle' | 'succeeded'> = []
    for (let index = 0; index <= maximumJobs; index += 1) {
      const outcome = await this.worker.runOnce()
      outcomes.push(outcome)
      if (outcome === 'idle') return outcomes
      if (outcome === 'failed') throw new Error('Facebook E2E worker failed')
    }
    throw new Error(`Facebook E2E worker did not become idle after ${maximumJobs} jobs`)
  }

  async runNext(): Promise<'failed' | 'idle' | 'succeeded'> {
    return this.worker.runOnce()
  }

  async relayFeishuJobs() {
    return enqueuePendingFeishuJobs({ payload: this.payload })
  }

  async readConversation(senderExternalId: string): Promise<FacebookConversationState> {
    const externalThreadId = `${E2E_META_PAGE_ID}:${senderExternalId}`
    const conversations = await this.payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      where: { externalThreadId: { equals: externalThreadId } },
    })
    if (conversations.docs.length !== 1) throw new Error('Expected one Facebook conversation')
    const conversation = conversations.docs[0]
    const messages = await this.payload.find({
      collection: 'messages',
      depth: 0,
      limit: 10,
      overrideAccess: true,
      sort: 'createdAt',
      where: { conversation: { equals: conversation.id } },
    })
    const intents = await this.payload.find({
      collection: 'conversation-delivery-intents',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      where: { conversation: { equals: conversation.id } },
    })
    if (intents.docs.length !== 1) throw new Error('Expected one Facebook delivery intent')
    const deliveryIntent = intents.docs[0]
    const deliveryJobID = relationshipID(deliveryIntent.queueJob)
    const jobs = await this.payload.find({
      collection: 'jobs',
      depth: 0,
      limit: 10,
      overrideAccess: true,
      where: {
        or: [
          { id: { equals: deliveryJobID } },
          ...(this.eventKeys.length > 0 ? [{ idempotencyKey: { in: this.eventKeys } }] : []),
        ],
      },
    })
    return {
      conversation: {
        externalAccountId: conversation.externalAccountId,
        externalSenderId: conversation.externalSenderId,
        handoffStatus: conversation.handoffStatus,
        id: conversation.id,
        publicId: conversation.publicId,
      },
      deliveryIntent: {
        accountExternalId: deliveryIntent.accountExternalId,
        deliveryKey: deliveryIntent.deliveryKey,
        id: deliveryIntent.id,
        platform: deliveryIntent.platform,
        recipientExternalId: deliveryIntent.recipientExternalId,
        status: deliveryIntent.status,
      },
      jobs: jobs.docs.map((job) => ({
        id: job.id,
        idempotencyKey: job.idempotencyKey,
        status: job.status,
        type: job.type,
      })),
      messages: messages.docs.map((message) => ({
        author: message.author,
        content: message.content,
        externalMessageId: message.externalMessageId,
        id: message.id,
        status: message.status,
      })),
    }
  }

  async readHighIntentState(senderExternalId: string): Promise<FacebookHighIntentState> {
    const state = await this.readConversation(senderExternalId)
    const leads = await this.payload.find({
      collection: 'leads',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      where: { idempotencyKey: { equals: `chat-lead:${state.conversation.publicId}` } },
    })
    const handoffs = await this.payload.find({
      collection: 'handoffs',
      depth: 0,
      limit: 10,
      overrideAccess: true,
      where: { conversation: { equals: state.conversation.id } },
    })
    return {
      ...state,
      handoffs: handoffs.docs.map((handoff) => ({
        id: handoff.id,
        reason: handoff.reason,
        source: handoff.source,
        status: handoff.status,
      })),
      leads: leads.docs.map((lead) => ({
        company: lead.company,
        email: lead.email,
        id: lead.id,
        intentLevel: lead.intentLevel,
        projectStage: lead.projectStage,
        quantitySquareMeters: lead.quantitySquareMeters,
      })),
    }
  }

  async readDeliveryIntents(senderExternalId: string) {
    const externalThreadId = `${E2E_META_PAGE_ID}:${senderExternalId}`
    const conversations = await this.payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      where: { externalThreadId: { equals: externalThreadId } },
    })
    if (conversations.docs.length !== 1) throw new Error('Expected one Facebook conversation')
    const intents = await this.payload.find({
      collection: 'conversation-delivery-intents',
      depth: 0,
      limit: 10,
      overrideAccess: true,
      sort: 'id',
      where: { conversation: { equals: conversations.docs[0]!.id } },
    })
    return intents.docs.map((intent) => ({
      accountExternalId: intent.accountExternalId,
      deliveryKey: intent.deliveryKey,
      platform: intent.platform,
      recipientExternalId: intent.recipientExternalId,
      status: intent.status,
      text: intent.text,
    }))
  }

  async readConversationStatus(senderExternalId: string): Promise<string> {
    const conversations = await this.payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      where: {
        externalThreadId: { equals: `${E2E_META_PAGE_ID}:${senderExternalId}` },
      },
    })
    if (conversations.docs.length !== 1) throw new Error('Expected one Facebook conversation')
    return conversations.docs[0]!.handoffStatus
  }

  async readLeadByRequestId(requestId: string) {
    const leads = await this.payload.find({
      collection: 'leads',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      where: { requestId: { equals: requestId } },
    })
    if (leads.docs.length !== 1) throw new Error('Expected one inquiry Lead')
    return leads.docs[0]
  }

  async createCleanupCollisionSentinels(): Promise<CleanupSentinels> {
    const accountID = this.accountIDs[0]
    if (!accountID) throw new Error('A tracked platform account is required for cleanup sentinels')

    const sources = await this.payload.find({
      collection: 'lead-sources',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { key: { equals: 'ai-chat' } },
    })
    const source = sources.docs[0]
    if (!source) throw new Error('AI chat lead source is required for cleanup sentinels')

    const suffix = randomUUID()
    const requestId = `facebook-cleanup-sentinel-${suffix}`
    const lead = await this.payload.create({
      collection: 'leads',
      context: { skipAudit: true },
      data: {
        email: `facebook-cleanup-${suffix}@example.invalid`,
        idempotencyKey: `facebook-cleanup-sentinel:${suffix}`,
        intentLevel: 'unscored',
        locale: 'en',
        message: 'Cleanup collision sentinel',
        name: 'Cleanup collision sentinel',
        requestId,
        source: source.id,
        status: 'new',
      },
      overrideAccess: true,
    })
    this.trackLeadRequest(requestId)

    const wrongTypeJob = await this.queue.enqueue({
      idempotencyKey: `facebook-cleanup-wrong-type:${suffix}`,
      payload: { entityId: lead.id },
      type: FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
    })
    this.cleanupSentinels.jobIDs.push(wrongTypeJob.job.id)
    const audit = await this.pool.query<{ id: number }>(
      `INSERT INTO audit_logs (action, resource, document_id, updated_at, created_at)
       VALUES ('update', 'feishu-mappings', $1, now(), now())
       RETURNING id`,
      [String(accountID)],
    )
    const auditID = audit.rows[0]?.id
    if (!auditID) throw new Error('Cleanup audit sentinel was not created')

    this.cleanupSentinels.auditIDs.push(auditID)
    return structuredClone(this.cleanupSentinels)
  }

  async cleanup(): Promise<CleanupSentinels> {
    const result: CleanupSentinels = { auditIDs: [], jobIDs: [] }
    const pool = this.pool

    try {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')

        const conversations =
          this.externalThreadIDs.length > 0
            ? await client.query<{
                id: number
                lead_id: number | null
                visitor_session_id: number
              }>(
                `SELECT id, lead_id, visitor_session_id
                 FROM conversations
                 WHERE external_thread_id = ANY($1::text[])`,
                [this.externalThreadIDs],
              )
            : { rows: [] }
        const conversationIDs = conversations.rows.map(({ id }) => id)
        const trackedLeads =
          this.leadRequestIDs.length > 0
            ? await client.query<{ id: number }>(
                'SELECT id FROM leads WHERE request_id = ANY($1::text[])',
                [this.leadRequestIDs],
              )
            : { rows: [] }
        const leadIDs = [
          ...new Set([
            ...conversations.rows.flatMap(({ lead_id }) => (lead_id ? [lead_id] : [])),
            ...trackedLeads.rows.map(({ id }) => id),
          ]),
        ]
        const visitorIDs = [
          ...new Set(conversations.rows.map(({ visitor_session_id }) => visitor_session_id)),
        ]
        const handoffs =
          conversationIDs.length > 0
            ? await client.query<{ id: number }>(
                'SELECT id FROM handoffs WHERE conversation_id = ANY($1::int[])',
                [conversationIDs],
              )
            : { rows: [] }
        const handoffIDs = handoffs.rows.map(({ id }) => id)
        const messages =
          conversationIDs.length > 0
            ? await client.query<{ id: number }>(
                'SELECT id FROM messages WHERE conversation_id = ANY($1::int[])',
                [conversationIDs],
              )
            : { rows: [] }
        const messageIDs = messages.rows.map(({ id }) => id)
        const intents =
          conversationIDs.length > 0
            ? await client.query<{ id: number; queue_job_id: number }>(
                `SELECT id, queue_job_id FROM conversation_delivery_intents
                 WHERE conversation_id = ANY($1::int[])`,
                [conversationIDs],
              )
            : { rows: [] }
        const eventJobs =
          this.eventKeys.length > 0
            ? await client.query<{ id: number }>(
                'SELECT id FROM jobs WHERE type = $1 AND idempotency_key = ANY($2::text[])',
                [PLATFORM_EVENT_JOB_TYPE, this.eventKeys],
              )
            : { rows: [] }
        const feishuJobs =
          leadIDs.length > 0 || handoffIDs.length > 0
            ? await client.query<{ id: number }>(
                `SELECT id FROM jobs
                 WHERE (type = $1 AND payload->>'entityId' = ANY($2::text[]))
                    OR (type = $3 AND payload->>'entityId' = ANY($4::text[]))`,
                [
                  FEISHU_LEAD_SYNC_JOB_TYPE,
                  leadIDs.map(String),
                  FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
                  handoffIDs.map(String),
                ],
              )
            : { rows: [] }
        const jobIDs = [
          ...new Set([
            ...intents.rows.map(({ queue_job_id }) => queue_job_id),
            ...eventJobs.rows.map(({ id }) => id),
            ...feishuJobs.rows.map(({ id }) => id),
          ]),
        ]
        const auditTargets: Array<[resource: string, ids: number[]]> = [
          ['platform-accounts', this.accountIDs],
          ['conversations', conversationIDs],
          ['handoffs', handoffIDs],
          ['leads', leadIDs],
          ['feishu-mappings', this.mappingIDs],
          ['visitor-sessions', visitorIDs],
          ['conversation-delivery-intents', intents.rows.map(({ id }) => id)],
          ['jobs', jobIDs],
          ['messages', messageIDs],
        ]

        for (const [resource, ids] of auditTargets) {
          if (ids.length > 0) {
            await client.query(
              'DELETE FROM audit_logs WHERE resource = $1 AND document_id = ANY($2::text[])',
              [resource, ids.map(String)],
            )
          }
        }
        if (conversationIDs.length > 0) {
          await client.query(
            `DELETE FROM audit_logs
             WHERE resource LIKE 'conversation.handoff.%'
               AND document_id = ANY($1::text[])`,
            [conversationIDs.map(String)],
          )
          await client.query(
            'DELETE FROM conversation_commands WHERE conversation_id = ANY($1::int[])',
            [conversationIDs],
          )
          await client.query(
            'DELETE FROM conversation_delivery_intents WHERE conversation_id = ANY($1::int[])',
            [conversationIDs],
          )
          await client.query('DELETE FROM handoffs WHERE id = ANY($1::int[])', [handoffIDs])
          await client.query('DELETE FROM conversations WHERE id = ANY($1::int[])', [
            conversationIDs,
          ])
        }
        if (jobIDs.length > 0) {
          await client.query('DELETE FROM jobs WHERE id = ANY($1::int[])', [jobIDs])
        }
        if (visitorIDs.length > 0) {
          await client.query('DELETE FROM visitor_sessions WHERE id = ANY($1::int[])', [visitorIDs])
        }
        if (leadIDs.length > 0) {
          await client.query('DELETE FROM leads WHERE id = ANY($1::int[])', [leadIDs])
        }
        if (this.accountIDs.length > 0) {
          await client.query('DELETE FROM platform_accounts WHERE id = ANY($1::int[])', [
            this.accountIDs,
          ])
        }
        if (this.mappingIDs.length > 0) {
          await client.query('DELETE FROM feishu_mappings WHERE id = ANY($1::int[])', [
            this.mappingIDs,
          ])
        }

        if (this.cleanupSentinels.auditIDs.length > 0) {
          const audits = await client.query<{ id: number }>(
            'SELECT id FROM audit_logs WHERE id = ANY($1::int[]) ORDER BY id',
            [this.cleanupSentinels.auditIDs],
          )
          result.auditIDs = audits.rows.map(({ id }) => id)
        }
        if (this.cleanupSentinels.jobIDs.length > 0) {
          const jobs = await client.query<{ id: number }>(
            'SELECT id FROM jobs WHERE id = ANY($1::int[]) ORDER BY id',
            [this.cleanupSentinels.jobIDs],
          )
          result.jobIDs = jobs.rows.map(({ id }) => id)
        }
        if (
          result.auditIDs.length !== this.cleanupSentinels.auditIDs.length ||
          result.jobIDs.length !== this.cleanupSentinels.jobIDs.length
        ) {
          throw new Error('Facebook E2E cleanup deleted a cross-resource collision sentinel')
        }
        if (this.cleanupSentinels.auditIDs.length > 0) {
          await client.query('DELETE FROM audit_logs WHERE id = ANY($1::int[])', [
            this.cleanupSentinels.auditIDs,
          ])
        }
        if (this.cleanupSentinels.jobIDs.length > 0) {
          await client.query('DELETE FROM jobs WHERE id = ANY($1::int[])', [
            this.cleanupSentinels.jobIDs,
          ])
        }

        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    } finally {
      await this.payload.destroy()
    }

    return result
  }
}
