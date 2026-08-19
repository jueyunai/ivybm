import { writeFileSync } from 'node:fs'

import { getPayload } from 'payload'

import { createPayloadConversationResponder } from '@/modules/conversations/payloadResponder'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import type { JobHandler } from '@/modules/jobs/contracts'
import {
  createFeishuFollowUpReminderJobHandler,
  createFeishuHandoffNotifyJobHandler,
  createFeishuLeadSyncFailureJobHandler,
  createFeishuLeadSyncJobHandler,
  enqueuePendingFeishuJobs,
  FEISHU_FOLLOW_UP_REMINDER_JOB_TYPE,
  FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
  FEISHU_LEAD_SYNC_FAILURE_JOB_TYPE,
  FEISHU_LEAD_SYNC_JOB_TYPE,
} from '@/modules/feishu/jobs'
import {
  createFeishuConnectionProvisionJobHandler,
  enqueuePendingFeishuConnectionProvisionJobs,
  FEISHU_CONNECTION_PROVISION_JOB_TYPE,
} from '@/modules/feishu/provisioning'
import {
  FEISHU_OAUTH_CALLBACK_RECOVERY_INTERVAL_MS,
  recoverStaleFeishuOAuthCallbacks,
} from '@/modules/feishu/appRegistration'
import {
  DEFAULT_JOB_HEARTBEAT_INTERVAL_MS,
  DEFAULT_JOB_POLL_INTERVAL_MS,
  JobWorker,
} from '@/modules/jobs/worker'
import { assertWorkerDatabaseTarget } from '@/modules/jobs/workerDatabaseSafety'
import { createIntervalGate } from '@/modules/jobs/maintenance'
import {
  createKnowledgeIndexJobHandler,
  enqueueLegacyKnowledgeRebuilds,
  KNOWLEDGE_INDEX_JOB_TYPE,
  recoverDeadKnowledgeIndexDocuments,
} from '@/modules/knowledge/jobs'
import {
  createKnowledgeIngestJobHandler,
  KNOWLEDGE_INGEST_JOB_TYPE,
} from '@/modules/knowledge/ingestion/jobs'
import {
  createPlatformConversationDeliveryJobHandler,
  PLATFORM_CONVERSATION_DELIVERY_JOB_TYPE,
} from '@/modules/platforms/conversationDeliveryJobs'
import { createPlatformConversationDeliveryService } from '@/modules/platforms/conversationDelivery'
import {
  createPlatformEventJobHandler,
  PLATFORM_EVENT_JOB_TYPE,
} from '@/modules/platforms/eventJobs'
import { createMetaConversationOutboundAdapter } from '@/modules/platforms/meta/conversationOutbound'
import { PayloadMetaMessagingTokenProvider } from '@/modules/platforms/meta/payloadMessagingTokenProvider'
import { PayloadPlatformConversationPort } from '@/modules/platforms/payloadConversationPort'
import { PayloadPlatformMessagingAccountAuthorizer } from '@/modules/platforms/payloadMessagingAccountAuthorizer'
import {
  createLinkedInPublishingTransport,
  type LinkedInPublishingTransport,
} from '@/modules/platforms/linkedin/publishingOutbound'
import { PayloadLinkedInPublishingTokenProvider } from '@/modules/platforms/linkedin/payloadPublishingTokenProvider'
import { createMetaPublishingTransport } from '@/modules/platforms/meta/publishingOutbound'
import { PayloadMetaPublishingTokenProvider } from '@/modules/platforms/meta/payloadPublishingTokenProvider'
import {
  createPlatformPublicationJobHandler,
  PLATFORM_PUBLICATION_JOB_TYPE,
  type PublicationJobRuntime,
} from '@/modules/platforms/publicationJobs'
import type { PublicationWorkerRoute } from '@/modules/platforms/publicationWorkerDispatch'
import { PayloadPublishingAccountResolver } from '@/modules/platforms/publishingAccountResolver'
import { readLinkedInPublicationAsset } from '@/modules/media'
import { createPlatformPublishingService } from '@/modules/platforms/publishingServiceAdapter'
import { PayloadPlatformConversationDeliveryAuthority } from '@/modules/platforms/payloadConversationDeliveryAuthority'
import config from '@/payload.config'

const readPositiveInteger = (name: string, fallback: number): number => {
  const value = process.env[name]
  if (!value) return fallback

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`)
  }

  return parsed
}

const heartbeatPath = process.env.WORKER_HEARTBEAT_PATH ?? '/tmp/ivybm-worker-heartbeat'
const heartbeatIntervalMs = readPositiveInteger('WORKER_HEARTBEAT_INTERVAL_MS', 5_000)
const jobHeartbeatIntervalMs = readPositiveInteger(
  'WORKER_JOB_HEARTBEAT_INTERVAL_MS',
  DEFAULT_JOB_HEARTBEAT_INTERVAL_MS,
)
const pollIntervalMs = readPositiveInteger('WORKER_POLL_INTERVAL_MS', DEFAULT_JOB_POLL_INTERVAL_MS)
const knowledgeRecoveryIntervalMs = Math.max(pollIntervalMs, heartbeatIntervalMs)
const feishuRelayIntervalMs = readPositiveInteger('FEISHU_RELAY_INTERVAL_MS', 30_000)
const feishuOAuthRecoveryIntervalMs = readPositiveInteger(
  'FEISHU_OAUTH_RECOVERY_INTERVAL_MS',
  FEISHU_OAUTH_CALLBACK_RECOVERY_INTERVAL_MS,
)
assertWorkerDatabaseTarget()
const payload = await getPayload({ config, disableOnInit: true, key: 'job-worker' })
const conversationsEnabled = process.env.ADMIN_PORTAL_CONVERSATIONS_ENABLED === 'true'

const requiredEnvironment = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for platform publishing`)
  return value
}

