import { writeFileSync } from 'node:fs'

import { getPayload } from 'payload'

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
import { recoverStaleFeishuOAuthCallbacks } from '@/modules/feishu/appRegistration'
import {
  DEFAULT_JOB_HEARTBEAT_INTERVAL_MS,
  DEFAULT_JOB_POLL_INTERVAL_MS,
  JobWorker,
} from '@/modules/jobs/worker'
import {
  createKnowledgeIndexJobHandler,
  enqueueLegacyKnowledgeRebuilds,
  KNOWLEDGE_INDEX_JOB_TYPE,
  recoverDeadKnowledgeIndexDocuments,
} from '@/modules/knowledge/jobs'
import {
  createPlatformEventJobHandler,
  PLATFORM_EVENT_JOB_TYPE,
} from '@/modules/platforms/eventJobs'
import { PayloadPlatformConversationPort } from '@/modules/platforms/payloadConversationPort'
import { PayloadPlatformMessagingAccountAuthorizer } from '@/modules/platforms/payloadMessagingAccountAuthorizer'
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
const payload = await getPayload({ config, disableOnInit: true, key: 'job-worker' })
const handlers: Record<string, JobHandler> = {
  [FEISHU_CONNECTION_PROVISION_JOB_TYPE]: createFeishuConnectionProvisionJobHandler({ payload }),
  [FEISHU_FOLLOW_UP_REMINDER_JOB_TYPE]: createFeishuFollowUpReminderJobHandler({ payload }),
  [FEISHU_HANDOFF_NOTIFY_JOB_TYPE]: createFeishuHandoffNotifyJobHandler({ payload }),
  [FEISHU_LEAD_SYNC_FAILURE_JOB_TYPE]: createFeishuLeadSyncFailureJobHandler({ payload }),
  [FEISHU_LEAD_SYNC_JOB_TYPE]: createFeishuLeadSyncJobHandler({ payload }),
  [KNOWLEDGE_INDEX_JOB_TYPE]: createKnowledgeIndexJobHandler({ payload }),
  [PLATFORM_EVENT_JOB_TYPE]: createPlatformEventJobHandler({
    accountAuthorizer: new PayloadPlatformMessagingAccountAuthorizer({ payload }),
    conversations: new PayloadPlatformConversationPort({ payload }),
  }),
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
