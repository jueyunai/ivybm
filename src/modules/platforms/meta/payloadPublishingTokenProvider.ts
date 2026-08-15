import type { Payload } from 'payload'

import { platformRuntimeCredentialReadContext } from '@/access/platformCredentials'

import { decryptPlatformCredential, readPlatformCredentialEncryptionKey } from '../credentials'
import { normalizePlatformAccountId } from '../../publishing/contracts'
import type {
  MetaPublishingAccessTokenProvider,
  MetaPublishingPlatform,
} from './publishingOutbound'

const accountKindForPlatform = (
  platform: MetaPublishingPlatform,
): 'facebook-page' | 'instagram-professional' =>
  platform === 'facebook' ? 'facebook-page' : 'instagram-professional'

const requiredPublishingScopeForPlatform = (platform: MetaPublishingPlatform): string =>
  platform === 'facebook' ? 'pages_manage_posts' : 'instagram_business_content_publish'

const boundedExternalId = (value: string): string | undefined => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized && normalized === value && /^[0-9]{1,32}$/.test(normalized)
    ? normalized
    : undefined
}

/** Server-only provider that binds decrypted publishing credentials to one exact Meta asset. */
export class PayloadMetaPublishingTokenProvider {
  private readonly encryptionKey: Buffer
  private readonly now: () => number
  private readonly payload: Payload

  constructor({
    encryptionKey = readPlatformCredentialEncryptionKey(),
    now = Date.now,
    payload,
  }: {
    encryptionKey?: Buffer
    now?: () => number
    payload: Payload
  }) {
    this.encryptionKey = Buffer.from(encryptionKey)
    this.now = now
    this.payload = payload
  }

  readonly getToken: MetaPublishingAccessTokenProvider = async ({
    accountExternalId,
    authorizationRevision,
    platform,
    platformAccountId,
  }) => {
    const normalizedAccountId = boundedExternalId(accountExternalId)
    let normalizedInternalId: ReturnType<typeof normalizePlatformAccountId>
    try {
      normalizedInternalId = normalizePlatformAccountId(platformAccountId)
    } catch {
      return undefined
    }
    if (
      !normalizedAccountId ||
      !Number.isSafeInteger(authorizationRevision) ||
      authorizationRevision < 0
    ) {
      return undefined
    }

    const accounts = await this.payload.find({
      collection: 'platform-accounts',
      context: platformRuntimeCredentialReadContext,
      depth: 0,
      limit: 2,
      overrideAccess: true,
      pagination: false,
      select: {
        authorization: {
          accessToken: true,
          accessTokenConfigured: true,
          expiresAt: true,
          scopes: true,
          state: true,
        },
        authorizationRevision: true,
        capabilities: { publishing: true },
      },
      where: {
        and: [
          { id: { equals: normalizedInternalId } },
          { accountKind: { equals: accountKindForPlatform(platform) } },
          { externalAccountId: { equals: normalizedAccountId } },
          { authorizationRevision: { equals: authorizationRevision } },
        ],
      },
    })
    if (accounts.docs.length !== 1) return undefined

    const account = accounts.docs[0]
    if (
      account?.authorizationRevision !== authorizationRevision ||
      account?.capabilities?.publishing !== 'approved'
    ) {
      return undefined
    }
    const authorization = account?.authorization
    if (authorization?.state !== 'connected' || authorization.accessTokenConfigured !== true) {
      return undefined
    }
    const requiredScope = requiredPublishingScopeForPlatform(platform)
    if (
      !Array.isArray(authorization.scopes) ||
      !authorization.scopes.some((entry) => entry?.scope === requiredScope)
    ) {
      return undefined
    }
    if (authorization.expiresAt) {
      const expiresAt = Date.parse(authorization.expiresAt)
      if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) return undefined
    }
    if (typeof authorization.accessToken !== 'string' || !authorization.accessToken) {
      return undefined
    }

    return decryptPlatformCredential(authorization.accessToken, this.encryptionKey)
  }
}
