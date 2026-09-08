import { randomUUID } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import type { PlatformConversationDeliveryAuthorityPort } from './ports'
import type {
  PlatformConversationDeliveryClaim,
  PlatformConversationDeliveryClaimResult,
  PlatformConversationDeliveryIntent,
  PlatformConversationDeliveryLeaseFence,
  PlatformConversationDeliveryMarkResult,
  PlatformConversationDeliveryOutcome,
} from './types'

type IntentRow = {
  account_external_id: string
  ai_auto_reply_enabled: boolean
  claim_id: string | null
  claim_lease_expires_at: Date | string | null
  conversation_id: number
  delivery_key: string
  expected_revision: number | string
  fencing_generation: number | string
  handoff_status: string
  platform: 'facebook-messenger' | 'instagram'
  provider_i_o_started_at: Date | string | null
  queue_job_id: number
  recipient_external_id: string
  reply_message_id: number
  required_handoff_status: 'ai_active' | 'human_active'
  revision: number | string
  status: string
  text: string
}

const sameIntent = (row: IntentRow, intent: PlatformConversationDeliveryIntent): boolean =>
  row.conversation_id === Number(intent.conversationId) &&
  Number(row.expected_revision) === intent.expectedRevision &&
  row.queue_job_id === intent.jobId &&
  row.reply_message_id === Number(intent.replyId) &&
  row.account_external_id === intent.transport.accountExternalId &&
  row.delivery_key === intent.transport.deliveryKey &&
  row.platform === intent.transport.platform &&
  row.recipient_external_id === intent.transport.recipientExternalId &&
  row.text === intent.transport.text

const leaseIsCurrent = (
  row: { lease_expires_at: Date | string; owner_token: string; status: string } | undefined,
  lease: PlatformConversationDeliveryLeaseFence,
  now: Date,
): boolean =>
  Boolean(
    row &&
    row.status === 'processing' &&
    row.owner_token === lease.ownerToken &&
    new Date(row.lease_expires_at).getTime() >= new Date(lease.leaseExpiresAt).getTime() &&
    new Date(row.lease_expires_at).getTime() > now.getTime(),
  )

const transitionFor = (outcome: PlatformConversationDeliveryOutcome) => {
  if (outcome.status === 'accepted' || outcome.status === 'duplicate') {
    return {
      errorCode: null,
      intentStatus: 'accepted',
      messageStatus: 'sent',
      providerReference: null,
      retryAfterSeconds: null,
      retryable: false,
    } as const
  }
  if (outcome.status === 'provider_accepted') {
    return {
      errorCode: null,
      intentStatus: 'accepted',
      messageStatus: 'sent',
      providerReference: outcome.providerReference,
      retryAfterSeconds: null,
      retryable: false,
    } as const
  }
  if (outcome.status === 'delivery_unknown') {
    return {
      errorCode: 'delivery_unknown',
      intentStatus: 'delivery_unknown',
      messageStatus: 'failed',
      providerReference: null,
      retryAfterSeconds: null,
      retryable: false,
    } as const
  }
  if (outcome.status === 'retry_same_delivery_key') {
    return {
      errorCode: 'provider_unavailable',
      intentStatus: 'retrying',
      messageStatus: 'pending',
      providerReference: null,
      retryAfterSeconds: null,
      retryable: true,
    } as const
  }
  if (outcome.status === 'blocked') {
    return {
      errorCode: outcome.errorCode,
      intentStatus: outcome.retryable ? 'retrying' : 'blocked',
      messageStatus: outcome.retryable ? 'pending' : 'failed',
      providerReference: null,
      retryAfterSeconds: outcome.retryAfterSeconds ?? null,
      retryable: outcome.retryable,
    } as const
  }
  throw new Error(`Unsupported conversation delivery outcome: ${outcome.status}`)
}

