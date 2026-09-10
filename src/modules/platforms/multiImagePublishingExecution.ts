import {
  ProviderPublicationConfirmedError,
  ProviderPublicationResultUnknownError,
  ProviderPublicationTransportError,
} from './publishingResult'
import type { LinkedInPublishingTransport } from './linkedin/publishingOutbound'
import type { MetaPublishingTransport } from './meta/publishingOutbound'

export const MULTI_IMAGE_PUBLISHING_STAGES = [
  'scheduled',
  'provider_assets_preparing',
  'provider_assets_prepared',
  'publication_created',
  'published',
  'failed',
  'delivery_unknown',
] as const

export type MultiImagePublishingStage = (typeof MULTI_IMAGE_PUBLISHING_STAGES)[number]

export type MultiImagePublishingRoute =
  | 'facebook-photos-multi'
  | 'instagram-carousel-staged'
  | 'linkedin-multi-image-staged'

export type FacebookMultiImageItem = {
  photoId?: string
  sourceUrl: string
}

export type InstagramCarouselItem = {
  containerId?: string
  imageUrl: string
}

export type LinkedInMultiImageAssetIdentity = {
  byteLength: number
  contentType: 'image/gif' | 'image/jpeg' | 'image/png'
  id: string
  sha256: string
}

export type LinkedInMultiImageItem = {
  asset: LinkedInMultiImageAssetIdentity
  imageUrn?: string
  uploadTicket?: string
}

export type FacebookPhotosMultiPublishingCheckpoint = {
  accountExternalId: string
  authorizationRevision: number
  caption?: string
  items: FacebookMultiImageItem[]
  permalink?: string
  postId?: string
  stage: MultiImagePublishingStage
}

export type InstagramCarouselPublishingCheckpoint = {
  accountExternalId: string
  authorizationRevision: number
  caption?: string
  carouselContainerId?: string
  items: InstagramCarouselItem[]
  mediaId?: string
  permalink?: string
  stage: MultiImagePublishingStage
}

export type LinkedInMultiImagePublishingCheckpoint = {
  altText?: string
  author: { kind: 'person'; personId: string } | { kind: 'organization'; organizationId: string }
  authorizationRevision: number
  commentary: string
  items: LinkedInMultiImageItem[]
  postUrn?: string
  postUrl?: string
  stage: MultiImagePublishingStage
}

export type MultiImagePublishingCheckpoint =
  | FacebookPhotosMultiPublishingCheckpoint
  | InstagramCarouselPublishingCheckpoint
  | LinkedInMultiImagePublishingCheckpoint

export type MultiImagePublishingIntent = {
  checkpoint: MultiImagePublishingCheckpoint
  expectedRevision: number
  idempotencyKey: string
  platform: 'facebook' | 'instagram' | 'linkedin'
  platformAccountId: number | string
  publishJobId: number
  route: MultiImagePublishingRoute
}

export type MultiImagePublishingLeaseFence = {
  leaseExpiresAt: string
  ownerToken: string
  queueJobId: number
}

export const MULTI_IMAGE_PUBLISHING_BLOCK_REASONS = [
  'busy',
  'claim_conflict',
  'intent_mismatch',
  'lease_conflict',
  'missing_intent',
  'stale_revision',
] as const

export type MultiImagePublishingBlockReason =
  (typeof MULTI_IMAGE_PUBLISHING_BLOCK_REASONS)[number]

export type MultiImagePublishingClaim = {
  claimId: string
  fencingGeneration: number
  intent: MultiImagePublishingIntent
  leaseFence: MultiImagePublishingLeaseFence
  mode: 'recover' | 'send'
}

export type MultiImagePublishingClaimResult =
  | { claim: MultiImagePublishingClaim; status: 'claimed' }
  | { reason: MultiImagePublishingBlockReason; status: 'blocked' }

export type MultiImagePublishingMarkResult =
  { status: 'fenced' } | { reason: MultiImagePublishingBlockReason; status: 'blocked' }

