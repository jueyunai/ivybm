import { randomUUID } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import type {
  LinkedInImagePublishingAuthorityPort,
  LinkedInImagePublishingClaim,
  LinkedInImagePublishingCommitResult,
  LinkedInImagePublishingIntent,
  LinkedInImagePublishingLeaseFence,
  LinkedInImagePublishingMarkResult,
  LinkedInImagePublishingTransition,
} from './linkedin/imagePublishingExecution'
import type {
  InstagramPublishingAuthorityPort,
  InstagramPublishingClaim,
  InstagramPublishingCommitResult,
  InstagramPublishingIntent,
  InstagramPublishingLeaseFence,
  InstagramPublishingMarkResult,
  InstagramPublishingTransition,
} from './meta/instagramPublishingExecution'
import type {
  PlatformPublicationAuthorityPort,
  PlatformPublicationClaim,
  PlatformPublicationCommitResult,
  PlatformPublicationIntent,
  PlatformPublicationLeaseFence,
  PlatformPublicationMarkResult,
} from './publishingAuthority'
import type { PlatformPublishExecutionTransition } from './publishingExecution'

type PublicationIntent =
  InstagramPublishingIntent | LinkedInImagePublishingIntent | PlatformPublicationIntent
type PublicationLease =
  InstagramPublishingLeaseFence | LinkedInImagePublishingLeaseFence | PlatformPublicationLeaseFence
type PublicationClaim =
  InstagramPublishingClaim | LinkedInImagePublishingClaim | PlatformPublicationClaim

type ClaimRow = {
  claim_id: string
  execution_revision: number | string
  fencing_generation: number | string
  provider_i_o_started_at: Date | string | null
}

type MutationResult = { rowCount?: number | null; rows?: unknown[] }

const relationID = (value: number | string): number | undefined => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

const summary = (value: string | undefined, fallback: string): string =>
  (value?.trim() || fallback).slice(0, 1_000)

const eventForDirect = (transition: PlatformPublishExecutionTransition) => {
  if (transition.status === 'delivery_unknown') return 'delivery-unknown'
  if (transition.status === 'failed') return 'failed'
  if (transition.status === 'accepted') return 'accepted'
  return 'status-updated'
}

const intentAccountId = (intent: PublicationIntent): number | string =>
  'snapshot' in intent ? intent.snapshot.platformAccountId : intent.platformAccountId

const intentIdempotencyKey = (intent: PublicationIntent): string =>
  'snapshot' in intent ? intent.snapshot.idempotencyKey : intent.idempotencyKey

const statusForStage = (stage: string) => {
  if (stage === 'published') return 'published'
  if (stage === 'failed') return 'failed'
  if (stage === 'delivery_unknown') return 'delivery_unknown'
  return 'publishing'
}

