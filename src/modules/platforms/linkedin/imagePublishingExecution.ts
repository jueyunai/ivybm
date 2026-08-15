import { createHash } from 'node:crypto'

import {
  ProviderPublicationConfirmedError,
  ProviderPublicationResultUnknownError,
  ProviderPublicationTransportError,
} from '../publishingResult'
import type { LinkedInImageUploadTicket, LinkedInPublishingTransport } from './publishingOutbound'
import { linkedInPostPermalink, type LinkedInAuthorUrnInput } from './publishingRequests'

export const LINKEDIN_IMAGE_PUBLISHING_STAGES = [
  'scheduled',
  'image_initialized',
  'image_uploaded',
  'published',
  'failed',
  'delivery_unknown',
] as const

export type LinkedInImagePublishingStage = (typeof LINKEDIN_IMAGE_PUBLISHING_STAGES)[number]

export type LinkedInImageAssetIdentity = {
  byteLength: number
  contentType: 'image/gif' | 'image/jpeg' | 'image/png'
  id: string
  sha256: string
}

export type LinkedInImagePublishingCheckpoint = {
  altText?: string
  author: LinkedInAuthorUrnInput
  authorizationRevision: number
  commentary: string
  imageUrn?: string
  postUrn?: string
  postUrl?: string
  stage: LinkedInImagePublishingStage
  uploadTicket?: LinkedInImageUploadTicket
}

export type LinkedInImagePublishingIntent = {
  asset: LinkedInImageAssetIdentity
  checkpoint: LinkedInImagePublishingCheckpoint
  expectedRevision: number
  idempotencyKey: string
  publishJobId: number
  platform: 'linkedin'
  platformAccountId: number | string
}

export type LinkedInImageAssetReader = (
  asset: LinkedInImageAssetIdentity,
) => Promise<Uint8Array | null>

export type LinkedInImagePublishingLeaseFence = {
  leaseExpiresAt: string
  ownerToken: string
  queueJobId: number
}

export const LINKEDIN_IMAGE_PUBLISHING_BLOCK_REASONS = [
  'busy',
  'claim_conflict',
  'intent_mismatch',
  'lease_conflict',
  'missing_intent',
  'stale_revision',
] as const

export type LinkedInImagePublishingBlockReason =
  (typeof LINKEDIN_IMAGE_PUBLISHING_BLOCK_REASONS)[number]

export type LinkedInImagePublishingClaim = {
  claimId: string
  fencingGeneration: number
  intent: LinkedInImagePublishingIntent
  leaseFence: LinkedInImagePublishingLeaseFence
  /** Reclaimed mutations are terminally unknown and never replayed. */
  mode: 'recover' | 'send'
}

export type LinkedInImagePublishingClaimResult =
  | { claim: LinkedInImagePublishingClaim; status: 'claimed' }
  | { reason: LinkedInImagePublishingBlockReason; status: 'blocked' }

export type LinkedInImagePublishingMarkResult =
  { status: 'fenced' } | { reason: LinkedInImagePublishingBlockReason; status: 'blocked' }

export type LinkedInImagePublishingCommitResult =
  | { nextRevision: number; status: 'committed' }
  | { reason: LinkedInImagePublishingBlockReason; status: 'blocked' }

export type LinkedInImagePublishingTransition = {
  changed: boolean
  checkpoint: LinkedInImagePublishingCheckpoint
  errorCode?: string
  event?: 'blocked' | 'failed' | 'image-initialized' | 'image-uploaded' | 'published' | 'unknown'
  retryable?: boolean
  summary?: string
}

export interface LinkedInImagePublishingAuthorityPort {
  claimStage(
    intent: LinkedInImagePublishingIntent,
    leaseFence: LinkedInImagePublishingLeaseFence,
  ): Promise<LinkedInImagePublishingClaimResult>
  markProviderIOStarted(
    claim: LinkedInImagePublishingClaim,
  ): Promise<LinkedInImagePublishingMarkResult>
  commitStage(
    claim: LinkedInImagePublishingClaim,
    transition: LinkedInImagePublishingTransition,
  ): Promise<LinkedInImagePublishingCommitResult>
  /** Atomically clear a persisted I/O marker only after the adapter proves fetch never began. */
  releaseProvenPreIOFailure(
    claim: LinkedInImagePublishingClaim,
  ): Promise<LinkedInImagePublishingMarkResult>
  /** Valid only if markProviderIOStarted did not succeed. */
  releaseStage(claim: LinkedInImagePublishingClaim): Promise<void>
}