export class PayloadPlatformConversationDeliveryAuthority implements PlatformConversationDeliveryAuthorityPort {
  constructor(
    private readonly payload: Payload,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get pool() {
    return (this.payload.db as unknown as PostgresAdapter).pool
  }

  async claimDelivery(
    intent: PlatformConversationDeliveryIntent,
    leaseFence: PlatformConversationDeliveryLeaseFence,
  ): Promise<PlatformConversationDeliveryClaimResult> {
    if (intent.jobId !== leaseFence.jobId) {
      return { reason: 'intent_mismatch', status: 'blocked' }
    }
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const found = await client.query<IntentRow>(
        `SELECT d.*, c.revision, c.handoff_status, pa.ai_auto_reply_enabled
         FROM conversation_delivery_intents AS d
         JOIN conversations AS c ON c.id = d.conversation_id
         JOIN platform_accounts AS pa
           ON pa.external_account_id = d.account_external_id
          AND (
            (d.platform::text = 'facebook-messenger' AND pa.account_kind::text = 'facebook-page')
            OR
            (d.platform::text = 'instagram' AND pa.account_kind::text = 'instagram-professional')
          )
         WHERE d.queue_job_id = $1 AND d.delivery_key = $2
         FOR UPDATE OF c, d, pa`,
        [intent.jobId, intent.transport.deliveryKey],
      )
      const row = found.rows[0]
      if (!row) {
        await client.query('ROLLBACK')
        return { reason: 'missing_intent', status: 'blocked' }
      }
      if (!sameIntent(row, intent)) {
        await client.query('ROLLBACK')
        return { reason: 'intent_mismatch', status: 'blocked' }
      }
      if (row.status !== 'queued' && row.status !== 'retrying') {
        await client.query('ROLLBACK')
        return { reason: 'intent_mismatch', status: 'blocked' }
      }
      const instant = this.now()
      const job = await client.query<{
        lease_expires_at: Date | string
        owner_token: string
        status: string
      }>('SELECT status, owner_token, lease_expires_at FROM jobs WHERE id = $1 FOR UPDATE', [
        intent.jobId,
      ])
      if (!leaseIsCurrent(job.rows[0], leaseFence, instant)) {
        await client.query('ROLLBACK')
        return { reason: 'lease_conflict', status: 'blocked' }
      }
      const claimExpired =
        !row.claim_lease_expires_at ||
        new Date(row.claim_lease_expires_at).getTime() <= instant.getTime()
      if (row.claim_id && !claimExpired) {
        await client.query('ROLLBACK')
        return { reason: 'busy', status: 'blocked' }
      }
      const mode = row.provider_i_o_started_at ? 'recover' : 'send'
      if (
        mode === 'send' &&
        row.required_handoff_status === 'ai_active' &&
        row.ai_auto_reply_enabled !== true
      ) {
        await client.query(
          `UPDATE conversation_delivery_intents
           SET status = 'blocked'::enum_conversation_delivery_intents_status,
               last_error_code = 'ai_auto_reply_paused',
               last_error_summary = 'AI auto reply is paused for this account.',
               retryable = false, updated_at = $1
           WHERE queue_job_id = $2 AND delivery_key = $3`,
          [instant.toISOString(), intent.jobId, intent.transport.deliveryKey],
        )
        await client.query(
          `UPDATE messages SET status = 'failed'::enum_messages_status, error_code = 'ai_auto_reply_paused', updated_at = $1 WHERE id = $2`,
          [instant.toISOString(), row.reply_message_id],
        )
        await client.query('COMMIT')
        return { reason: 'ai_auto_reply_paused', status: 'blocked' }
      }
      if (mode === 'send' && row.handoff_status !== row.required_handoff_status) {
        await client.query(
          `UPDATE conversation_delivery_intents
           SET status = 'blocked'::enum_conversation_delivery_intents_status,
               last_error_code = 'handoff_required',
               last_error_summary = 'Conversation handoff state no longer permits delivery.',
               retryable = false, updated_at = $1
           WHERE queue_job_id = $2 AND delivery_key = $3`,
          [instant.toISOString(), intent.jobId, intent.transport.deliveryKey],
        )
        await client.query(
          `UPDATE messages
           SET status = 'failed'::enum_messages_status, error_code = 'handoff_required',
               updated_at = $1
           WHERE id = $2`,
          [instant.toISOString(), row.reply_message_id],
        )
        await client.query('COMMIT')
        return { reason: 'handoff_required', status: 'blocked' }
      }
      if (mode === 'send' && Number(row.revision) !== intent.expectedRevision) {
        await client.query(
          `UPDATE conversation_delivery_intents
           SET status = 'blocked'::enum_conversation_delivery_intents_status,
               last_error_code = 'stale_revision',
               last_error_summary = 'Conversation revision no longer permits delivery.',
               retryable = false, updated_at = $1
           WHERE queue_job_id = $2 AND delivery_key = $3`,
          [instant.toISOString(), intent.jobId, intent.transport.deliveryKey],
        )
        await client.query(
          `UPDATE messages
           SET status = 'failed'::enum_messages_status, error_code = 'stale_revision',
               updated_at = $1
           WHERE id = $2`,
          [instant.toISOString(), row.reply_message_id],
        )
        await client.query('COMMIT')
        return { reason: 'stale_revision', status: 'blocked' }
      }

      const claimId = randomUUID()
      const updated = await client.query<{ fencing_generation: number | string }>(
        `UPDATE conversation_delivery_intents
         SET claim_id = $1, claim_owner_token = $2, claim_lease_expires_at = $3,
             fencing_generation = fencing_generation + 1,
             status = CASE WHEN $4::boolean THEN 'retrying'::enum_conversation_delivery_intents_status ELSE status END,
             updated_at = $5
         WHERE queue_job_id = $6 AND delivery_key = $7
         RETURNING fencing_generation`,
        [
          claimId,
          leaseFence.ownerToken,
          leaseFence.leaseExpiresAt,
          mode === 'recover',
          instant.toISOString(),
          intent.jobId,
          intent.transport.deliveryKey,
        ],
      )
      const fencingGeneration = Number(updated.rows[0]?.fencing_generation)
      if (!Number.isSafeInteger(fencingGeneration) || fencingGeneration < 1) {
        await client.query('ROLLBACK')
        return { reason: 'claim_conflict', status: 'blocked' }
      }
      await client.query('COMMIT')
      const claim: PlatformConversationDeliveryClaim = {
        claimId,
        fencingGeneration,
        intent: structuredClone(intent),
        leaseFence: structuredClone(leaseFence),
        mode,
      }
      return { claim, status: 'claimed' }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async markProviderIOStarted(
    claim: PlatformConversationDeliveryClaim,
  ): Promise<PlatformConversationDeliveryMarkResult> {
    const instant = this.now().toISOString()
    const result = await this.pool.query(
      `UPDATE conversation_delivery_intents AS d
       SET provider_i_o_started_at = $1, updated_at = $1
       FROM conversations AS c, jobs AS j
       WHERE d.queue_job_id = $2 AND d.delivery_key = $3
         AND d.expected_revision = $4 AND d.reply_message_id = $5
         AND d.claim_id = $6 AND d.fencing_generation = $7
         AND d.claim_owner_token = $8 AND d.claim_lease_expires_at = $9
         AND d.provider_i_o_started_at IS NULL
         AND c.id = d.conversation_id AND c.revision = d.expected_revision
         AND c.handoff_status::text = d.required_handoff_status::text
         AND j.id = d.queue_job_id AND j.status = 'processing'
         AND j.owner_token = d.claim_owner_token
         AND j.lease_expires_at >= d.claim_lease_expires_at
         AND j.lease_expires_at > $1`,
      [
        instant,
        claim.intent.jobId,
        claim.intent.transport.deliveryKey,
        claim.intent.expectedRevision,
        Number(claim.intent.replyId),
        claim.claimId,
        claim.fencingGeneration,
        claim.leaseFence.ownerToken,
        claim.leaseFence.leaseExpiresAt,
      ],
    )
    return result.rowCount === 1
      ? { status: 'fenced' }
      : { reason: 'claim_conflict', status: 'blocked' }
  }

  async releaseDelivery(
    claim: PlatformConversationDeliveryClaim,
    outcome?: PlatformConversationDeliveryOutcome,
  ): Promise<void> {
    const instant = this.now().toISOString()
    if (!outcome) {
      const released = await this.pool.query(
        `UPDATE conversation_delivery_intents
         SET claim_id = NULL, claim_owner_token = NULL, claim_lease_expires_at = NULL,
             updated_at = $1
         WHERE queue_job_id = $2 AND delivery_key = $3 AND expected_revision = $4
           AND claim_id = $5 AND fencing_generation = $6
           AND claim_owner_token = $7 AND provider_i_o_started_at IS NULL`,
        [
          instant,
          claim.intent.jobId,
          claim.intent.transport.deliveryKey,
          claim.intent.expectedRevision,
          claim.claimId,
          claim.fencingGeneration,
          claim.leaseFence.ownerToken,
        ],
      )
      if (released.rowCount !== 1)
        throw new Error('Conversation delivery claim could not be released')
      return
    }

    const transition = transitionFor(outcome)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const updated = await client.query<{ reply_message_id: number }>(
        `UPDATE conversation_delivery_intents AS d
         SET status = $1::enum_conversation_delivery_intents_status,
             provider_reference = COALESCE($2, d.provider_reference),
             last_error_code = $3, last_error_summary = $4,
             retryable = $5, retry_after_seconds = $6,
             accepted_at = CASE WHEN $1::text = 'accepted' THEN COALESCE(d.accepted_at, $7) ELSE d.accepted_at END,
             delivery_unknown_at = CASE WHEN $1::text = 'delivery_unknown' THEN COALESCE(d.delivery_unknown_at, $7) ELSE d.delivery_unknown_at END,
             claim_id = NULL, claim_owner_token = NULL, claim_lease_expires_at = NULL,
             provider_i_o_started_at = CASE WHEN $1::text = 'retrying' THEN NULL ELSE d.provider_i_o_started_at END,
             updated_at = $7
         FROM jobs AS j
         WHERE d.queue_job_id = $8 AND d.delivery_key = $9 AND d.expected_revision = $10
           AND d.claim_id = $11 AND d.fencing_generation = $12
           AND d.claim_owner_token = $13 AND d.claim_lease_expires_at = $14
           AND j.id = d.queue_job_id AND j.status = 'processing'
           AND j.owner_token = d.claim_owner_token
           AND j.lease_expires_at >= d.claim_lease_expires_at
           AND j.lease_expires_at > $7
         RETURNING d.reply_message_id`,
        [
          transition.intentStatus,
          transition.providerReference,
          transition.errorCode,
          transition.errorCode ? 'Platform conversation delivery did not complete.' : null,
          transition.retryable,
          transition.retryAfterSeconds,
          instant,
          claim.intent.jobId,
          claim.intent.transport.deliveryKey,
          claim.intent.expectedRevision,
          claim.claimId,
          claim.fencingGeneration,
          claim.leaseFence.ownerToken,
          claim.leaseFence.leaseExpiresAt,
        ],
      )
      const replyMessageId = updated.rows[0]?.reply_message_id
      if (!replyMessageId) throw new Error('Conversation delivery claim is stale')
      await client.query(
        `UPDATE messages SET status = $1::enum_messages_status, error_code = $2, updated_at = $3
         WHERE id = $4`,
        [transition.messageStatus, transition.errorCode, instant, replyMessageId],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}
