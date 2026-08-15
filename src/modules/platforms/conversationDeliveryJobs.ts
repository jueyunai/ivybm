import { createHash } from 'node:crypto'

import type { Payload } from 'payload'

import type { ChatChannel } from '@/modules/conversations/contracts'
import {
  JobLeaseLostError,
  type ClaimedJob,
  type JobExecution,
  type JobHandler,
} from '@/modules/jobs/contracts'

import { PlatformConversationDeliveryPersistenceError } from './conversationDelivery'
import type { PlatformConversationDeliveryService } from './ports'
import type { MessagingPlatform, PlatformConversationDeliveryIntent } from './types'

export const PLATFORM_CONVERSATION_DELIVERY_JOB_TYPE = 'platform.conversation.deliver'

export type PlatformConversationDeliveryJobPayload = {
  deliveryKey: string
}

export class PlatformConversationDeliveryJobError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlatformConversationDeliveryJobError'
  }
}

export const messagingPlatformForChannel = (
  channel: ChatChannel,
): Extract<MessagingPlatform, 'facebook-messenger' | 'instagram'> | undefined => {
  if (channel === 'facebook') return 'facebook-messenger'
  if (channel === 'instagram') return 'instagram'
  return undefined
}

export const createPlatformConversationDeliveryKey = ({
  accountExternalId,
  messageId,
  platform,
}: {
  accountExternalId: string
  messageId: number | string
  platform: Extract<MessagingPlatform, 'facebook-messenger' | 'instagram'>
}): string => {
  const digest = createHash('sha256')
    .update(`${platform}\u0000${accountExternalId}\u0000${String(messageId)}`)
    .digest('hex')
  return `conversation-delivery:v1:${platform}:${digest}`
}

export const parsePlatformConversationDeliveryJobPayload = (
  value: Record<string, unknown>,
): PlatformConversationDeliveryJobPayload => {
  const deliveryKey = typeof value.deliveryKey === 'string' ? value.deliveryKey.trim() : ''
  if (
    !deliveryKey ||
    deliveryKey !== value.deliveryKey ||
    deliveryKey.length > 200 ||
    !/^conversation-delivery:v1:(facebook-messenger|instagram):[a-f0-9]{64}$/u.test(deliveryKey)
  ) {
    throw new Error('Platform conversation delivery job payload is invalid')
  }
  return { deliveryKey }
}

const relationshipID = (value: number | { id: number }): number =>
  typeof value === 'number' ? value : value.id

const loadDeliveryIntent = async (
  payload: Payload,
  job: ClaimedJob,
  deliveryKey: string,
): Promise<PlatformConversationDeliveryIntent> => {
  const result = await payload.find({
    collection: 'conversation-delivery-intents',
    depth: 0,
    limit: 2,
    overrideAccess: true,
    pagination: false,
    where: {
      and: [{ deliveryKey: { equals: deliveryKey } }, { queueJob: { equals: job.id } }],
    },
  })
  if (result.docs.length !== 1) {
    throw new PlatformConversationDeliveryJobError(
      'Platform conversation delivery intent is missing or ambiguous',
    )
  }
  const persisted = result.docs[0]
  const queueJobId = relationshipID(persisted.queueJob)
  if (queueJobId !== job.id || persisted.deliveryKey !== deliveryKey) {
    throw new PlatformConversationDeliveryJobError(
      'Platform conversation delivery intent does not match its Job',
    )
  }

  return {
    conversationId: relationshipID(persisted.conversation),
    expectedRevision: persisted.expectedRevision,
    jobId: queueJobId,
    replyId: relationshipID(persisted.replyMessage),
    transport: {
      accountExternalId: persisted.accountExternalId,
      deliveryKey: persisted.deliveryKey,
      platform: persisted.platform,
      recipientExternalId: persisted.recipientExternalId,
      text: persisted.text,
    },
  }
}

export const createPlatformConversationDeliveryJobHandler = ({
  delivery,
  payload,
}: {
  delivery: PlatformConversationDeliveryService
  payload: Payload
}): JobHandler =>
  async function platformConversationDeliveryJobHandler(
    job: ClaimedJob,
    execution: JobExecution,
  ): Promise<void> {
    const { deliveryKey } = parsePlatformConversationDeliveryJobPayload(job.payload)
    execution.assertLease()
    const intent = await loadDeliveryIntent(payload, job, deliveryKey)
    execution.assertLease()
    let outcome
    try {
      outcome = await delivery.deliver(intent, {
        jobId: job.id,
        leaseExpiresAt: job.leaseExpiresAt,
        ownerToken: job.ownerToken,
      })
    } catch (error) {
      if (error instanceof PlatformConversationDeliveryPersistenceError) {
        // Do not queue.fail after provider I/O. Leaving the current lease in
        // processing makes the next owner reclaim this intent in recover mode.
        throw new JobLeaseLostError(
          'Platform conversation delivery persistence is deferred to lease recovery',
          error,
        )
      }
      throw error
    }
    execution.assertLease()

    if (outcome.status === 'blocked' && outcome.retryable) {
      throw new PlatformConversationDeliveryJobError(
        `Platform conversation delivery is retryable: ${outcome.errorCode}`,
      )
    }
  }