const terminal = new Set<LinkedInImagePublishingStage>(['delivery_unknown', 'failed', 'published'])

const boundedString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (
    !normalized ||
    normalized !== value ||
    normalized.length > maxLength ||
    /[\u0000-\u001F\u007F-\u009F]/u.test(normalized)
  ) {
    return undefined
  }
  return normalized
}

const normalizeAuthor = (input: unknown): LinkedInAuthorUrnInput | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const author = input as Partial<LinkedInAuthorUrnInput>
  if (author.kind === 'person') {
    const personId = boundedString(author.personId, 128)
    return personId && /^[A-Za-z0-9_-]+$/u.test(personId) ? { kind: 'person', personId } : undefined
  }
  if (author.kind === 'organization') {
    const organizationId = boundedString(author.organizationId, 32)
    return organizationId && /^\d+$/u.test(organizationId)
      ? { kind: 'organization', organizationId }
      : undefined
  }
  return undefined
}

const normalizeTicket = (input: unknown): LinkedInImageUploadTicket | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const ticket = input as Partial<LinkedInImageUploadTicket>
  const imageUrn = boundedString(ticket.imageUrn, 256)
  const sealedUpload = boundedString(ticket.sealedUpload, 8_192)
  if (
    !imageUrn ||
    !/^urn:li:image:[A-Za-z0-9_-]+$/u.test(imageUrn) ||
    !sealedUpload ||
    !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(sealedUpload) ||
    typeof ticket.uploadUrlExpiresAt !== 'number' ||
    !Number.isSafeInteger(ticket.uploadUrlExpiresAt) ||
    ticket.uploadUrlExpiresAt < 1_000_000_000_000
  ) {
    return undefined
  }
  return { imageUrn, sealedUpload, uploadUrlExpiresAt: ticket.uploadUrlExpiresAt }
}

const normalizeAsset = (input: unknown): LinkedInImageAssetIdentity | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const asset = input as Partial<LinkedInImageAssetIdentity>
  const id = boundedString(asset.id, 240)
  const sha256 = boundedString(asset.sha256, 64)?.toLowerCase()
  if (
    !id ||
    !sha256 ||
    !/^[a-f0-9]{64}$/u.test(sha256) ||
    typeof asset.byteLength !== 'number' ||
    !Number.isSafeInteger(asset.byteLength) ||
    asset.byteLength < 1 ||
    !['image/gif', 'image/jpeg', 'image/png'].includes(asset.contentType ?? '')
  ) {
    return undefined
  }
  return {
    byteLength: asset.byteLength,
    contentType: asset.contentType as LinkedInImageAssetIdentity['contentType'],
    id,
    sha256,
  }
}

