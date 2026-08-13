import { createLinkedInAssistedPreparation } from '../publishing/assisted'
import {
  PublishingContractValidationError,
  normalizeAssistedPublicationRequest,
  normalizePlatformCapabilityQuery,
  normalizePlatformPublicationStatusLookup,
  normalizePublicationIdempotencyKey,
  normalizePlatformPublishRequest,
  type BlockedAssistedPublication,
  type BlockedPlatformPublication,
  type ConfirmedPlatformPublishErrorCode,
  type DeliveryUnknownPlatformPublication,
  type FailedPlatformPublication,
  type PlatformCapability,
  type PlatformCapabilityQuery,
  type PlatformPublicationStatusLookup,
  type PlatformPublishAcceptance,
  type PlatformPublishRequest,
  type PublishingService,
} from '../publishing/contracts'
import type {
  PublishingAccountResolverPort,
  ResolvedPublishingAccount,
} from './publishingAccountResolver'
import {
  ProviderPublicationConfirmedError,
  ProviderPublicationResultUnknownError,
  ProviderPublicationTransportError,
} from './publishingResult'
import type { LinkedInPublishingTransport } from './linkedin/publishingOutbound'
import type { LinkedInAuthorUrnInput } from './linkedin/publishingRequests'
import type { MetaPublishingTransport } from './meta/publishingOutbound'

const DIRECT_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png'])

const blocked = (
  identity: Pick<PlatformPublishRequest, 'idempotencyKey' | 'platform' | 'platformAccountId'>,
  errorCode: ConfirmedPlatformPublishErrorCode,
  retryable = false,
): BlockedPlatformPublication => ({
  ...identity,
  errorCode,
  retryable,
  status: 'blocked',
})

const failed = (
  identity: PlatformPublicationStatusLookup,
  errorCode: ConfirmedPlatformPublishErrorCode,
  retryable = false,
): FailedPlatformPublication => ({
  ...identity,
  errorCode,
  retryable,
  status: 'failed',
})

const deliveryUnknown = (
  identity: Pick<PlatformPublishRequest, 'idempotencyKey' | 'platform' | 'platformAccountId'>,
  externalPublicationId?: string,
): DeliveryUnknownPlatformPublication => ({
  ...identity,
  errorCode: 'delivery_unknown',
  ...(externalPublicationId ? { externalPublicationId } : {}),
  retryable: false,
  status: 'delivery_unknown',
})

const accountResolutionErrorCode = (
  reason: Exclude<
    Awaited<ReturnType<PublishingAccountResolverPort['resolve']>>,
    { status: 'resolved' }
  >['reason'],
): ConfirmedPlatformPublishErrorCode => {
  if (
    reason === 'authorization_expired' ||
    reason === 'authorization_not_connected' ||
    reason === 'credential_not_configured' ||
    reason === 'stale_authorization_revision'
  ) {
    return 'authorization_required'
  }
  if (reason === 'capability_not_approved') return 'permission_required'
  return 'account_not_connected'
}

const linkedInAuthor = (account: ResolvedPublishingAccount): LinkedInAuthorUrnInput => {
  if (account.accountKind === 'linkedin-member') {
    return { kind: 'person', personId: account.externalAccountId }
  }
  if (account.accountKind === 'linkedin-organization') {
    return { kind: 'organization', organizationId: account.externalAccountId }
  }
  throw new PublishingContractValidationError('LinkedIn publishing account kind is invalid')
}

const resolvedAccountMatches = (
  query: PlatformCapabilityQuery,
  account: ResolvedPublishingAccount,
): boolean => {
  if (
    account.platform !== query.platform ||
    String(account.platformAccountId) !== String(query.platformAccountId)
  ) {
    return false
  }
  if (query.platform === 'facebook') {
    return account.family === 'meta' && account.accountKind === 'facebook-page'
  }
  if (query.platform === 'instagram') {
    return account.family === 'meta' && account.accountKind === 'instagram-professional'
  }
  return (
    account.family === 'linkedin' &&
    (account.accountKind === 'linkedin-member' || account.accountKind === 'linkedin-organization')
  )
}

const capabilityForResolvedAccount = (query: PlatformCapabilityQuery): PlatformCapability => {
  const reason =
    query.platform === 'facebook'
      ? 'Facebook direct publishing supports one JPEG or PNG; production job persistence remains required'
      : query.platform === 'instagram'
        ? 'Instagram publishing requires the persisted staged worker executor'
        : 'LinkedIn text is direct; image publishing requires the persisted staged worker executor'
  return {
    ...query,
    availability: 'conditional',
    modes: query.platform === 'linkedin' ? ['automatic', 'assisted'] : ['automatic'],
    reason,
  }
}

