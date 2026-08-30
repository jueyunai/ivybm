import type { Payload } from 'payload'

import { platformRuntimeCredentialReadContext } from '@/access/platformCredentials'

import { decryptPlatformCredential, readPlatformCredentialEncryptionKey } from '../credentials'
import type { MessagingPlatform } from '../types'

const accountKindForPlatform = (
  platform: MessagingPlatform,
): 'facebook-page' | 'instagram-professional' | undefined => {
  if (platform === 'facebook-messenger') return 'facebook-page'
  if (platform === 'instagram') return 'instagram-professional'
  return undefined
}

const identityFieldForPlatform = (
  platform: MessagingPlatform,
): 'externalAccountId' | 'messagingExternalAccountId' =>
  platform === 'instagram' ? 'messagingExternalAccountId' : 'externalAccountId'

const boundedExternalId = (value: string): string | undefined => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized && normalized === value && /^[0-9]{1,32}$/.test(normalized)
    ? normalized
    : undefined
}

export type MetaConversationAccessTokenProvider = (input: {
  accountExternalId: string
  platform: MessagingPlatform
}) => Promise<string | undefined>

/** Server-only provider that binds decrypted messaging credentials to one exact Meta account. */
export class PayloadMetaMessagingTokenProvider {
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
    const accountKind = accountKindForPlatform(platform)
    if (!normalizedAccountId || !accountKind) return undefined

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
        capabilities: { messagingInbound: true },
      },
      where: {
        and: [
          { accountKind: { equals: accountKind } },
          { [identityFieldForPlatform(platform)]: { equals: normalizedAccountId } },
        ],
      },
    })
    if (accounts.docs.length !== 1) return undefined

    const account = accounts.docs[0]
    if (account?.capabilities?.messagingInbound !== 'approved') return undefined

    const authorization = account?.authorization
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

    try {
      return decryptPlatformCredential(authorization.accessToken, this.encryptionKey)
    } catch {
      return undefined
    }
  }
}