const normalizeCheckpoint = (input: unknown): LinkedInImagePublishingCheckpoint | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const checkpoint = input as Partial<LinkedInImagePublishingCheckpoint>
  const author = normalizeAuthor(checkpoint.author)
  const commentary = boundedString(checkpoint.commentary, 3_000)
  const altText =
    checkpoint.altText === undefined ? undefined : boundedString(checkpoint.altText, 300)
  const imageUrn =
    checkpoint.imageUrn === undefined ? undefined : boundedString(checkpoint.imageUrn, 256)
  const postUrn =
    checkpoint.postUrn === undefined ? undefined : boundedString(checkpoint.postUrn, 256)
  const postUrl =
    checkpoint.postUrl === undefined ? undefined : boundedString(checkpoint.postUrl, 2_000)
  const uploadTicket =
    checkpoint.uploadTicket === undefined ? undefined : normalizeTicket(checkpoint.uploadTicket)
  if (
    !author ||
    !Number.isSafeInteger(checkpoint.authorizationRevision) ||
    (checkpoint.authorizationRevision as number) < 0 ||
    !commentary ||
    (checkpoint.altText !== undefined && !altText) ||
    (checkpoint.imageUrn !== undefined &&
      (!imageUrn || !/^urn:li:image:[A-Za-z0-9_-]+$/u.test(imageUrn))) ||
    (checkpoint.postUrn !== undefined &&
      (!postUrn || !/^urn:li:(?:share|ugcPost):\d+$/u.test(postUrn))) ||
    (checkpoint.postUrl !== undefined &&
      (!postUrn || !postUrl || postUrl !== linkedInPostPermalink(postUrn))) ||
    (checkpoint.uploadTicket !== undefined && !uploadTicket) ||
    !LINKEDIN_IMAGE_PUBLISHING_STAGES.includes(checkpoint.stage as LinkedInImagePublishingStage)
  ) {
    return undefined
  }
  if (
    checkpoint.stage === 'scheduled' &&
    (imageUrn !== undefined ||
      uploadTicket !== undefined ||
      postUrn !== undefined ||
      postUrl !== undefined)
  ) {
    return undefined
  }
  if (
    checkpoint.stage === 'image_initialized' &&
    (!imageUrn ||
      !uploadTicket ||
      uploadTicket.imageUrn !== imageUrn ||
      postUrn !== undefined ||
      postUrl !== undefined)
  ) {
    return undefined
  }
  if (
    checkpoint.stage === 'image_uploaded' &&
    (!imageUrn || uploadTicket !== undefined || postUrn !== undefined || postUrl !== undefined)
  ) {
    return undefined
  }
  if (checkpoint.stage === 'published' && (!postUrn || !imageUrn)) return undefined
  if (
    (checkpoint.stage === 'failed' || checkpoint.stage === 'delivery_unknown') &&
    uploadTicket !== undefined
  ) {
    return undefined
  }
  return {
    ...(altText ? { altText } : {}),
    author,
    authorizationRevision: checkpoint.authorizationRevision as number,
    commentary,
    ...(imageUrn ? { imageUrn } : {}),
    ...(postUrn ? { postUrn } : {}),
    ...(postUrl ? { postUrl } : {}),
    stage: checkpoint.stage as LinkedInImagePublishingStage,
    ...(uploadTicket ? { uploadTicket } : {}),
  }
}

const normalizeIntent = (input: unknown): LinkedInImagePublishingIntent | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const intent = input as Partial<LinkedInImagePublishingIntent>
  const asset = normalizeAsset(intent.asset)
  const checkpoint = normalizeCheckpoint(intent.checkpoint)
  const idempotencyKey = boundedString(intent.idempotencyKey, 200)
  if (
    !asset ||
    !checkpoint ||
    !idempotencyKey ||
    intent.platform !== 'linkedin' ||
    !Number.isSafeInteger(intent.expectedRevision) ||
    (intent.expectedRevision as number) < 0 ||
    !Number.isSafeInteger(intent.publishJobId) ||
    (intent.publishJobId as number) < 1 ||
    !(
      (typeof intent.platformAccountId === 'number' &&
        Number.isSafeInteger(intent.platformAccountId) &&
        intent.platformAccountId > 0) ||
      boundedString(intent.platformAccountId, 200)
    )
  ) {
    return undefined
  }
  return {
    asset,
    checkpoint,
    expectedRevision: intent.expectedRevision as number,
    idempotencyKey,
    publishJobId: intent.publishJobId as number,
    platform: 'linkedin',
    platformAccountId: intent.platformAccountId!,
  }
}

const normalizeLease = (input: unknown): LinkedInImagePublishingLeaseFence | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const lease = input as Partial<LinkedInImagePublishingLeaseFence>
  const ownerToken = boundedString(lease.ownerToken, 240)
  if (
    !ownerToken ||
    !Number.isSafeInteger(lease.queueJobId) ||
    (lease.queueJobId as number) < 1 ||
    typeof lease.leaseExpiresAt !== 'string' ||
    !Number.isFinite(Date.parse(lease.leaseExpiresAt))
  ) {
    return undefined
  }
  return {
    leaseExpiresAt: lease.leaseExpiresAt,
    ownerToken,
    queueJobId: lease.queueJobId as number,
  }
}

