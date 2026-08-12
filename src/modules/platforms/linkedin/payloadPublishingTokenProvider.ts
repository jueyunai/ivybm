import type { Payload } from 'payload'

import { platformRuntimeCredentialReadContext } from '@/access/platformCredentials'

import { decryptPlatformCredential, readPlatformCredentialEncryptionKey } from '../credentials'
import type {
  LinkedInPublishingAccessTokenProvider,
  LinkedInPublishingAccountKind,
} from './publishingOutbound'

const boundedExternalId = (
  value: string,
  accountKind: LinkedInPublishingAccountKind,
): string | undefined => {
  if (typeof value !== 'string' || value !== value.trim()) return undefined
  if (accountKind === 'linkedin-organization') {
    return /^[0-9]{1,32}$/.test(value) ? value : undefined
  }
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined
}

/** Server-only provider that binds decrypted credentials to one exact LinkedIn author. */
export class PayloadLinkedInPublishingTokenProvider {
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

  readonly getToken: LinkedInPublishingAccessTokenProvider = async ({
    accountExternalId,
    accountKind,
  }) => {
    const normalizedAccountId = boundedExternalId(accountExternalId, accountKind)
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
        capabilities: { publishing: true },
      },
      where: {
        and: [
          { accountKind: { equals: accountKind } },
          { externalAccountId: { equals: normalizedAccountId } },
        ],
      },
    })
    if (accounts.docs.length !== 1) return undefined

    const account = accounts.docs[0]
    const authorization = account?.authorization
    if (
      account?.capabilities?.publishing !== 'approved' ||
      authorization?.state !== 'connected' ||
      authorization.accessTokenConfigured !== true
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