export type MultiImagePublishingCommitResult =
  | { nextRevision: number; status: 'committed' }
  | { reason: MultiImagePublishingBlockReason; status: 'blocked' }

export type MultiImagePublishingTransition = {
  changed: boolean
  checkpoint: MultiImagePublishingCheckpoint
  errorCode?: string
  event?:
    | 'asset-uploaded'
    | 'blocked'
    | 'failed'
    | 'published'
    | 'publishing'
    | 'unknown'
  retryable?: boolean
  summary?: string
}

export interface MultiImagePublishingAuthorityPort {
  claimStage(
    intent: MultiImagePublishingIntent,
    leaseFence: MultiImagePublishingLeaseFence,
  ): Promise<MultiImagePublishingClaimResult>
  markProviderIOStarted(
    claim: MultiImagePublishingClaim,
  ): Promise<MultiImagePublishingMarkResult>
  commitStage(
    claim: MultiImagePublishingClaim,
    transition: MultiImagePublishingTransition,
  ): Promise<MultiImagePublishingCommitResult>
  releaseStage(claim: MultiImagePublishingClaim): Promise<void>
}

export type MultiImageAssetReader = (
  asset: LinkedInMultiImageAssetIdentity,
) => Promise<Uint8Array | null>

const terminal = new Set<MultiImagePublishingStage>([
  'delivery_unknown',
  'failed',
  'published',
])

const bounded = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized && normalized === value && normalized.length <= maxLength ? normalized : undefined
}

const providerId = (value: unknown): string | undefined => {
  const normalized = bounded(value, 240)
  return normalized && /^[\w:-]{1,240}$/u.test(normalized) ? normalized : undefined
}

const safeIdentity = (value: unknown): number | string | undefined =>
  (typeof value === 'number' && Number.isSafeInteger(value)) ||
  (typeof value === 'string' && Boolean(bounded(value, 240)))
    ? (value as number | string)
    : undefined

const isAuthor = (value: unknown): value is LinkedInMultiImagePublishingCheckpoint['author'] => {
  if (!value || typeof value !== 'object') return false
  const author = value as Record<string, unknown>
  return (
    (author.kind === 'person' && typeof author.personId === 'string' && Boolean(author.personId)) ||
    (author.kind === 'organization' &&
      typeof author.organizationId === 'string' &&
      Boolean(author.organizationId))
  )
}

const isAssetIdentity = (value: unknown): value is LinkedInMultiImageAssetIdentity => {
  if (!value || typeof value !== 'object') return false
  const asset = value as Record<string, unknown>
  return (
    typeof asset.id === 'string' &&
    Boolean(asset.id) &&
    typeof asset.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(asset.sha256) &&
    Number.isSafeInteger(asset.byteLength) &&
    (asset.byteLength as number) >= 0 &&
    (asset.contentType === 'image/gif' ||
      asset.contentType === 'image/jpeg' ||
      asset.contentType === 'image/png')
  )
}

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const sameCheckpoint = (left: MultiImagePublishingCheckpoint, right: MultiImagePublishingCheckpoint): boolean =>
  left.stage === right.stage &&
  left.authorizationRevision === right.authorizationRevision &&
  sameValue(left, right)

export const sameMultiImagePublishingIntent = (
  left: MultiImagePublishingIntent,
  right: MultiImagePublishingIntent,
): boolean =>
  left.expectedRevision === right.expectedRevision &&
  left.idempotencyKey === right.idempotencyKey &&
  left.publishJobId === right.publishJobId &&
  left.platform === right.platform &&
  left.route === right.route &&
  left.platformAccountId === right.platformAccountId &&
  sameCheckpoint(left.checkpoint, right.checkpoint)