const sameAuthor = (left: LinkedInAuthorUrnInput, right: LinkedInAuthorUrnInput): boolean =>
  left.kind === right.kind &&
  (left.kind === 'person' && right.kind === 'person'
    ? left.personId === right.personId
    : left.kind === 'organization' && right.kind === 'organization'
      ? left.organizationId === right.organizationId
      : false)

const sameTicket = (
  left: LinkedInImageUploadTicket | undefined,
  right: LinkedInImageUploadTicket | undefined,
): boolean =>
  left === undefined && right === undefined
    ? true
    : Boolean(
        left &&
        right &&
        left.imageUrn === right.imageUrn &&
        left.sealedUpload === right.sealedUpload &&
        left.uploadUrlExpiresAt === right.uploadUrlExpiresAt,
      )

const sameAsset = (left: LinkedInImageAssetIdentity, right: LinkedInImageAssetIdentity): boolean =>
  left.byteLength === right.byteLength &&
  left.contentType === right.contentType &&
  left.id === right.id &&
  left.sha256 === right.sha256

const sameCheckpoint = (
  left: LinkedInImagePublishingCheckpoint,
  right: LinkedInImagePublishingCheckpoint,
): boolean =>
  left.altText === right.altText &&
  sameAuthor(left.author, right.author) &&
  left.authorizationRevision === right.authorizationRevision &&
  left.commentary === right.commentary &&
  left.imageUrn === right.imageUrn &&
  left.postUrn === right.postUrn &&
  left.postUrl === right.postUrl &&
  left.stage === right.stage &&
  sameTicket(left.uploadTicket, right.uploadTicket)

export const sameLinkedInImagePublishingIntent = (
  left: LinkedInImagePublishingIntent,
  right: LinkedInImagePublishingIntent,
): boolean =>
  left.expectedRevision === right.expectedRevision &&
  left.idempotencyKey === right.idempotencyKey &&
  left.publishJobId === right.publishJobId &&
  left.platform === right.platform &&
  left.platformAccountId === right.platformAccountId &&
  sameAsset(left.asset, right.asset) &&
  sameCheckpoint(left.checkpoint, right.checkpoint)

const sameLeaseOwner = (
  left: LinkedInImagePublishingLeaseFence,
  right: LinkedInImagePublishingLeaseFence,
): boolean => left.queueJobId === right.queueJobId && left.ownerToken === right.ownerToken

const isClaim = (input: unknown): input is LinkedInImagePublishingClaim => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const claim = input as Partial<LinkedInImagePublishingClaim>
  const intent = normalizeIntent(claim.intent)
  const lease = normalizeLease(claim.leaseFence)
  return (
    Boolean(boundedString(claim.claimId, 240)) &&
    Number.isSafeInteger(claim.fencingGeneration) &&
    (claim.fencingGeneration as number) > 0 &&
    Boolean(intent) &&
    Boolean(lease) &&
    (claim.mode === 'recover' || claim.mode === 'send')
  )
}

const unknown = (
  checkpoint: LinkedInImagePublishingCheckpoint,
  summary: string,
): LinkedInImagePublishingTransition => ({
  changed: true,
  checkpoint: { ...checkpoint, stage: 'delivery_unknown', uploadTicket: undefined },
  errorCode: 'delivery_unknown',
  event: 'unknown',
  retryable: false,
  summary,
})

const failed = (
  checkpoint: LinkedInImagePublishingCheckpoint,
  error: ProviderPublicationConfirmedError,
): LinkedInImagePublishingTransition => ({
  changed: true,
  checkpoint: { ...checkpoint, stage: 'failed', uploadTicket: undefined },
  errorCode: error.code,
  event: 'failed',
  retryable: error.retryable,
  summary: 'LinkedIn confirmed that this image publication stage failed.',
})

const blocked = (
  checkpoint: LinkedInImagePublishingCheckpoint,
  reason: LinkedInImagePublishingBlockReason,
): LinkedInImagePublishingTransition => ({
  changed: false,
  checkpoint,
  errorCode: reason,
  event: 'blocked',
  retryable: reason === 'busy' || reason === 'claim_conflict' || reason === 'lease_conflict',
})

