import type { Payload } from 'payload'

import type { MessagingPlatform, NormalizedPlatformEvent } from './types'

export type PlatformMessagingAccountIdentity = Pick<
  NormalizedPlatformEvent,
  'accountExternalId' | 'platform'
>

export interface PlatformMessagingAccountAuthorizer {
  assertCanReceive(identity: PlatformMessagingAccountIdentity): Promise<void>
}

export type PlatformMessagingAccountAccessErrorCode =
  | 'account_blocked'
  | 'account_not_configured'
  | 'account_not_connected'
  | 'capability_blocked'
  | 'implementation_blocked'

export class PlatformMessagingAccountAccessError extends Error {
  readonly code: PlatformMessagingAccountAccessErrorCode

  constructor(code: PlatformMessagingAccountAccessErrorCode) {
    super(`Platform messaging account access denied: ${code}`)
    this.code = code
    this.name = 'PlatformMessagingAccountAccessError'
  }
}

const accountKindForPlatform = (
  platform: MessagingPlatform,
): 'facebook-page' | 'instagram-professional' | 'tiktok-business' => {
  if (platform === 'facebook-messenger') return 'facebook-page'
  if (platform === 'instagram') return 'instagram-professional'
  return 'tiktok-business'
}

export class PayloadPlatformMessagingAccountAuthorizer implements PlatformMessagingAccountAuthorizer {
  private readonly payload: Payload

  constructor({ payload }: { payload: Payload }) {
    this.payload = payload
  }

  async assertCanReceive({
    accountExternalId,
    platform,
  }: PlatformMessagingAccountIdentity): Promise<void> {
    const accounts = await this.payload.find({
      collection: 'platform-accounts',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      pagination: false,
      select: {
        authorization: { state: true },
        capabilities: { messagingInbound: true },
      },
      where: {
        and: [
          { accountKind: { equals: accountKindForPlatform(platform) } },
          { externalAccountId: { equals: accountExternalId } },
        ],
      },
    })
    if (accounts.docs.length !== 1) {
      throw new PlatformMessagingAccountAccessError('account_not_configured')
    }

    const account = accounts.docs[0]
    const state = account.authorization?.state
    if (state === 'blocked' || state === 'disabled') {
      throw new PlatformMessagingAccountAccessError('account_blocked')
    }
    if (state !== 'connected') {
      throw new PlatformMessagingAccountAccessError('account_not_connected')
    }
    if (account.capabilities?.messagingInbound === 'blocked') {
      throw new PlatformMessagingAccountAccessError('capability_blocked')
    }
    if (platform === 'tiktok') {
      throw new PlatformMessagingAccountAccessError('implementation_blocked')
    }
  }
}