const normalizeLeaseFence = (input: unknown): MultiImagePublishingLeaseFence | undefined => {
  if (!input || typeof input !== 'object') return undefined
  const fence = input as Partial<MultiImagePublishingLeaseFence>
  const ownerToken = bounded(fence.ownerToken, 240)
  return ownerToken &&
    Number.isSafeInteger(fence.queueJobId) &&
    (fence.queueJobId as number) > 0 &&
    typeof fence.leaseExpiresAt === 'string' &&
    Number.isFinite(Date.parse(fence.leaseExpiresAt))
    ? { leaseExpiresAt: fence.leaseExpiresAt, ownerToken, queueJobId: fence.queueJobId as number }
    : undefined
}

const normalizeCheckpoint = (
  route: MultiImagePublishingRoute,
  input: unknown,
): MultiImagePublishingCheckpoint | undefined => {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { items?: unknown }).items)) {
    return undefined
  }
  const checkpoint = input as Partial<MultiImagePublishingCheckpoint>
  if (
    !Number.isSafeInteger(checkpoint.authorizationRevision) ||
    (checkpoint.authorizationRevision as number) < 0 ||
    !MULTI_IMAGE_PUBLISHING_STAGES.includes(checkpoint.stage as MultiImagePublishingStage)
  ) {
    return undefined
  }
  if (route === 'facebook-photos-multi') {
    const source = checkpoint as Partial<FacebookPhotosMultiPublishingCheckpoint>
    const accountExternalId = bounded(source.accountExternalId, 240)
    const items = source.items?.map((item) => ({
      ...(providerId(item?.photoId) ? { photoId: providerId(item.photoId) as string } : {}),
      sourceUrl: bounded(item?.sourceUrl, 2_000) ?? '',
    }))
    if (!accountExternalId || !items?.length || items.length > 3 || items.some((item) => !item.sourceUrl)) {
      return undefined
    }
    return {
      ...(source.caption === undefined ? {} : { caption: bounded(source.caption, 5_000) }),
      accountExternalId,
      authorizationRevision: checkpoint.authorizationRevision as number,
      items: items as FacebookMultiImageItem[],
      ...(source.postId === undefined ? {} : { postId: providerId(source.postId) as string }),
      ...(source.permalink === undefined ? {} : { permalink: bounded(source.permalink, 2_000) }),
      stage: checkpoint.stage as MultiImagePublishingStage,
    }
  }
  if (route === 'instagram-carousel-staged') {
    const source = checkpoint as Partial<InstagramCarouselPublishingCheckpoint>
    const accountExternalId = bounded(source.accountExternalId, 240)
    const items = source.items?.map((item) => ({
      ...(providerId(item?.containerId)
        ? { containerId: providerId(item.containerId) as string }
        : {}),
      imageUrl: bounded(item?.imageUrl, 2_000) ?? '',
    }))
    if (!accountExternalId || !items?.length || items.length > 3 || items.some((item) => !item.imageUrl)) {
      return undefined
    }
    return {
      ...(source.caption === undefined ? {} : { caption: bounded(source.caption, 2_200) }),
      accountExternalId,
      authorizationRevision: checkpoint.authorizationRevision as number,
      ...(source.carouselContainerId === undefined
        ? {}
        : { carouselContainerId: providerId(source.carouselContainerId) as string }),
      items: items as InstagramCarouselItem[],
      ...(source.mediaId === undefined ? {} : { mediaId: providerId(source.mediaId) as string }),
      ...(source.permalink === undefined ? {} : { permalink: bounded(source.permalink, 2_000) }),
      stage: checkpoint.stage as MultiImagePublishingStage,
    }
  }
  const source = checkpoint as Partial<LinkedInMultiImagePublishingCheckpoint>
  const items = source.items?.map((item) => ({
    asset: item?.asset as LinkedInMultiImageAssetIdentity,
    ...(item.imageUrn === undefined ? {} : { imageUrn: providerId(item.imageUrn) as string }),
    ...(item.uploadTicket === undefined
      ? {}
      : { uploadTicket: bounded(item.uploadTicket, 16_000) as string }),
  }))
  const author = source.author
  if (
    !isAuthor(author) ||
    !items?.length ||
    items.length > 3 ||
    !items.every((item) => isAssetIdentity(item.asset)) ||
    typeof source.commentary !== 'string' ||
    !source.commentary
  ) {
    return undefined
  }
  return {
    ...(source.altText === undefined ? {} : { altText: bounded(source.altText, 300) }),
    author,
    authorizationRevision: checkpoint.authorizationRevision as number,
    commentary: source.commentary,
    items: items as LinkedInMultiImageItem[],
    ...(source.postUrn === undefined ? {} : { postUrn: providerId(source.postUrn) as string }),
    ...(source.postUrl === undefined ? {} : { postUrl: bounded(source.postUrl, 2_000) as string }),
    stage: checkpoint.stage as MultiImagePublishingStage,
  }
}

