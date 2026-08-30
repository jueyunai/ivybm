import { createHash } from 'node:crypto'

import { getPayload } from 'payload'

import { platformRuntimeCredentialReadContext } from '@/access/platformCredentials'
import config from '@/payload.config'
import { platformMessagingIdentityWriteContextKey } from '@/collections/PlatformAccounts'
import { decryptPlatformCredential, readPlatformCredentialEncryptionKey } from '@/modules/platforms/credentials'
import { withLockedPlatformOAuthAccount } from '@/modules/platforms/accountOAuthConcurrency'
import { discoverInstagramMessagingAccountId } from '@/modules/platforms/instagram/oauth'
import type { User } from '@/payload-types'

const rawId = process.argv.find((arg) => arg.startsWith('--account-id='))?.slice(13)
const accountId = rawId ? Number(rawId) : Number.NaN
const apply = process.argv.includes('--apply')
if (!Number.isSafeInteger(accountId) || accountId <= 0) {
  throw new Error('Usage: pnpm platform:instagram:messaging-id --account-id=<id> [--apply]')
}

const payload = await getPayload({ config, disableOnInit: true, key: 'instagram-messaging-id-cli' })
try {
  const account = await payload.findByID({
    collection: 'platform-accounts',
    context: platformRuntimeCredentialReadContext,
    id: accountId,
    overrideAccess: true,
  })
  if (
    account.accountKind !== 'instagram-professional' ||
    !account.externalAccountId ||
    account.authorization.state !== 'connected' ||
    account.authorization.accessTokenConfigured !== true ||
    typeof account.authorization.accessToken !== 'string'
  ) throw new Error('Instagram account is not connected or has no readable credential')
  const token = decryptPlatformCredential(
    account.authorization.accessToken,
    readPlatformCredentialEncryptionKey(),
  )
  const profileResponse = await fetch(
    `https://graph.instagram.com/v22.0/me?fields=id,username,account_type`,
    { headers: { authorization: `Bearer ${token}` } },
  )
  const profile = await profileResponse.json() as { username?: unknown }
  const username = typeof profile.username === 'string' ? profile.username.trim() : ''
  if (!profileResponse.ok || !username) throw new Error('Instagram profile lookup failed')
  const discovered = await discoverInstagramMessagingAccountId({
    accessToken: token,
    oauthAccountId: account.externalAccountId,
    username,
  })
  if (!discovered) throw new Error('Instagram messaging identity could not be uniquely discovered')
  if (apply) {
    const operator = {
      id: 0,
      collection: 'users',
      email: 'break-glass-instagram-identity@localhost.invalid',
      role: 'admin',
    } as User
    await withLockedPlatformOAuthAccount({
      operation: (req) => {
        req.context[platformMessagingIdentityWriteContextKey] = true
        req.context.skipAudit = true
        return payload.update({
          collection: 'platform-accounts',
          data: { messagingExternalAccountId: discovered },
          id: accountId,
          overrideAccess: true,
          req,
          user: operator,
        })
      },
      payload,
      snapshot: {
        accountId: String(account.id),
        accountKind: 'instagram-professional',
        authorizationRevision: account.authorizationRevision,
        externalAccountId: account.externalAccountId,
      },
      user: operator,
    })
  }
  process.stdout.write(`${JSON.stringify({
    accountId,
    applied: apply,
    fingerprint: createHash('sha256').update(discovered).digest('hex').slice(0, 12),
  })}\n`)
} finally {
  await payload.destroy()
}
