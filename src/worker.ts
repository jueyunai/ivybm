import { writeFileSync } from 'node:fs'

import { getPayload } from 'payload'

import { PayloadJobQueue } from '@/modules/jobs/claim'
import type { JobHandler } from '@/modules/jobs/contracts'
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
const payload = await getPayload({ config, disableOnInit: true, key: 'job-worker' })
const handlers: Record<string, JobHandler> = {
  [KNOWLEDGE_INDEX_JOB_TYPE]: createKnowledgeIndexJobHandler({ payload }),
  [PLATFORM_EVENT_JOB_TYPE]: createPlatformEventJobHandler({
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
    await recoverDeadKnowledgeDocuments()
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
  await worker.runUntilStopped(recoverDeadKnowledgeDocuments)
} catch (error) {
  exitCode = 1
  payload.logger.error(error instanceof Error ? error.message : String(error))
} finally {
  clearInterval(heartbeat)
  await payload.destroy()
}

process.exit(exitCode)