const capabilityForBlockedAccount = (
  query: PlatformCapabilityQuery,
  reason: string,
): PlatformCapability => ({
  ...query,
  availability: 'blocked',
  modes: query.platform === 'linkedin' ? ['assisted'] : [],
  reason,
})

const mapPublishError = (
  request: PlatformPublishRequest,
  error: unknown,
): PlatformPublishAcceptance => {
  if (error instanceof ProviderPublicationConfirmedError) {
    return blocked(request, error.code, error.retryable)
  }
  if (error instanceof ProviderPublicationTransportError) {
    return blocked(request, error.code, error.retryable)
  }
  if (error instanceof ProviderPublicationResultUnknownError) {
    return deliveryUnknown(request)
  }
  return deliveryUnknown(request)
}

const mapStatusError = (
  lookup: PlatformPublicationStatusLookup,
  error: unknown,
): ReturnType<typeof failed> | DeliveryUnknownPlatformPublication => {
  if (error instanceof ProviderPublicationConfirmedError) {
    return lookup.externalPublicationId
      ? deliveryUnknown(lookup, lookup.externalPublicationId)
      : failed(lookup, error.code, error.retryable)
  }
  if (error instanceof ProviderPublicationTransportError) {
    throw error
  }
  return deliveryUnknown(lookup, lookup.externalPublicationId)
}

/**
 * Worker-only adapter for the provider operations that are safe in one fenced
 * mutation. Instagram and LinkedIn image publishing remain on their staged
 * executors; routing either through this service would permit unsafe replay.
 */