const assertAssetBytes = (asset: LinkedInImageAssetIdentity, bytes: Uint8Array): void => {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== asset.byteLength) {
    throw new ProviderPublicationConfirmedError('invalid_request', false)
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== asset.sha256) throw new ProviderPublicationConfirmedError('invalid_request', false)
}

const runStage = async ({
  asset,
  checkpoint,
  platformAccountId,
  readAssetBytes,
  transport,
}: {
  asset: LinkedInImageAssetIdentity
  checkpoint: LinkedInImagePublishingCheckpoint
  platformAccountId: number | string
  readAssetBytes?: LinkedInImageAssetReader
  transport: LinkedInPublishingTransport
}): Promise<LinkedInImagePublishingTransition> => {
  if (checkpoint.stage === 'scheduled') {
    const uploadTicket = normalizeTicket(
      await transport.initializeImageUpload({
        authorization: {
          authorizationRevision: checkpoint.authorizationRevision,
          platformAccountId,
        },
        author: checkpoint.author,
      }),
    )
    if (!uploadTicket) {
      throw new ProviderPublicationResultUnknownError(
        'LinkedIn image initialization result is unknown',
      )
    }
    return {
      changed: true,
      checkpoint: {
        ...checkpoint,
        imageUrn: uploadTicket.imageUrn,
        stage: 'image_initialized',
        uploadTicket,
      },
      event: 'image-initialized',
      summary: 'LinkedIn initialized and checkpointed an encrypted image upload capability.',
    }
  }
  if (checkpoint.stage === 'image_initialized') {
    if (!readAssetBytes || !checkpoint.uploadTicket || !checkpoint.imageUrn) {
      throw new ProviderPublicationConfirmedError('invalid_request', false)
    }
    const assetBytes = await readAssetBytes(asset)
    if (!assetBytes) throw new ProviderPublicationConfirmedError('invalid_request', false)
    assertAssetBytes(asset, assetBytes)
    await transport.uploadImage({
      authorization: {
        authorizationRevision: checkpoint.authorizationRevision,
        platformAccountId,
      },
      author: checkpoint.author,
      bytes: assetBytes,
      contentType: asset.contentType,
      ticket: checkpoint.uploadTicket,
    })
    return {
      changed: true,
      checkpoint: { ...checkpoint, stage: 'image_uploaded', uploadTicket: undefined },
      event: 'image-uploaded',
      summary: 'LinkedIn accepted the image bytes.',
    }
  }
  if (checkpoint.stage === 'image_uploaded') {
    if (!checkpoint.imageUrn) throw new ProviderPublicationConfirmedError('invalid_request', false)
    const result = await transport.publishImagePost({
      altText: checkpoint.altText,
      authorization: {
        authorizationRevision: checkpoint.authorizationRevision,
        platformAccountId,
      },
      author: checkpoint.author,
      commentary: checkpoint.commentary,
      imageUrn: checkpoint.imageUrn,
    })
    if (
      !result ||
      typeof result !== 'object' ||
      typeof result.postUrn !== 'string' ||
      !/^urn:li:(?:share|ugcPost):\d+$/u.test(result.postUrn)
    ) {
      throw new ProviderPublicationResultUnknownError('LinkedIn post result is unknown')
    }
    let postUrl: string | undefined
    try {
      const status = await transport.getPostStatus({
        authorization: {
          authorizationRevision: checkpoint.authorizationRevision,
          platformAccountId,
        },
        author: checkpoint.author,
        postUrn: result.postUrn,
      })
      if (status.lifecycleState === 'PUBLISHED') postUrl = status.externalPublicationUrl
    } catch {
      // The publish mutation is confirmed. Preserve the post URN without inventing a URL.
    }
    return {
      changed: true,
      checkpoint: {
        ...checkpoint,
        postUrn: result.postUrn,
        ...(postUrl ? { postUrl } : {}),
        stage: 'published',
      },
      event: 'published',
      summary: 'LinkedIn confirmed the image post.',
    }
  }
  return unknown(checkpoint, 'LinkedIn image publishing checkpoint is unsupported.')
}