const normalizeIntent = (input: unknown): MultiImagePublishingIntent | undefined => {
  if (!input || typeof input !== 'object') return undefined
  const intent = input as Partial<MultiImagePublishingIntent>
  const route = bounded(intent.route, 64)
  const checkpoint = route
    ? normalizeCheckpoint(intent.route as MultiImagePublishingRoute, intent.checkpoint)
    : undefined
  return (
    checkpoint &&
    (intent.route === 'facebook-photos-multi' || intent.route === 'instagram-carousel-staged' || intent.route === 'linkedin-multi-image-staged') &&
    (intent.platform === 'facebook' || intent.platform === 'instagram' || intent.platform === 'linkedin') &&
    safeIdentity(intent.platformAccountId) !== undefined &&
    Number.isSafeInteger(intent.publishJobId) &&
    (intent.publishJobId as number) > 0 &&
    Number.isSafeInteger(intent.expectedRevision) &&
    (intent.expectedRevision as number) >= 0 &&
    bounded(intent.idempotencyKey, 200)
      ? {
          checkpoint,
          expectedRevision: intent.expectedRevision as number,
          idempotencyKey: intent.idempotencyKey as string,
          platform: intent.platform,
          platformAccountId: intent.platformAccountId as number | string,
          publishJobId: intent.publishJobId as number,
          route: intent.route,
        }
      : undefined
  )
}

const failed = (
  checkpoint: MultiImagePublishingCheckpoint,
  error: ProviderPublicationConfirmedError,
): MultiImagePublishingTransition => ({
  changed: true,
  checkpoint: { ...checkpoint, stage: 'failed' },
  errorCode: error.code,
  event: 'failed',
  retryable: error.retryable,
  summary: 'The platform confirmed that this multi-image publishing stage failed.',
})

const unknown = (
  checkpoint: MultiImagePublishingCheckpoint,
  summary: string,
): MultiImagePublishingTransition => ({
  changed: true,
  checkpoint: { ...checkpoint, stage: 'delivery_unknown' },
  errorCode: 'delivery_unknown',
  event: 'unknown',
  retryable: false,
  summary,
})

const blockedTransition = (
  checkpoint: MultiImagePublishingCheckpoint,
  reason: MultiImagePublishingBlockReason,
): MultiImagePublishingTransition => ({
  changed: false,
  checkpoint,
  errorCode: reason,
  event: 'blocked',
  retryable: reason === 'busy' || reason === 'claim_conflict' || reason === 'lease_conflict',
  summary: 'Multi-image publishing is blocked by the authoritative persistence fence.',
})

const isLinkedInTransport = (
  transport: MetaPublishingTransport | LinkedInPublishingTransport,
): transport is LinkedInPublishingTransport =>
  typeof (transport as LinkedInPublishingTransport).publishMultiImagePost === 'function'

