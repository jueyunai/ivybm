import type { Payload } from 'payload'

import type { PlatformAccountId, PublishingPlatform } from '../publishing/contracts'
import type { PlatformAccountFamily, PlatformAccountKind } from './readiness'

export const PUBLISHING_ACCOUNT_RESOLUTION_ERRORS = [
  'account_ambiguous',
  'account_not_found',
  'account_platform_mismatch',
  'authorization_expired',
  'authorization_not_connected',
  'capability_not_approved',
  'credential_not_configured',
  'external_account_id_missing',
  'stale_authorization_revision',
] as const

export type PublishingAccountResolutionError = (typeof PUBLISHING_ACCOUNT_RESOLUTION_ERRORS)[number]

export type ResolvedPublishingAccount = {
  accountKind: Extract<
    PlatformAccountKind,
    'facebook-page' | 'instagram-professional' | 'linkedin-member' | 'linkedin-organization'
  >
  authorizationRevision: number
  externalAccountId: string
  family: Extract<PlatformAccountFamily, 'linkedin' | 'meta'>
  platform: PublishingPlatform
  platformAccountId: PlatformAccountId
  publishingApproval: 'approved'
}

export type PublishingAccountResolution =
  | { account: ResolvedPublishingAccount; status: 'resolved' }
  | { reason: PublishingAccountResolutionError; status: 'blocked' }

export type ResolvePublishingAccountInput = {
  expectedAuthorizationRevision?: number
  platform: PublishingPlatform
  platformAccountId: PlatformAccountId
}

export interface PublishingAccountResolverPort {
  resolve(input: ResolvePublishingAccountInput): Promise<PublishingAccountResolution>
}

const expectedKinds: Record<
  PublishingPlatform,
  readonly ResolvedPublishingAccount['accountKind'][]
> = {
  facebook: ['facebook-page'],
  instagram: ['instagram-professional'],
  linkedin: ['linkedin-member', 'linkedin-organization'],
}

const expectedFamily: Record<PublishingPlatform, ResolvedPublishingAccount['family']> = {
  facebook: 'meta',
  instagram: 'meta',
  linkedin: 'linkedin',
}

const boundedInternalId = (value: unknown): PlatformAccountId | undefined => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  }
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized &&
    normalized === value &&
    normalized.length <= 200 &&
    /^[A-Za-z0-9_-]+$/u.test(normalized)
    ? normalized
    : undefined
}

const boundedExternalId = (
  value: unknown,
  kind: ResolvedPublishingAccount['accountKind'],
): string | undefined => {
  if (typeof value !== 'string' || value !== value.trim()) return undefined
  if (
    kind === 'facebook-page' ||
    kind === 'instagram-professional' ||
    kind === 'linkedin-organization'
  ) {
    return /^[1-9]\d{0,31}$/u.test(value) ? value : undefined
  }
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value) ? value : undefined
}

const blocked = (reason: PublishingAccountResolutionError): PublishingAccountResolution => ({
  reason,
  status: 'blocked',
})

/**
 * Credential-free Payload resolver. It deliberately never selects or decrypts
 * access/refresh tokens; provider transports resolve credentials separately.
 */
export class PayloadPublishingAccountResolver implements PublishingAccountResolverPort {
  private readonly now: () => number
  private readonly payload: Payload

  constructor({ now = Date.now, payload }: { now?: () => number; payload: Payload }) {
    this.now = now
    this.payload = payload
  }

  async resolve(input: ResolvePublishingAccountInput): Promise<PublishingAccountResolution> {
    const platformAccountId = boundedInternalId(input.platformAccountId)
    if (!platformAccountId || !expectedKinds[input.platform]) {
      return blocked('account_platform_mismatch')
    }
    if (
      input.expectedAuthorizationRevision !== undefined &&
      (!Number.isSafeInteger(input.expectedAuthorizationRevision) ||
        input.expectedAuthorizationRevision < 0)
    ) {
      return blocked('stale_authorization_revision')
    }

    const accounts = await this.payload.find({
      collection: 'platform-accounts',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      pagination: false,
      select: {
        accountKind: true,
        authorization: {
          accessTokenConfigured: true,
          expiresAt: true,
          state: true,
        },
        authorizationRevision: true,
        capabilities: { publishing: true },
        externalAccountId: true,
        platformFamily: true,
      },
      where: { id: { equals: platformAccountId } },
    })
    if (!accounts.docs.length) return blocked('account_not_found')
    if (accounts.docs.length !== 1) return blocked('account_ambiguous')
    const account = accounts.docs[0]
    if (
      !expectedKinds[input.platform].includes(
        account.accountKind as ResolvedPublishingAccount['accountKind'],
      ) ||
      account.platformFamily !== expectedFamily[input.platform]
    ) {
      return blocked('account_platform_mismatch')
    }
    const accountKind = account.accountKind as ResolvedPublishingAccount['accountKind']
    const externalAccountId = boundedExternalId(account.externalAccountId, accountKind)
    if (!externalAccountId) return blocked('external_account_id_missing')
    if (
      !Number.isSafeInteger(account.authorizationRevision) ||
      account.authorizationRevision < 0 ||
      (input.expectedAuthorizationRevision !== undefined &&
        account.authorizationRevision !== input.expectedAuthorizationRevision)
    ) {
      return blocked('stale_authorization_revision')
    }
    if (account.authorization?.state === 'expired') {
      return blocked('authorization_expired')
    }
    if (account.authorization?.state !== 'connected') {
      return blocked('authorization_not_connected')
    }
    if (account.authorization.accessTokenConfigured !== true) {
      return blocked('credential_not_configured')
    }
    if (account.authorization.expiresAt) {
      const expiresAt = Date.parse(account.authorization.expiresAt)
      if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) {
        return blocked('authorization_expired')
      }
    }
    if (account.capabilities?.publishing !== 'approved') {
      return blocked('capability_not_approved')
    }
    return {
      account: {
        accountKind,
        authorizationRevision: account.authorizationRevision,
        externalAccountId,
        family: expectedFamily[input.platform],
        platform: input.platform,
        platformAccountId,
        publishingApproval: 'approved',
      },
      status: 'resolved',
    }
  }
}