export const executeLinkedInImagePublishingStage = async ({
  authority,
  intent: intentInput,
  leaseFence: leaseInput,
  readAssetBytes,
  transport,
}: {
  authority: LinkedInImagePublishingAuthorityPort
  intent: LinkedInImagePublishingIntent
  leaseFence: LinkedInImagePublishingLeaseFence
  readAssetBytes?: LinkedInImageAssetReader
  transport: LinkedInPublishingTransport
}): Promise<LinkedInImagePublishingTransition> => {
  const intent = normalizeIntent(intentInput)
  const leaseFence = normalizeLease(leaseInput)
  if (!intent || !leaseFence) throw new Error('LinkedIn image publishing input is invalid')
  if (terminal.has(intent.checkpoint.stage)) {
    return { changed: false, checkpoint: intent.checkpoint }
  }
  if (
    intent.checkpoint.stage === 'image_initialized' ? !readAssetBytes : readAssetBytes !== undefined
  ) {
    return blocked(intent.checkpoint, 'intent_mismatch')
  }

  const claimResult = await authority.claimStage(intent, leaseFence)
  if (claimResult.status === 'blocked') return blocked(intent.checkpoint, claimResult.reason)
  const claim = claimResult.claim
  if (
    !isClaim(claim) ||
    !sameLinkedInImagePublishingIntent(claim.intent, intent) ||
    !sameLeaseOwner(claim.leaseFence, leaseFence)
  ) {
    try {
      await authority.releaseStage(claim)
    } catch {
      // No provider I/O occurred.
    }
    return blocked(intent.checkpoint, 'intent_mismatch')
  }

  if (claim.mode === 'recover') {
    const transition = unknown(
      claim.intent.checkpoint,
      'A previous LinkedIn image stage crossed provider I/O without a persisted result; replay is disabled.',
    )
    try {
      await authority.commitStage(claim, transition)
    } catch {
      // Future claims remain recovery-only until this terminal checkpoint persists.
    }
    return transition
  }

  let mark: LinkedInImagePublishingMarkResult
  try {
    mark = await authority.markProviderIOStarted(claim)
  } catch {
    mark = { reason: 'claim_conflict', status: 'blocked' }
  }
  if (mark.status === 'blocked') {
    try {
      await authority.releaseStage(claim)
    } catch {
      // I/O never started, so a fresh claim is safe.
    }
    return blocked(intent.checkpoint, mark.reason)
  }

  let transition: LinkedInImagePublishingTransition
  try {
    transition = await runStage({
      asset: claim.intent.asset,
      checkpoint: claim.intent.checkpoint,
      platformAccountId: claim.intent.platformAccountId,
      readAssetBytes,
      transport,
    })
  } catch (error) {
    if (error instanceof ProviderPublicationConfirmedError) {
      transition = failed(claim.intent.checkpoint, error)
    } else if (error instanceof ProviderPublicationTransportError) {
      let released: LinkedInImagePublishingMarkResult
      try {
        released = await authority.releaseProvenPreIOFailure(claim)
      } catch {
        released = { reason: 'claim_conflict', status: 'blocked' }
      }
      if (released.status === 'fenced') throw error
      return unknown(
        claim.intent.checkpoint,
        'LinkedIn pre-I/O failure could not clear its persisted fence; replay is disabled.',
      )
    } else if (error instanceof ProviderPublicationResultUnknownError) {
      transition = unknown(
        claim.intent.checkpoint,
        'LinkedIn image publication outcome is unknown; replay is disabled.',
      )
    } else {
      transition = unknown(
        claim.intent.checkpoint,
        'LinkedIn image publication outcome is unknown; replay is disabled.',
      )
    }
  }

  let committed = false
  try {
    const result = await authority.commitStage(claim, transition)
    committed = result.status === 'committed'
  } catch {
    committed = false
  }
  if (!committed) {
    return unknown(
      claim.intent.checkpoint,
      'LinkedIn provider I/O crossed the fence but its checkpoint could not be committed; replay is disabled.',
    )
  }
  return transition
}
