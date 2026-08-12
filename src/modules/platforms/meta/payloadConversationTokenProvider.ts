import type { Payload } from 'payload'

import { platformRuntimeCredentialReadContext } from '@/access/platformCredentials'

import { decryptPlatformCredential, readPlatformCredentialEncryptionKey } from '../credentials'
import type { MetaConversationAccessTokenProvider } from './conversationOutbound'
import type { MetaConversationReplyPlatform } from './conversationRequests'

const accountKindForPlatform = (
  platform: MetaConversationReplyPlatform,
): 'facebook-page' | 'instagram-professional' =>
  platform === 'facebook-messenger' ? 'facebook-page' : 'instagram-professional'

const boundedExternalId = (value: string): string | undefined => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized && normalized === value && /^[A-Za-z0-9._:-]{1,240}$/.test(normalized)
    ? normalized
    : undefined
}

/**
 * Server-only credential resolver. It does not authorize automatic replies;
 * the future delivery authority must separately require messaging-outbound
 * readiness before calling the HTTP adapter.
 */
export class PayloadMetaConversationTokenProvider {
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

  readonly getToken: MetaConversationAccessTokenProvider = async ({
    accountExternalId,
    platform,
  }) => {
    const normalizedAccountId = boundedExternalId(accountExternalId)
    if (!normalizedAccountId) return undefined

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
          state: true,
        },
      },
      where: {
        and: [
          { accountKind: { equals: accountKindForPlatform(platform) } },
          { externalAccountId: { equals: normalizedAccountId } },
        ],
      },
    })
    if (accounts.docs.length !== 1) return undefined

    const authorization = accounts.docs[0]?.authorization
    if (authorization?.state !== 'connected' || authorization.accessTokenConfigured !== true) {
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