class PayloadPublicationCAS {
  constructor(
    private readonly payload: Payload,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get pool() {
    return (this.payload.db as unknown as PostgresAdapter).pool
  }

  async claim<Claim extends PublicationClaim>(
    intent: PublicationIntent,
    lease: PublicationLease,
  ): Promise<
    | { claim: Claim; status: 'claimed' }
    | {
        reason:
          | 'claim_conflict'
          | 'intent_mismatch'
          | 'lease_conflict'
          | 'missing_intent'
          | 'stale_revision'
        status: 'blocked'
      }
  > {
    const platformAccountId = relationID(intentAccountId(intent))
    if (!platformAccountId) return { reason: 'intent_mismatch', status: 'blocked' }
    const claimId = randomUUID()
    const result = await this.pool.query<ClaimRow>(
      `UPDATE publish_jobs AS p
       SET claim_job_id = j.id,
           claim_id = $1,
           claim_owner_token = $2,
           claim_lease_expires_at = j.lease_expires_at,
           fencing_generation = p.fencing_generation + 1,
           updated_at = $3
       FROM jobs AS j
       WHERE p.id = $4
         AND p.platform_account_id = $5
         AND p.idempotency_key = $6
         AND p.execution_revision = $7
         AND j.id = $8
         AND j.status = 'processing'
         AND j.owner_token = $2
         AND j.lease_expires_at = $9
         AND j.lease_expires_at > $3
         AND (j.payload->>'publishJobId')::bigint = p.id
         AND (p.claim_id IS NULL OR p.claim_lease_expires_at <= $3)
       RETURNING p.claim_id, p.execution_revision, p.fencing_generation, p.provider_i_o_started_at`,
      [
        claimId,
        lease.ownerToken,
        this.now().toISOString(),
        intent.publishJobId,
        platformAccountId,
        intentIdempotencyKey(intent),
        intent.expectedRevision,
        lease.queueJobId,
        lease.leaseExpiresAt,
      ],
    )
    const row = result.rows[0]
    if (!row) {
      const found = await this.pool.query<{ execution_revision: number | string }>(
        'SELECT execution_revision FROM publish_jobs WHERE id = $1 LIMIT 1',
        [intent.publishJobId],
      )
      if (!found.rows[0]) return { reason: 'missing_intent', status: 'blocked' }
      if (Number(found.rows[0].execution_revision) !== intent.expectedRevision) {
        return { reason: 'stale_revision', status: 'blocked' }
      }
      return { reason: 'lease_conflict', status: 'blocked' }
    }
    const claim = {
      claimId,
      fencingGeneration: Number(row.fencing_generation),
      intent: structuredClone(intent),
      leaseFence: structuredClone(lease),
      mode: row.provider_i_o_started_at ? 'recover' : 'send',
    } as Claim
    return { claim, status: 'claimed' }
  }

  async mark(
    claim: PublicationClaim,
  ): Promise<{ status: 'fenced' } | { reason: 'claim_conflict'; status: 'blocked' }> {
    const result = (await this.pool.query(
      `UPDATE publish_jobs AS p
       SET provider_i_o_started_at = $1, updated_at = $1
       FROM jobs AS j
       WHERE p.id = $2 AND p.execution_revision = $3 AND p.claim_id = $4
         AND p.fencing_generation = $5 AND p.claim_job_id = $6
         AND p.claim_owner_token = $7 AND p.claim_lease_expires_at = $8
         AND j.id = p.claim_job_id AND j.status = 'processing'
         AND j.owner_token = p.claim_owner_token AND j.lease_expires_at = p.claim_lease_expires_at
         AND j.lease_expires_at > $1 AND p.provider_i_o_started_at IS NULL`,
      [
        this.now().toISOString(),
        claim.intent.publishJobId,
        claim.intent.expectedRevision,
        claim.claimId,
        claim.fencingGeneration,
        claim.leaseFence.queueJobId,
        claim.leaseFence.ownerToken,
        claim.leaseFence.leaseExpiresAt,
      ],
    )) as MutationResult
    return result.rowCount === 1
      ? { status: 'fenced' }
      : { reason: 'claim_conflict', status: 'blocked' }
  }

  async commit(
    claim: PublicationClaim,
    update: {
      checkpoint?: unknown
      errorCode?: string
      event: string
      externalPublicationId?: string
      externalPublicationUrl?: string
      status: string
      summary: string
    },
  ): Promise<
    { nextRevision: number; status: 'committed' } | { reason: 'claim_conflict'; status: 'blocked' }
  > {
    const nextRevision = claim.intent.expectedRevision + 1
    const instant = this.now().toISOString()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query(
        `UPDATE publish_jobs AS p
         SET execution_revision = $1, status = $2::enum_publish_jobs_status, provider_checkpoint = COALESCE($3::jsonb, p.provider_checkpoint),
             external_publication_id = COALESCE($4, p.external_publication_id),
             external_publication_url = COALESCE($5, p.external_publication_url),
             last_error_code = $6, last_error_summary = $7,
             accepted_at = CASE WHEN $2::text = 'accepted' THEN COALESCE(p.accepted_at, $8) ELSE p.accepted_at END,
             published_at = CASE WHEN $2::text = 'published' THEN COALESCE(p.published_at, $8) ELSE p.published_at END,
             delivery_unknown_at = CASE WHEN $2::text = 'delivery_unknown' THEN COALESCE(p.delivery_unknown_at, $8) ELSE p.delivery_unknown_at END,
             claim_job_id = NULL, claim_id = NULL, claim_owner_token = NULL, claim_lease_expires_at = NULL,
             provider_i_o_started_at = NULL, updated_at = $8
         FROM jobs AS j
         WHERE p.id = $9 AND p.execution_revision = $10 AND p.claim_id = $11
           AND p.fencing_generation = $12 AND p.claim_job_id = $13
           AND p.claim_owner_token = $14 AND p.claim_lease_expires_at = $15
           AND j.id = p.claim_job_id AND j.status = 'processing'
           AND j.owner_token = p.claim_owner_token AND j.lease_expires_at = p.claim_lease_expires_at
           AND j.lease_expires_at > $8`,
        [
          nextRevision,
          update.status,
          update.checkpoint === undefined ? null : JSON.stringify(update.checkpoint),
          update.externalPublicationId ?? null,
          update.externalPublicationUrl ?? null,
          update.errorCode ?? null,
          update.errorCode ? update.summary : null,
          instant,
          claim.intent.publishJobId,
          claim.intent.expectedRevision,
          claim.claimId,
          claim.fencingGeneration,
          claim.leaseFence.queueJobId,
          claim.leaseFence.ownerToken,
          claim.leaseFence.leaseExpiresAt,
        ],
      )
      if (result.rowCount !== 1) {
        await client.query('ROLLBACK')
        return { reason: 'claim_conflict', status: 'blocked' }
      }
      await client.query(
        `INSERT INTO publish_logs (publish_job_id, event, summary, updated_at, created_at)
         VALUES ($1, $2, $3, $4, $4)`,
        [claim.intent.publishJobId, update.event, update.summary, instant],
      )
      await client.query('COMMIT')
      return { nextRevision, status: 'committed' }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async release(claim: PublicationClaim, allowStarted = false): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE publish_jobs
       SET claim_job_id = NULL, claim_id = NULL, claim_owner_token = NULL, claim_lease_expires_at = NULL,
           provider_i_o_started_at = NULL, updated_at = $1
       WHERE id = $2 AND execution_revision = $3 AND claim_id = $4 AND fencing_generation = $5
         AND claim_job_id = $6 AND claim_owner_token = $7
         AND ($8::boolean OR provider_i_o_started_at IS NULL)`,
      [
        this.now().toISOString(),
        claim.intent.publishJobId,
        claim.intent.expectedRevision,
        claim.claimId,
        claim.fencingGeneration,
        claim.leaseFence.queueJobId,
        claim.leaseFence.ownerToken,
        allowStarted,
      ],
    )
    return result.rowCount === 1
  }
}

export class PayloadPlatformPublicationAuthority implements PlatformPublicationAuthorityPort {
  private readonly cas: PayloadPublicationCAS
  constructor(options: { now?: () => Date; payload: Payload }) {
    this.cas = new PayloadPublicationCAS(options.payload, options.now)
  }
  claimPublication(intent: PlatformPublicationIntent, lease: PlatformPublicationLeaseFence) {
    return this.cas.claim<PlatformPublicationClaim>(intent, lease)
  }
  markProviderIOStarted(claim: PlatformPublicationClaim): Promise<PlatformPublicationMarkResult> {
    return this.cas.mark(claim)
  }
  commitPublication(
    claim: PlatformPublicationClaim,
    transition: PlatformPublishExecutionTransition,
  ): Promise<PlatformPublicationCommitResult> {
    if (transition.changed === false && transition.retryable === true) {
      return this.cas
        .release(claim, true)
        .then((released) =>
          released
            ? { nextRevision: claim.intent.expectedRevision, status: 'committed' as const }
            : { reason: 'claim_conflict' as const, status: 'blocked' as const },
        )
    }
    return this.cas.commit(claim, {
      errorCode: transition.lastErrorCode,
      event: eventForDirect(transition),
      externalPublicationId: transition.externalPublicationId,
      externalPublicationUrl: transition.externalPublicationUrl,
      status: transition.status,
      summary: summary(transition.summary, 'Publication state changed.'),
    })
  }
  async releasePublication(claim: PlatformPublicationClaim): Promise<void> {
    if (!(await this.cas.release(claim))) throw new Error('Publication claim could not be released')
  }
}

export class PayloadInstagramPublishingAuthority implements InstagramPublishingAuthorityPort {
  private readonly cas: PayloadPublicationCAS
  constructor(options: { now?: () => Date; payload: Payload }) {
    this.cas = new PayloadPublicationCAS(options.payload, options.now)
  }
  claimStage(intent: InstagramPublishingIntent, lease: InstagramPublishingLeaseFence) {
    return this.cas.claim<InstagramPublishingClaim>(intent, lease)
  }
  markProviderIOStarted(claim: InstagramPublishingClaim): Promise<InstagramPublishingMarkResult> {
    return this.cas.mark(claim)
  }
  commitStage(
    claim: InstagramPublishingClaim,
    transition: InstagramPublishingTransition,
  ): Promise<InstagramPublishingCommitResult> {
    if (transition.changed === false && transition.retryable === true) {
      return this.cas
        .release(claim, true)
        .then((released) =>
          released
            ? { nextRevision: claim.intent.expectedRevision, status: 'committed' as const }
            : { reason: 'claim_conflict' as const, status: 'blocked' as const },
        )
    }
    return this.cas.commit(claim, {
      checkpoint: transition.checkpoint,
      errorCode: transition.errorCode,
      event:
        transition.event === 'unknown'
          ? 'delivery-unknown'
          : transition.event === 'failed'
            ? 'failed'
            : 'checkpoint-committed',
      externalPublicationId: transition.checkpoint.mediaId,
      externalPublicationUrl: transition.checkpoint.permalink,
      status: statusForStage(transition.checkpoint.stage),
      summary: summary(transition.summary, 'Instagram checkpoint changed.'),
    })
  }
  async releaseStage(claim: InstagramPublishingClaim): Promise<void> {
    if (!(await this.cas.release(claim))) throw new Error('Instagram claim could not be released')
  }
}

export class PayloadLinkedInImagePublishingAuthority implements LinkedInImagePublishingAuthorityPort {
  private readonly cas: PayloadPublicationCAS
  constructor(options: { now?: () => Date; payload: Payload }) {
    this.cas = new PayloadPublicationCAS(options.payload, options.now)
  }
  claimStage(intent: LinkedInImagePublishingIntent, lease: LinkedInImagePublishingLeaseFence) {
    return this.cas.claim<LinkedInImagePublishingClaim>(intent, lease)
  }
  markProviderIOStarted(
    claim: LinkedInImagePublishingClaim,
  ): Promise<LinkedInImagePublishingMarkResult> {
    return this.cas.mark(claim)
  }
  commitStage(
    claim: LinkedInImagePublishingClaim,
    transition: LinkedInImagePublishingTransition,
  ): Promise<LinkedInImagePublishingCommitResult> {
    return this.cas.commit(claim, {
      checkpoint: transition.checkpoint,
      errorCode: transition.errorCode,
      event:
        transition.event === 'unknown'
          ? 'delivery-unknown'
          : transition.event === 'failed'
            ? 'failed'
            : 'checkpoint-committed',
      externalPublicationId: transition.checkpoint.postUrn,
      externalPublicationUrl: transition.checkpoint.postUrl,
      status: statusForStage(transition.checkpoint.stage),
      summary: summary(transition.summary, 'LinkedIn image checkpoint changed.'),
    })
  }
  async releaseStage(claim: LinkedInImagePublishingClaim): Promise<void> {
    if (!(await this.cas.release(claim))) throw new Error('LinkedIn claim could not be released')
  }
  async releaseProvenPreIOFailure(
    claim: LinkedInImagePublishingClaim,
  ): Promise<LinkedInImagePublishingMarkResult> {
    return (await this.cas.release(claim, true))
      ? { status: 'fenced' }
      : { reason: 'claim_conflict', status: 'blocked' }
  }
}
