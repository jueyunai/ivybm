import { randomUUID } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { createAiGateway } from '@/modules/ai/gateway'
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
import { indexKnowledgeDocument } from '@/modules/knowledge/embed'

import { assertMutationSpecLaunch } from './launch-context'

type ChatFixtureState = {
  conversation: {
    handoffStatus: string
    id: number
    intentLevel: string
    locale: string
    qualificationRoundCount: number
  }
  handoffs: Array<{ id: number; reason: string; source: string; status: string }>
  leads: Array<{ company?: string | null; email?: string | null; id: number; intentLevel: string }>
  messages: Array<{ author: string; content: string; id: number; status: string }>
}

const relationshipID = (value: number | { id: number } | null | undefined): number | undefined =>
  typeof value === 'number' ? value : value?.id

export class WebsiteChatE2EHarness {
  readonly feishuMessages: FeishuSendTextInput[]
  readonly feishuUpserts: FeishuUpsertRecordInput[]
  readonly payload: Payload
  private readonly documentIDs: number[] = []
  private readonly mappingIDs: number[] = []
  private readonly promptIDs: number[] = []
  private readonly publicSessionIDs: string[] = []
  private readonly queue: PayloadJobQueue
  private readonly worker: JobWorker

  private constructor({
    feishuClient,
    feishuMessages,
    feishuUpserts,
    payload,
  }: {
    feishuClient: FeishuClientPort
    feishuMessages: FeishuSendTextInput[]
    feishuUpserts: FeishuUpsertRecordInput[]
    payload: Payload
  }) {
    this.feishuMessages = feishuMessages
    this.feishuUpserts = feishuUpserts
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
      },
      heartbeatIntervalMs: 1_000,
      queue: this.queue,
    })
  }

  static async create(): Promise<WebsiteChatE2EHarness> {
    assertMutationSpecLaunch()
    const payload = await getPayload({
      config,
      disableOnInit: true,
      key: `website-chat-e2e-${randomUUID()}`,
    })
    const feishuMessages: FeishuSendTextInput[] = []
    const feishuUpserts: FeishuUpsertRecordInput[] = []
    const feishuClient: FeishuClientPort = {
      async sendText(input) {
        feishuMessages.push(structuredClone(input))
        return { messageId: `e2e-chat-feishu-message-${feishuMessages.length}` }
      },
      async upsertRecord(input) {
        feishuUpserts.push(structuredClone(input))
        return { recordId: `e2e-chat-feishu-record-${feishuUpserts.length}`, state: 'updated' }
      },
    }
    return new WebsiteChatE2EHarness({ feishuClient, feishuMessages, feishuUpserts, payload })
  }

  private get pool(): PostgresAdapter['pool'] {
    return (this.payload.db as unknown as PostgresAdapter).pool
  }

  async createKnowledgeFixtures(): Promise<void> {
    const baseURL = process.env.AI_PROVIDER_BASE_URL?.replace(/\/+$/u, '')
    if (!baseURL) throw new Error('Website chat E2E requires the launcher AI provider base URL')
    const gateway = createAiGateway({
      operations: {
        embedding: {
          dimensions: 3,
          embeddingSpaceIdentity: `openai-compatible:${baseURL}`,
          model: 'e2e-embedding-model',
          provider: {
            async embed({ input, model }) {
              return {
                embeddings: input.map(() => [1, 0, 0]),
                model,
                usage: { inputTokens: input.length, totalTokens: input.length },
              }
            },
            async generateText() {
              throw new Error('Text generation is not used while indexing E2E knowledge')
            },
            name: 'e2e-knowledge-index-fixture',
          },
        },
      },
    })

    for (const locale of ['en', 'ar'] as const) {
      const suffix = randomUUID()
      const document = await this.payload.create({
        collection: 'knowledge-documents',
        context: { skipAudit: true },
        data: {
          content:
            locale === 'en'
              ? 'Reviewed aluminum facade panel guidance covers design support, drawings, finishes, and project quantities.'
              : 'تغطي إرشادات ألواح واجهات الألمنيوم المراجعة دعم التصميم والرسومات والتشطيبات وكميات المشروع.',
          customerVisible: true,
          indexStatus: 'pending',
          locale,
          reviewStatus: 'reviewed',
          sourceTitle: `E2E reviewed panel guide ${locale} ${suffix}`,
          sourceType: 'product-manual',
          sourceVersion: '1.0',
        },
        overrideAccess: true,
      })
      this.documentIDs.push(document.id)
      await indexKnowledgeDocument({
        documentId: document.id,
        gateway,
        payload: this.payload,
        pool: this.pool,
      })

      const prompt = await this.payload.create({
        collection: 'prompt-templates',
        context: { skipAudit: true },
        data: {
          key: `e2e-customer-chat-${locale}-${suffix}`,
          locale,
          purpose: 'customer-chat',
          status: 'active',
          template: 'Answer concisely from reviewed knowledge and continue project qualification.',
          version: 9_999,
        },
        overrideAccess: true,
      })
      this.promptIDs.push(prompt.id)
    }
  }

  async createFeishuMapping(): Promise<void> {
    const mapping = await this.payload.create({
      collection: 'feishu-mappings',
      context: { skipAudit: true },
      data: {
        appToken: 'e2e-chat-feishu-app-token',
        fieldMappings: [
          { localField: 'localLeadId', required: true, targetField: 'Local Lead ID' },
          { localField: 'customerName', required: true, targetField: 'Customer' },
          { localField: 'country', targetField: 'Country' },
          { localField: 'source', required: true, targetField: 'Source' },
          { localField: 'intentLevel', required: true, targetField: 'Intent' },
          { localField: 'email', targetField: 'Email' },
          { localField: 'originalInquiry', targetField: 'Original Inquiry' },
        ],
        key: `e2e-website-chat-${randomUUID()}`,
        name: 'E2E website chat leads',
        notificationRecipients: [
          {
            enabled: true,
            label: 'E2E sales group',
            receiveId: 'e2e-chat-sales-group',
            receiveIdType: 'chat_id',
          },
        ],
        status: 'active',
        tableId: 'e2e-chat-feishu-table',
      },
      overrideAccess: true,
    })
    this.mappingIDs.push(mapping.id)
  }

  trackSession(publicID: string): void {
    this.publicSessionIDs.push(publicID)
  }

  async readSessionState(publicID: string): Promise<ChatFixtureState> {
    const conversations = await this.payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      where: { publicId: { equals: publicID } },
    })
    if (conversations.docs.length !== 1) throw new Error('Expected one website conversation')
    const conversation = conversations.docs[0]
    const [messages, handoffs, leads] = await Promise.all([
      this.payload.find({
        collection: 'messages',
        depth: 0,
        limit: 20,
        overrideAccess: true,
        sort: 'createdAt',
        where: { conversation: { equals: conversation.id } },
      }),
      this.payload.find({
        collection: 'handoffs',
        depth: 0,
        limit: 5,
        overrideAccess: true,
        where: { conversation: { equals: conversation.id } },
      }),
      this.payload.find({
        collection: 'leads',
        depth: 0,
        limit: 2,
        overrideAccess: true,
        where: { id: { equals: relationshipID(conversation.lead) ?? -1 } },
      }),
    ])
    return {
      conversation: {
        handoffStatus: conversation.handoffStatus,
        id: conversation.id,
        intentLevel: conversation.intentLevel,
        locale: conversation.locale,
        qualificationRoundCount: conversation.qualificationRoundCount ?? 0,
      },
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
      })),
      messages: messages.docs.map((message) => ({
        author: message.author,
        content: message.content,
        id: message.id,
        status: message.status,
      })),
    }
  }

  async relayFeishuJobs() {
    return enqueuePendingFeishuJobs({ payload: this.payload })
  }

  async countFeishuJobs(): Promise<number> {
    if (this.mappingIDs.length === 0) return 0
    const result = await this.pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM jobs
       WHERE type LIKE 'feishu.%' AND payload->>'mappingId' = ANY($1::text[])`,
      [this.mappingIDs.map(String)],
    )
    return result.rows[0]?.count ?? 0
  }

  async runUntilIdle(maximumJobs = 8): Promise<Array<'failed' | 'idle' | 'succeeded'>> {
    const outcomes: Array<'failed' | 'idle' | 'succeeded'> = []
    for (let index = 0; index <= maximumJobs; index += 1) {
      const outcome = await this.worker.runOnce()
      outcomes.push(outcome)
      if (outcome === 'idle') return outcomes
      if (outcome === 'failed') throw new Error('Website chat E2E worker failed')
    }
    throw new Error(`Website chat E2E worker did not become idle after ${maximumJobs} jobs`)
  }

  async countAiUsage(): Promise<number> {
    const result = await this.payload.count({
      collection: 'ai-usage-logs',
      overrideAccess: true,
      where: { requestId: { contains: `e2e-ai-${process.env.IVYBM_E2E_RUN_ID}-` } },
    })
    return result.totalDocs
  }

  async cleanup(): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const conversations = await client.query<{
        id: number
        lead_id: number | null
        visitor_session_id: number
      }>(
        'SELECT id, lead_id, visitor_session_id FROM conversations WHERE public_id = ANY($1::text[])',
        [this.publicSessionIDs],
      )
      const conversationIDs = conversations.rows.map(({ id }) => id)
      const leadIDs = conversations.rows.flatMap(({ lead_id }) => (lead_id ? [lead_id] : []))
      const visitorIDs = conversations.rows.map(({ visitor_session_id }) => visitor_session_id)
      const handoffs =
        conversationIDs.length > 0
          ? await client.query<{ id: number }>(
              'SELECT id FROM handoffs WHERE conversation_id = ANY($1::int[])',
              [conversationIDs],
            )
          : { rows: [] }
      const handoffIDs = handoffs.rows.map(({ id }) => id)
      const jobs =
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
      const jobIDs = jobs.rows.map(({ id }) => id)

      for (const [resource, ids] of [
        ['conversations', conversationIDs],
        ['handoffs', handoffIDs],
        ['leads', leadIDs],
        ['feishu-mappings', this.mappingIDs],
        ['visitor-sessions', visitorIDs],
        ['jobs', jobIDs],
        ['knowledge-documents', this.documentIDs],
        ['prompt-templates', this.promptIDs],
      ] as const) {
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
        await client.query('DELETE FROM handoffs WHERE conversation_id = ANY($1::int[])', [
          conversationIDs,
        ])
        await client.query('DELETE FROM conversations WHERE id = ANY($1::int[])', [conversationIDs])
      }
      if (jobIDs.length > 0)
        await client.query('DELETE FROM jobs WHERE id = ANY($1::int[])', [jobIDs])
      if (visitorIDs.length > 0) {
        await client.query('DELETE FROM visitor_sessions WHERE id = ANY($1::int[])', [visitorIDs])
      }
      if (leadIDs.length > 0)
        await client.query('DELETE FROM leads WHERE id = ANY($1::int[])', [leadIDs])
      if (this.documentIDs.length > 0) {
        await client.query('DELETE FROM knowledge_documents WHERE id = ANY($1::int[])', [
          this.documentIDs,
        ])
      }
      if (this.promptIDs.length > 0) {
        await client.query('DELETE FROM prompt_templates WHERE id = ANY($1::int[])', [
          this.promptIDs,
        ])
      }
      if (this.mappingIDs.length > 0) {
        await client.query('DELETE FROM feishu_mappings WHERE id = ANY($1::int[])', [
          this.mappingIDs,
        ])
      }
      await client.query('DELETE FROM ai_usage_logs WHERE request_id LIKE $1', [
        `e2e-ai-${process.env.IVYBM_E2E_RUN_ID}-%`,
      ])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
      await this.payload.destroy()
    }
  }
}