export const createPlatformPublishingService = ({
  accountResolver,
  linkedInTransport,
  metaTransport,
}: {
  accountResolver: PublishingAccountResolverPort
  linkedInTransport: LinkedInPublishingTransport
  metaTransport: MetaPublishingTransport
}): PublishingService => ({
  async getCapability(input) {
    const query = normalizePlatformCapabilityQuery(input)
    const resolution = await accountResolver.resolve(query)
    return resolution.status === 'resolved' && resolvedAccountMatches(query, resolution.account)
      ? capabilityForResolvedAccount(query)
      : capabilityForBlockedAccount(
          query,
          resolution.status === 'blocked' ? resolution.reason : 'account_platform_mismatch',
        )
  },

  async getStatus(input) {
    const lookup = normalizePlatformPublicationStatusLookup(input)
    const resolution = await accountResolver.resolve(lookup)
    if (resolution.status === 'blocked') {
      return lookup.externalPublicationId
        ? deliveryUnknown(lookup, lookup.externalPublicationId)
        : failed(lookup, accountResolutionErrorCode(resolution.reason))
    }
    if (!resolvedAccountMatches(lookup, resolution.account)) {
      return lookup.externalPublicationId
        ? deliveryUnknown(lookup, lookup.externalPublicationId)
        : failed(lookup, 'account_not_connected')
    }

    if (lookup.platform === 'instagram') {
      return failed(lookup, 'platform_blocked')
    }

    if (lookup.platform === 'facebook') {
      if (!lookup.externalPublicationId || !/^\d+_\d+$/u.test(lookup.externalPublicationId)) {
        return deliveryUnknown(lookup, lookup.externalPublicationId)
      }
      try {
        const result = await metaTransport.getFacebookPagePostPermalink({
          accountExternalId: resolution.account.externalAccountId,
          authorizationRevision: resolution.account.authorizationRevision,
          platformAccountId: resolution.account.platformAccountId,
          postId: lookup.externalPublicationId,
        })
        return {
          ...lookup,
          externalPublicationId: lookup.externalPublicationId,
          externalPublicationUrl: result.permalinkUrl,
          status: 'published',
        }
      } catch (error) {
        return mapStatusError(lookup, error)
      }
    }

    if (!lookup.externalPublicationId) {
      return deliveryUnknown(lookup)
    }
    try {
      const result = await linkedInTransport.getPostStatus({
        authorization: {
          authorizationRevision: resolution.account.authorizationRevision,
          platformAccountId: resolution.account.platformAccountId,
        },
        author: linkedInAuthor(resolution.account),
        postUrn: lookup.externalPublicationId,
      })
      return {
        ...lookup,
        externalPublicationId: lookup.externalPublicationId,
        ...(result.lifecycleState === 'PUBLISHED' && result.externalPublicationUrl
          ? { externalPublicationUrl: result.externalPublicationUrl }
          : {}),
        status:
          result.lifecycleState === 'PUBLISHED'
            ? 'published'
            : result.lifecycleState === 'PROCESSING'
              ? 'publishing'
              : 'pending',
      }
    } catch (error) {
      return mapStatusError(lookup, error)
    }
  },

  async publish(input) {
    const query = normalizePlatformCapabilityQuery(input)
    const idempotencyKey = normalizePublicationIdempotencyKey(input.idempotencyKey)
    let request: PlatformPublishRequest
    try {
      request = normalizePlatformPublishRequest(input)
    } catch (error) {
      if (!(error instanceof PublishingContractValidationError)) throw error
      return blocked({ ...query, idempotencyKey }, 'invalid_request')
    }

    if (request.scheduledFor) return blocked(request, 'invalid_request')
    const resolution = await accountResolver.resolve(request)
    if (resolution.status === 'blocked') {
      return blocked(request, accountResolutionErrorCode(resolution.reason))
    }
    if (!resolvedAccountMatches(request, resolution.account)) {
      return blocked(request, 'account_not_connected')
    }

    if (request.platform === 'instagram') {
      return blocked(request, 'platform_blocked')
    }

    if (request.platform === 'facebook') {
      const [asset] = request.assets
      if (
        request.assets.length !== 1 ||
        !asset ||
        !DIRECT_IMAGE_MIME_TYPES.has(asset.mimeType) ||
        !asset.sourceUrl
      ) {
        return blocked(request, 'invalid_request')
      }
      try {
        const result = await metaTransport.publishFacebookPagePhoto({
          accountExternalId: resolution.account.externalAccountId,
          authorizationRevision: resolution.account.authorizationRevision,
          caption: request.text,
          platformAccountId: resolution.account.platformAccountId,
          url: asset.sourceUrl,
        })
        const externalPublicationId = result.postId ?? result.photoId
        if (
          typeof externalPublicationId !== 'string' ||
          !/^\d+(?:_\d+)?$/u.test(externalPublicationId)
        ) {
          return deliveryUnknown(request)
        }
        let externalPublicationUrl: string | undefined
        if (result.postId) {
          try {
            externalPublicationUrl = (
              await metaTransport.getFacebookPagePostPermalink({
                accountExternalId: resolution.account.externalAccountId,
                authorizationRevision: resolution.account.authorizationRevision,
                platformAccountId: resolution.account.platformAccountId,
                postId: result.postId,
              })
            ).permalinkUrl
          } catch {
            // The mutation is already confirmed. Keep the provider ID and leave the URL unavailable.
          }
        }
        return {
          externalPublicationId,
          ...(externalPublicationUrl ? { externalPublicationUrl } : {}),
          idempotencyKey: request.idempotencyKey,
          platform: request.platform,
          platformAccountId: request.platformAccountId,
          status: 'accepted',
        }
      } catch (error) {
        return mapPublishError(request, error)
      }
    }

    if (request.assets.length !== 0) return blocked(request, 'invalid_request')
    try {
      const result = await linkedInTransport.publishTextPost({
        authorization: {
          authorizationRevision: resolution.account.authorizationRevision,
          platformAccountId: resolution.account.platformAccountId,
        },
        author: linkedInAuthor(resolution.account),
        commentary: request.text,
      })
      if (!/^urn:li:(?:share|ugcPost):\d+$/u.test(result.postUrn)) {
        return deliveryUnknown(request)
      }
      let externalPublicationUrl: string | undefined
      try {
        const status = await linkedInTransport.getPostStatus({
          authorization: {
            authorizationRevision: resolution.account.authorizationRevision,
            platformAccountId: resolution.account.platformAccountId,
          },
          author: linkedInAuthor(resolution.account),
          postUrn: result.postUrn,
        })
        if (status.lifecycleState === 'PUBLISHED') {
          externalPublicationUrl = status.externalPublicationUrl
        }
      } catch {
        // The mutation is already confirmed. Keep the URN and leave the URL unavailable.
      }
      return {
        externalPublicationId: result.postUrn,
        ...(externalPublicationUrl ? { externalPublicationUrl } : {}),
        idempotencyKey: request.idempotencyKey,
        platform: request.platform,
        platformAccountId: request.platformAccountId,
        status: 'accepted',
      }
    } catch (error) {
      return mapPublishError(request, error)
    }
  },

  async prepareAssistedPublication(input) {
    const query = normalizePlatformCapabilityQuery(input)
    try {
      return createLinkedInAssistedPreparation(normalizeAssistedPublicationRequest(input))
    } catch (error) {
      if (!(error instanceof PublishingContractValidationError)) throw error
      const result: BlockedAssistedPublication = {
        ...query,
        errorCode: 'invalid_request',
        mode: 'assisted',
        retryable: false,
        status: 'blocked',
      }
      return result
    }
  },
})