const commaSeparatedOrigins = (name: string): string[] =>
  requiredEnvironment(name)
    .split(',')
    .map((value) => new URL(value.trim()).origin)

let metaPublicationRuntime: PublicationJobRuntime | undefined
let linkedInPublicationRuntime: PublicationJobRuntime | undefined

const unavailableLinkedInTransport = (): LinkedInPublishingTransport => {
  const unavailable = async (): Promise<never> => {
    throw new Error('LinkedIn publishing runtime is unavailable')
  }
  return {
    getPostStatus: unavailable,
    initializeImageUpload: unavailable,
    publishImagePost: unavailable,
    publishTextPost: unavailable,
    uploadImage: unavailable,
  }
}

const resolvePublicationRuntime = async (
  route: PublicationWorkerRoute,
): Promise<PublicationJobRuntime> => {
  if (process.env.ADMIN_PORTAL_PUBLISHING_ENABLED !== 'true') {
    throw new Error('Platform publishing is disabled')
  }
  const requiresLinkedIn = route === 'linkedin-text-single' || route === 'linkedin-image-staged'
  if (requiresLinkedIn && linkedInPublicationRuntime) return linkedInPublicationRuntime
  if (!requiresLinkedIn && metaPublicationRuntime) return metaPublicationRuntime
  const publicOrigin = new URL(requiredEnvironment('NEXT_PUBLIC_SERVER_URL')).origin
  const metaTokenProvider = new PayloadMetaPublishingTokenProvider({ payload })
  let linkedInTransport = unavailableLinkedInTransport()
  if (requiresLinkedIn) {
    const ticketKey = Buffer.from(requiredEnvironment('LINKEDIN_UPLOAD_TICKET_KEY'), 'hex')
    if (ticketKey.byteLength !== 32) {
      throw new Error('LINKEDIN_UPLOAD_TICKET_KEY must be a 64-character hexadecimal value')
    }
    const linkedInTokenProvider = new PayloadLinkedInPublishingTokenProvider({ payload })
    linkedInTransport = createLinkedInPublishingTransport({
      allowedUploadOrigins: commaSeparatedOrigins('LINKEDIN_UPLOAD_ALLOWED_ORIGINS'),
      linkedInVersion: requiredEnvironment('LINKEDIN_API_VERSION'),
      tokenProvider: linkedInTokenProvider.getToken,
      uploadTicketKey: ticketKey,
    })
  }
  const metaTransport = createMetaPublishingTransport({
    allowedMediaOrigins: [publicOrigin],
    tokenProvider: metaTokenProvider.getToken,
  })
  const accountResolver = new PayloadPublishingAccountResolver({ payload })
  const runtime: PublicationJobRuntime = {
    directService: createPlatformPublishingService({
      accountResolver,
      linkedInTransport,
      metaTransport,
    }),
    linkedInTransport,
    metaTransport,
    async readLinkedInAssetBytes(asset) {
      if (!/^[1-9]\d*$/u.test(asset.id)) return null
      return readLinkedInPublicationAsset({
        byteLength: asset.byteLength,
        contentType: asset.contentType,
        id: Number(asset.id),
        payload,
        sha256: asset.sha256,
      })
    },
  }
  if (requiresLinkedIn) linkedInPublicationRuntime = runtime
  else metaPublicationRuntime = runtime
  return runtime
}

