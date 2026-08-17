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

  async cleanup(): Promise<void> {
    const conversations =
      this.externalThreadIDs.length > 0
        ? await this.payload.find({
            collection: 'conversations',
            depth: 0,
            limit: 100,
            overrideAccess: true,
            where: { externalThreadId: { in: this.externalThreadIDs } },
          })
        : { docs: [] }
    const conversationIDs = conversations.docs.map(({ id }) => id)
    const trackedLeads =
      this.leadRequestIDs.length > 0
        ? await this.payload.find({
            collection: 'leads',
            depth: 0,
            limit: 100,
            overrideAccess: true,
            where: { requestId: { in: this.leadRequestIDs } },
          })
        : { docs: [] }
    const leadIDs = [
      ...new Set([
        ...conversations.docs.flatMap(({ lead }) => (lead ? [relationshipID(lead)] : [])),
        ...trackedLeads.docs.map(({ id }) => id),
      ]),
    ]
    const visitorIDs = conversations.docs.map(({ visitorSession }) =>
      relationshipID(visitorSession),
    )
    const handoffs =
      conversationIDs.length > 0
        ? await this.payload.find({
            collection: 'handoffs',
            depth: 0,
            limit: 100,
            overrideAccess: true,
            where: { conversation: { in: conversationIDs } },
          })
        : { docs: [] }
    const handoffIDs = handoffs.docs.map(({ id }) => id)
    const intents =
      conversationIDs.length > 0
        ? await this.pool.query<{ id: number; queue_job_id: number }>(
            `SELECT id, queue_job_id FROM conversation_delivery_intents
             WHERE conversation_id = ANY($1::int[])`,
            [conversationIDs],
          )
        : { rows: [] }
    const eventJobs =
      this.eventKeys.length > 0
        ? await this.pool.query<{ id: number }>(
            'SELECT id FROM jobs WHERE type = $1 AND idempotency_key = ANY($2::text[])',
            [PLATFORM_EVENT_JOB_TYPE, this.eventKeys],
          )
        : { rows: [] }
    const feishuJobs =
      leadIDs.length > 0 || handoffIDs.length > 0
        ? await this.pool.query<{ id: number }>(
            `SELECT id FROM jobs
             WHERE type = ANY($1::text[])
               AND payload->>'entityId' = ANY($2::text[])`,
            [
              [FEISHU_LEAD_SYNC_JOB_TYPE, FEISHU_HANDOFF_NOTIFY_JOB_TYPE],
              [...leadIDs, ...handoffIDs].map(String),
            ],
          )
        : { rows: [] }
    const jobIDs = [
      ...intents.rows.map(({ queue_job_id }) => queue_job_id),
      ...eventJobs.rows.map(({ id }) => id),
      ...feishuJobs.rows.map(({ id }) => id),
    ]
    const documentIDs = [
      ...this.accountIDs,
      ...conversationIDs,
      ...handoffIDs,
      ...leadIDs,
      ...this.mappingIDs,
      ...visitorIDs,
      ...intents.rows.map(({ id }) => id),
      ...jobIDs,
    ].map(String)

    if (conversationIDs.length > 0) {
      await this.pool.query(
        'DELETE FROM conversation_commands WHERE conversation_id = ANY($1::int[])',
        [conversationIDs],
      )
      await this.pool.query(
        'DELETE FROM conversation_delivery_intents WHERE conversation_id = ANY($1::int[])',
        [conversationIDs],
      )
      if (handoffIDs.length > 0) {
        await this.pool.query('DELETE FROM handoffs WHERE id = ANY($1::int[])', [handoffIDs])
      }
      await this.pool.query('DELETE FROM conversations WHERE id = ANY($1::int[])', [
        conversationIDs,
      ])
    }
    if (jobIDs.length > 0) {
      await this.pool.query('DELETE FROM jobs WHERE id = ANY($1::int[])', [jobIDs])
    }
    if (visitorIDs.length > 0) {
      await this.pool.query('DELETE FROM visitor_sessions WHERE id = ANY($1::int[])', [visitorIDs])
    }
    if (leadIDs.length > 0) {
      await this.pool.query('DELETE FROM leads WHERE id = ANY($1::int[])', [leadIDs])
    }
    if (this.accountIDs.length > 0) {
      await this.payload.delete({
        collection: 'platform-accounts',
        context: { skipAudit: true },
        overrideAccess: true,
        where: { id: { in: this.accountIDs } },
      })
    }
    if (this.mappingIDs.length > 0) {
      await this.payload.delete({
        collection: 'feishu-mappings',
        context: { skipAudit: true },
        overrideAccess: true,
        where: { id: { in: this.mappingIDs } },
      })
    }
    if (documentIDs.length > 0) {
      await this.pool.query(
        `DELETE FROM audit_logs
         WHERE document_id = ANY($1::text[])
           AND (
             resource IN (
               'conversation-delivery-intents', 'conversations', 'jobs', 'messages',
               'feishu-mappings', 'handoffs', 'leads', 'platform-accounts', 'visitor-sessions'
             )
             OR resource LIKE 'conversation.handoff.%'
           )`,
        [documentIDs],
      )
    }
    await this.payload.destroy()
  }
}