const runStage = async ({
  checkpoint,
  platformAccountId,
  readAssetBytes,
  route,
  transport,
}: {
  checkpoint: MultiImagePublishingCheckpoint
  platformAccountId: number | string
  readAssetBytes?: MultiImageAssetReader
  route: MultiImagePublishingRoute
  transport: MetaPublishingTransport | LinkedInPublishingTransport
}): Promise<MultiImagePublishingTransition> => {
  if (checkpoint.stage === 'scheduled' || checkpoint.stage === 'provider_assets_preparing') {
    if (route === 'facebook-photos-multi') {
      const facebookCheckpoint = checkpoint as FacebookPhotosMultiPublishingCheckpoint
      const item = facebookCheckpoint.items.find((candidate) => !candidate.photoId)
      if (!item) {
        return {
          changed: true,
          checkpoint: { ...facebookCheckpoint, stage: 'provider_assets_prepared' },
          event: 'publishing',
          summary: 'All unpublished Facebook photos are prepared.',
        }
      }
      const result = await (transport as MetaPublishingTransport).createFacebookUnpublishedPhoto({
        accountExternalId: facebookCheckpoint.accountExternalId,
        authorizationRevision: facebookCheckpoint.authorizationRevision,
        platformAccountId,
        url: item.sourceUrl,
      })
      const photoId = providerId(result.photoId)
      if (!photoId) return unknown(checkpoint, 'Facebook photo ID is unknown; resend is disabled.')
      const items = facebookCheckpoint.items.map((candidate) =>
        candidate === item ? { ...candidate, photoId } : candidate,
      )
      return {
        changed: true,
        checkpoint: {
          ...facebookCheckpoint,
          items,
          stage: items.every((candidate) => candidate.photoId) ? 'provider_assets_prepared' : 'scheduled',
        },
        event: 'publishing',
        summary: 'One unpublished Facebook photo was created and checkpointed.',
      }
    }
    if (route === 'instagram-carousel-staged') {
      const instagramCheckpoint = checkpoint as InstagramCarouselPublishingCheckpoint
      const item = instagramCheckpoint.items.find((candidate) => !candidate.containerId)
      if (!item) {
        return {
          changed: true,
          checkpoint: { ...instagramCheckpoint, stage: 'provider_assets_prepared' },
          event: 'publishing',
          summary: 'All Instagram carousel child containers are prepared.',
        }
      }
      const result = await (transport as MetaPublishingTransport).createInstagramCarouselItem({
        accountExternalId: instagramCheckpoint.accountExternalId,
        authorizationRevision: instagramCheckpoint.authorizationRevision,
        imageUrl: item.imageUrl,
        platformAccountId,
      })
      const containerId = providerId(result.creationId)
      if (!containerId) return unknown(checkpoint, 'Instagram child container ID is unknown; resend is disabled.')
      const items = instagramCheckpoint.items.map((candidate) =>
        candidate === item ? { ...candidate, containerId } : candidate,
      )
      return {
        changed: true,
        checkpoint: {
          ...instagramCheckpoint,
          items,
          stage: items.every((candidate) => candidate.containerId)
            ? 'provider_assets_prepared'
            : 'scheduled',
        },
        event: 'publishing',
        summary: 'One Instagram carousel child container was created and checkpointed.',
      }
    }
    const linkedInCheckpoint = checkpoint as LinkedInMultiImagePublishingCheckpoint
    const uploading = linkedInCheckpoint.items.find((item) => item.uploadTicket)
    if (uploading) {
      if (!isLinkedInTransport(transport) || typeof readAssetBytes !== 'function') {
        return unknown(linkedInCheckpoint, 'LinkedIn image upload capability is unavailable.')
      }
      const ticket = JSON.parse(uploading.uploadTicket!) as { imageUrn: string; uploadUrlExpiresAt: number }
      const bytes = await readAssetBytes(uploading.asset)
      if (!bytes) return unknown(linkedInCheckpoint, 'LinkedIn asset bytes are unavailable.')
      await transport.uploadImage({
        authorization: {
          authorizationRevision: linkedInCheckpoint.authorizationRevision,
          platformAccountId,
        },
        author: linkedInCheckpoint.author,
        bytes,
        contentType: uploading.asset.contentType,
        ticket: {
          imageUrn: ticket.imageUrn,
          sealedUpload: uploading.uploadTicket!,
          uploadUrlExpiresAt: ticket.uploadUrlExpiresAt,
        },
      })
      const items = linkedInCheckpoint.items.map((candidate) =>
        candidate === uploading ? { ...candidate, imageUrn: ticket.imageUrn, uploadTicket: undefined } : candidate,
      )
      return {
        changed: true,
        checkpoint: {
          ...linkedInCheckpoint,
          items: items as LinkedInMultiImageItem[],
          stage: items.every((item) => item.imageUrn) ? 'provider_assets_prepared' : 'scheduled',
        },
        event: 'asset-uploaded',
        summary: 'One LinkedIn image was uploaded and checkpointed.',
      }
    }
    const item = linkedInCheckpoint.items.find((candidate) => !candidate.imageUrn)
    if (!item) {
      return {
        changed: true,
        checkpoint: { ...linkedInCheckpoint, stage: 'provider_assets_prepared' },
        event: 'publishing',
        summary: 'All LinkedIn images are prepared.',
      }
    }
    if (!isLinkedInTransport(transport)) {
      return unknown(linkedInCheckpoint, 'LinkedIn publishing transport is unavailable.')
    }
    const ticket = await transport.initializeImageUpload({
      authorization: { authorizationRevision: linkedInCheckpoint.authorizationRevision, platformAccountId },
      author: linkedInCheckpoint.author,
    })
    const items = linkedInCheckpoint.items.map((candidate) =>
      candidate === item ? { ...candidate, uploadTicket: JSON.stringify(ticket) } : candidate,
    )
    return {
      changed: true,
      checkpoint: { ...linkedInCheckpoint, items: items as LinkedInMultiImageItem[], stage: 'provider_assets_preparing' },
      event: 'publishing',
      summary: 'A LinkedIn image upload was initialized and checkpointed.',
    }
  }

  if (checkpoint.stage === 'provider_assets_prepared') {
    if (route === 'facebook-photos-multi') {
      const facebookCheckpoint = checkpoint as FacebookPhotosMultiPublishingCheckpoint
      const photoIds = facebookCheckpoint.items.map((item) => item.photoId).filter(Boolean) as string[]
      const result = await (transport as MetaPublishingTransport).publishFacebookPageFeed({
        accountExternalId: facebookCheckpoint.accountExternalId,
        authorizationRevision: facebookCheckpoint.authorizationRevision,
        caption: facebookCheckpoint.caption,
        photoIds,
        platformAccountId,
      })
      const postId = providerId(result.postId)
      if (!postId) return unknown(checkpoint, 'Facebook post ID is unknown; resend is disabled.')
      return {
        changed: true,
        checkpoint: { ...facebookCheckpoint, postId, stage: 'publication_created' },
        event: 'publishing',
        summary: 'Facebook multi-photo post was created.',
      }
    }
    if (route === 'instagram-carousel-staged') {
      const instagramCheckpoint = checkpoint as InstagramCarouselPublishingCheckpoint
      const children = instagramCheckpoint.items.map((item) => item.containerId).filter(Boolean) as string[]
      const result = await (transport as MetaPublishingTransport).createInstagramCarouselContainer({
        accountExternalId: instagramCheckpoint.accountExternalId,
        authorizationRevision: instagramCheckpoint.authorizationRevision,
        caption: instagramCheckpoint.caption,
        children,
        platformAccountId,
      })
      const containerId = providerId(result.creationId)
      if (!containerId) return unknown(checkpoint, 'Instagram carousel container ID is unknown; resend is disabled.')
      return {
        changed: true,
        checkpoint: { ...instagramCheckpoint, carouselContainerId: containerId, stage: 'publication_created' },
        event: 'publishing',
        summary: 'Instagram carousel container was created.',
      }
    }
    const linkedInCheckpoint = checkpoint as LinkedInMultiImagePublishingCheckpoint
    if (!isLinkedInTransport(transport)) return unknown(linkedInCheckpoint, 'LinkedIn publishing transport is unavailable.')
    const result = await transport.publishMultiImagePost({
      authorization: { authorizationRevision: linkedInCheckpoint.authorizationRevision, platformAccountId },
      author: linkedInCheckpoint.author,
      commentary: linkedInCheckpoint.commentary,
      images: linkedInCheckpoint.items.map((item) => ({
        ...(linkedInCheckpoint.altText ? { altText: linkedInCheckpoint.altText } : {}),
        imageUrn: item.imageUrn!,
      })),
    })
    const postUrn = providerId(result.postUrn)
    if (!postUrn) return unknown(checkpoint, 'LinkedIn post URN is unknown; resend is disabled.')
    return {
      changed: true,
      checkpoint: { ...linkedInCheckpoint, postUrn, stage: 'publication_created' },
      event: 'publishing',
      summary: 'LinkedIn multi-image post was created.',
    }
  }

  if (checkpoint.stage === 'publication_created') {
    if (route === 'facebook-photos-multi') {
      const facebookCheckpoint = checkpoint as FacebookPhotosMultiPublishingCheckpoint
      if (!facebookCheckpoint.postId) return unknown(checkpoint, 'Persisted Facebook post ID is invalid.')
      const result = await (transport as MetaPublishingTransport).getFacebookPagePostPermalink({
        accountExternalId: facebookCheckpoint.accountExternalId,
        authorizationRevision: facebookCheckpoint.authorizationRevision,
        platformAccountId,
        postId: facebookCheckpoint.postId,
      })
      return {
        changed: true,
        checkpoint: { ...facebookCheckpoint, permalink: result.permalinkUrl, stage: 'published' },
        event: 'published',
        summary: 'Facebook confirmed multi-photo publication.',
      }
    }
    if (route === 'instagram-carousel-staged') {
      const instagramCheckpoint = checkpoint as InstagramCarouselPublishingCheckpoint
      const containerId = instagramCheckpoint.carouselContainerId
      if (!containerId) return unknown(checkpoint, 'Persisted Instagram carousel container ID is invalid.')
      const status = await (transport as MetaPublishingTransport).getInstagramContainerStatus({
        accountExternalId: instagramCheckpoint.accountExternalId,
        authorizationRevision: instagramCheckpoint.authorizationRevision,
        containerId,
        platformAccountId,
      })
      if (status.state === 'pending') {
        return { changed: false, checkpoint, event: 'publishing', summary: 'Instagram carousel is processing.' }
      }
      if (status.state !== 'ready') return unknown(checkpoint, 'Instagram carousel processing failed or is unknown.')
      const result = await (transport as MetaPublishingTransport).publishInstagramMedia({
        accountExternalId: instagramCheckpoint.accountExternalId,
        authorizationRevision: instagramCheckpoint.authorizationRevision,
        creationId: containerId,
        platformAccountId,
      })
      const mediaId = providerId(result.igMediaId)
      if (!mediaId) return unknown(checkpoint, 'Instagram carousel media ID is unknown; resend is disabled.')
      return {
        changed: true,
        checkpoint: { ...instagramCheckpoint, mediaId, stage: 'published' },
        event: 'published',
        summary: 'Instagram confirmed carousel publication.',
      }
    }
    const linkedInCheckpoint = checkpoint as LinkedInMultiImagePublishingCheckpoint
    if (!linkedInCheckpoint.postUrn) return unknown(checkpoint, 'Persisted LinkedIn post URN is invalid.')
    if (!isLinkedInTransport(transport)) return unknown(linkedInCheckpoint, 'LinkedIn publishing transport is unavailable.')
    const result = await transport.getPostStatus({
      authorization: { authorizationRevision: linkedInCheckpoint.authorizationRevision, platformAccountId },
      author: linkedInCheckpoint.author,
      postUrn: linkedInCheckpoint.postUrn,
    })
    if (result.lifecycleState !== 'PUBLISHED') {
      return { changed: false, checkpoint, event: 'publishing', summary: 'LinkedIn post is still processing.' }
    }
    return {
      changed: true,
      checkpoint: {
        ...linkedInCheckpoint,
        postUrl: result.externalPublicationUrl,
        stage: 'published',
      },
      event: 'published',
      summary: 'LinkedIn confirmed multi-image publication.',
    }
  }

  return unknown(checkpoint, 'Multi-image publishing checkpoint is unsupported.')
}