const handlers: Record<string, JobHandler> = {
  [FEISHU_CONNECTION_PROVISION_JOB_TYPE]: createFeishuConnectionProvisionJobHandler({ payload }),
  [FEISHU_FOLLOW_UP_REMINDER_JOB_TYPE]: createFeishuFollowUpReminderJobHandler({ payload }),
  [FEISHU_HANDOFF_NOTIFY_JOB_TYPE]: createFeishuHandoffNotifyJobHandler({ payload }),
  [FEISHU_LEAD_SYNC_FAILURE_JOB_TYPE]: createFeishuLeadSyncFailureJobHandler({ payload }),
  [FEISHU_LEAD_SYNC_JOB_TYPE]: createFeishuLeadSyncJobHandler({ payload }),
  [KNOWLEDGE_INDEX_JOB_TYPE]: createKnowledgeIndexJobHandler({ payload }),
  [KNOWLEDGE_INGEST_JOB_TYPE]: createKnowledgeIngestJobHandler({ payload }),
  [PLATFORM_EVENT_JOB_TYPE]: createPlatformEventJobHandler({
    accountAuthorizer: new PayloadPlatformMessagingAccountAuthorizer({ payload }),
    conversations: new PayloadPlatformConversationPort({
      payload,
      ...(conversationsEnabled ? { responder: createPayloadConversationResponder(payload) } : {}),
    }),
  }),
}
if (conversationsEnabled) {
  const tokenProvider = new PayloadMetaMessagingTokenProvider({ payload })
  handlers[PLATFORM_CONVERSATION_DELIVERY_JOB_TYPE] = createPlatformConversationDeliveryJobHandler({
    delivery: createPlatformConversationDeliveryService({
      authority: new PayloadPlatformConversationDeliveryAuthority(payload),
      outbound: createMetaConversationOutboundAdapter({ tokenProvider: tokenProvider.getToken }),
    }),
    payload,
  })
}
if (process.env.ADMIN_PORTAL_PUBLISHING_ENABLED === 'true') {
  handlers[PLATFORM_PUBLICATION_JOB_TYPE] = createPlatformPublicationJobHandler({
    payload,
    resolveRuntime: resolvePublicationRuntime,
  })
}
const worker = new JobWorker({
  handlers,
  heartbeatIntervalMs: jobHeartbeatIntervalMs,
  idleDelayMs: pollIntervalMs,
  queue: new PayloadJobQueue({ payload }),
})

const writeHeartbeat = (): void => {
  writeFileSync(heartbeatPath, String(Date.now()))
}

let nextKnowledgeRecoveryAt = 0
let nextFeishuRelayAt = 0
const shouldRecoverStaleFeishuOAuth = createIntervalGate(feishuOAuthRecoveryIntervalMs)
const recoverDeadKnowledgeDocuments = async (): Promise<void> => {
  const now = Date.now()
  if (now < nextKnowledgeRecoveryAt) return
  nextKnowledgeRecoveryAt = now + knowledgeRecoveryIntervalMs

  try {
    const recovered = await recoverDeadKnowledgeIndexDocuments({ payload })
    if (recovered > 0) {
      payload.logger.warn(`Recovered ${recovered} dead-lettered knowledge index document(s)`)
    }
  } catch {
    payload.logger.error('Dead-letter knowledge index recovery failed; continuing worker loop')
  }
}

const relayFeishuOutbox = async (): Promise<void> => {
  const now = Date.now()
  if (now < nextFeishuRelayAt) return
  nextFeishuRelayAt = now + feishuRelayIntervalMs

  try {
    const provisioned = await enqueuePendingFeishuConnectionProvisionJobs({ payload })
    const relayed = await enqueuePendingFeishuJobs({ payload })
    const created =
      relayed.leads.created +
      relayed.handoffs.created +
      relayed.reminders.created +
      relayed.failures.created
    if (provisioned.created > 0 || created > 0) {
      payload.logger.info(
        `Feishu relay created ${provisioned.created} provisioning and ${created} delivery job(s)`,
      )
    }
  } catch {
    payload.logger.error('Feishu outbox relay failed; continuing worker loop')
  }
}

const runMaintenance = async (): Promise<void> => {
  await recoverDeadKnowledgeDocuments()
  if (!shouldRecoverStaleFeishuOAuth()) {
    await relayFeishuOutbox()
    return
  }
  try {
    const recovered = await recoverStaleFeishuOAuthCallbacks({ payload })
    if (recovered > 0) {
      payload.logger.warn(`Recovered ${recovered} stale Feishu OAuth callback(s)`)
    }
  } catch {
    payload.logger.error('Stale Feishu OAuth callback recovery failed; continuing worker loop')
  }
  await relayFeishuOutbox()
}

const stopWorker = (): void => {
  worker.stop()
}

process.once('SIGINT', stopWorker)
process.once('SIGTERM', stopWorker)

writeHeartbeat()
const heartbeat = setInterval(writeHeartbeat, heartbeatIntervalMs)
let exitCode = 0

try {
  try {
    await runMaintenance()
    const legacyRebuilds = await enqueueLegacyKnowledgeRebuilds({
      payload,
      requestedBy: null,
    })
    if (legacyRebuilds.created > 0 || legacyRebuilds.duplicate > 0 || legacyRebuilds.failed > 0) {
      payload.logger.info(
        `Legacy knowledge rebuild jobs: ${legacyRebuilds.created} created, ${legacyRebuilds.duplicate} already queued, ${legacyRebuilds.failed} failed`,
      )
    }
  } catch {
    payload.logger.error('Legacy knowledge rebuild scan failed; continuing worker startup')
  }
  payload.logger.info('Job worker started')
  await worker.runUntilStopped(runMaintenance)
} catch (error) {
  exitCode = 1
  payload.logger.error(error instanceof Error ? error.message : String(error))
} finally {
  clearInterval(heartbeat)
  await payload.destroy()
}

process.exit(exitCode)