export const executeMultiImagePublishingStage = async ({
  authority,
  intent: intentInput,
  leaseFence: leaseInput,
  readAssetBytes,
  transport,
}: {
  authority: MultiImagePublishingAuthorityPort
  intent: MultiImagePublishingIntent
  leaseFence: MultiImagePublishingLeaseFence
  readAssetBytes?: MultiImageAssetReader
  transport: MetaPublishingTransport | LinkedInPublishingTransport
}): Promise<MultiImagePublishingTransition> => {
  const intent = normalizeIntent(intentInput)
  const leaseFence = normalizeLeaseFence(leaseInput)
  if (!intent || !leaseFence) throw new Error('Multi-image publishing input is invalid')
  if (terminal.has(intent.checkpoint.stage)) return { changed: false, checkpoint: intent.checkpoint }
  const claimResult = await authority.claimStage(intent, leaseFence)
  if (claimResult.status === 'blocked') return blockedTransition(intent.checkpoint, claimResult.reason)
  const claim = claimResult.claim
  if (
    !sameMultiImagePublishingIntent(claim.intent, intent) ||
    claim.leaseFence.queueJobId !== leaseFence.queueJobId ||
    claim.leaseFence.ownerToken !== leaseFence.ownerToken
  ) {
    try {
      await authority.releaseStage(claim)
    } catch {}
    return blockedTransition(intent.checkpoint, 'intent_mismatch')
  }
  if (claim.mode === 'recover') {
    const transition = unknown(
      claim.intent.checkpoint,
      'A previous multi-image provider call crossed the send boundary without a persisted result; resend is disabled.',
    )
    try {
      await authority.commitStage(claim, transition)
    } catch {}
    return transition
  }
  let markResult: MultiImagePublishingMarkResult
  try {
    markResult = await authority.markProviderIOStarted(claim)
  } catch {
    return blockedTransition(intent.checkpoint, 'claim_conflict')
  }
  if (markResult.status === 'blocked') {
    try {
      await authority.releaseStage(claim)
    } catch {}
    return blockedTransition(intent.checkpoint, markResult.reason)
  }
  let transition: MultiImagePublishingTransition
  let preIOTransportError: ProviderPublicationTransportError | undefined
  try {
    transition = await runStage({
      checkpoint: claim.intent.checkpoint,
      platformAccountId: claim.intent.platformAccountId,
      route: claim.intent.route,
      ...(claim.intent.route === 'linkedin-multi-image-staged' && claim.intent.checkpoint.items.some((item) => 'uploadTicket' in item && item.uploadTicket)
        ? { readAssetBytes }
        : {}),
      transport,
    })
  } catch (error) {
    if (error instanceof ProviderPublicationConfirmedError) transition = failed(claim.intent.checkpoint, error)
    else if (error instanceof ProviderPublicationResultUnknownError) transition = unknown(claim.intent.checkpoint, 'The multi-image publication outcome is unknown; resend is disabled.')
    else if (error instanceof ProviderPublicationTransportError) {
      preIOTransportError = error
      transition = {
        changed: false,
        checkpoint: claim.intent.checkpoint,
        errorCode: 'provider_unavailable',
        event: 'blocked',
        retryable: true,
        summary: 'Provider transport failed before a confirmed mutation result.',
      }
    } else {
      transition = unknown(claim.intent.checkpoint, 'Multi-image publication failed in an unexpected way; resend is disabled.')
    }
  }
  let committed = false
  try {
    const commit = await authority.commitStage(claim, transition)
    committed = commit.status === 'committed'
  } catch {
    committed = false
  }
  if (!committed) {
    return unknown(
      claim.intent.checkpoint,
      'Multi-image provider I/O crossed the fence but its checkpoint could not be committed; resend is disabled.',
    )
  }

  if (preIOTransportError) throw preIOTransportError
  return transition
}
