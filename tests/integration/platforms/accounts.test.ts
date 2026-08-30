import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import { NextRequest } from 'next/server'

import { POST as graphQLPost } from '@/app/(payload)/api/graphql/route'
import { GET as restGet } from '@/app/(payload)/api/[...slug]/route'
import { GET as platformReadinessGet } from '@/app/api/platforms/readiness/route'
import {
  decryptPlatformCredential,
  readPlatformCredentialEncryptionKey,
} from '@/modules/platforms/credentials'
import { PlatformAccountIdentityCredentialConflictError } from '@/modules/platforms/accountValidation'
import { platformMessagingIdentityWriteContextKey } from '@/collections/PlatformAccounts'
import type { User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let operator: User
let originalEncryptionKey: string | undefined
let originalMetaAllowedAccountIDs: string | undefined
let originalMetaAppSecret: string | undefined
let originalMetaVerifyToken: string | undefined
let originalPortalEnabled: string | undefined
let originalPortalPlatformsEnabled: string | undefined
const createdUserIDs: Array<number | string> = []
const createdAccountIDs: Array<number | string> = []

const accountData = ({
  accountKind,
  accessToken,
  externalAccountId,
  name,
  refreshToken,
  state,
}: {
  accountKind: 'facebook-page' | 'instagram-professional' | 'linkedin-member'
  accessToken?: string
  externalAccountId: string
  name: string
  refreshToken?: string
  state: 'connected' | 'pending'
}) => ({
  accountKind,
  authorizationRevision: 0,
  authorization: {
    accessToken: accessToken ?? null,
    accessTokenConfigured: false,
    appId: null,
    clearAccessToken: false,
    clearRefreshToken: false,
    expiresAt: null,
    refreshToken: refreshToken ?? null,
    refreshTokenConfigured: false,
    scopes: [],
    state,
  },
  capabilities: {
    messagingInbound: 'not_started' as const,
    publishing: 'not_started' as const,
  },
  connectionKey: null,
  externalAccountId,
  name,
  notes: null,
  platformFamily: 'meta' as const,
})

const storedAccessToken = async (accountID: number | string): Promise<string | null> => {
  const stored = await payload.findByID({
    collection: 'platform-accounts',
    id: accountID,
    overrideAccess: true,
  })
  const ciphertext = stored.authorization?.accessToken
  return typeof ciphertext === 'string'
    ? decryptPlatformCredential(ciphertext, readPlatformCredentialEncryptionKey())
    : null
}

describe.sequential('platform accounts', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

    originalEncryptionKey = process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
    originalMetaAllowedAccountIDs = process.env.META_WEBHOOK_ALLOWED_ACCOUNT_IDS
    originalMetaAppSecret = process.env.META_WEBHOOK_APP_SECRET
    originalMetaVerifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN
    originalPortalEnabled = process.env.ADMIN_PORTAL_ENABLED
    originalPortalPlatformsEnabled = process.env.ADMIN_PORTAL_PLATFORMS_ENABLED
    process.env.ADMIN_PORTAL_ENABLED = 'true'
    process.env.ADMIN_PORTAL_PLATFORMS_ENABLED = 'true'
    process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY = 'e'.repeat(64)
    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'platform-accounts-integration-tests',
    })

    const suffix = randomUUID()
    admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `platform-admin-${suffix}@example.invalid`,
        password: 'platform-accounts-admin-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
    operator = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `platform-operator-${suffix}@example.invalid`,
        password: 'platform-accounts-operator-password',
        role: 'operator',
      },
      overrideAccess: true,
    })
    createdUserIDs.push(admin.id, operator.id)
  })

  afterAll(async () => {
    if (payload) {
      if (createdAccountIDs.length > 0) {
        await payload.delete({
          collection: 'platform-accounts',
          context: { skipAudit: true },
          overrideAccess: true,
          where: { id: { in: createdAccountIDs } },
        })
      }
      await payload.delete({
        collection: 'audit-logs',
        overrideAccess: true,
        where: { actor: { in: createdUserIDs } },
      })
      await payload.delete({
        collection: 'users',
        context: { skipAudit: true },
        overrideAccess: true,
        where: { id: { in: createdUserIDs } },
      })
      await payload.destroy()
    }

    if (originalEncryptionKey === undefined) delete process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
    else process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    if (originalMetaAllowedAccountIDs === undefined)
      delete process.env.META_WEBHOOK_ALLOWED_ACCOUNT_IDS
    else process.env.META_WEBHOOK_ALLOWED_ACCOUNT_IDS = originalMetaAllowedAccountIDs
    if (originalMetaAppSecret === undefined) delete process.env.META_WEBHOOK_APP_SECRET
    else process.env.META_WEBHOOK_APP_SECRET = originalMetaAppSecret
    if (originalMetaVerifyToken === undefined) delete process.env.META_WEBHOOK_VERIFY_TOKEN
    else process.env.META_WEBHOOK_VERIFY_TOKEN = originalMetaVerifyToken
    if (originalPortalEnabled === undefined) delete process.env.ADMIN_PORTAL_ENABLED
    else process.env.ADMIN_PORTAL_ENABLED = originalPortalEnabled
    if (originalPortalPlatformsEnabled === undefined)
      delete process.env.ADMIN_PORTAL_PLATFORMS_ENABLED
    else process.env.ADMIN_PORTAL_PLATFORMS_ENABLED = originalPortalPlatformsEnabled
  })

  it('increments the authorization revision for every serialized account update', async () => {
    const suffix = randomUUID()
    const created = await payload.create({
      collection: 'platform-accounts',
      data: accountData({
        accountKind: 'facebook-page',
        externalAccountId: `revision-page-${suffix}`,
        name: `Revision Page ${suffix}`,
        state: 'pending',
      }),
      overrideAccess: false,
      user: admin,
    })
    createdAccountIDs.push(created.id)
    expect(created.authorizationRevision).toBe(0)

    const metadataUpdated = await payload.update({
      collection: 'platform-accounts',
      data: { notes: 'Invalidate any OAuth transaction started before this edit.' },
      id: created.id,
      overrideAccess: false,
      user: admin,
    })
    expect(metadataUpdated.authorizationRevision).toBe(1)

    const credentialAdded = await payload.update({
      collection: 'platform-accounts',
      data: { authorization: { accessToken: `revision-token-a-${suffix}` } },
      id: created.id,
      overrideAccess: false,
      user: admin,
    })
    expect(credentialAdded.authorizationRevision).toBe(2)

    const credentialReplaced = await payload.update({
      collection: 'platform-accounts',
      data: { authorization: { accessToken: `revision-token-b-${suffix}` } },
      id: created.id,
      overrideAccess: false,
      user: admin,
    })
    expect(credentialReplaced.authorizationRevision).toBe(3)

    const disconnected = await payload.update({
      collection: 'platform-accounts',
      data: {
        authorization: {
          clearAccessToken: true,
          clearRefreshToken: true,
          scopes: [],
          state: 'not_started',
        },
      },
      id: created.id,
      overrideAccess: false,
      user: admin,
    })
    expect(disconnected.authorizationRevision).toBe(4)

    const identityUpdated = await payload.update({
      collection: 'platform-accounts',
      data: { externalAccountId: `revision-page-next-${suffix}` },
      id: created.id,
      overrideAccess: false,
      user: admin,
    })
    expect(identityUpdated.authorizationRevision).toBe(5)
  })

  it('enforces one unique Instagram Messaging identity without conflating the OAuth ID', async () => {
    const suffix = randomUUID().replaceAll('-', '')
    const messagingExternalAccountId = `1${suffix.replaceAll(/[a-f]/gu, '1').slice(0, 16)}`
    const first = await payload.create({
      collection: 'platform-accounts',
      context: { [platformMessagingIdentityWriteContextKey]: true, skipAudit: true },
      data: {
        ...accountData({
          accountKind: 'instagram-professional',
          externalAccountId: `2${messagingExternalAccountId.slice(1)}`,
          name: `Instagram Messaging First ${suffix}`,
          state: 'pending',
        }),
        messagingExternalAccountId,
      },
      overrideAccess: true,
    })
    createdAccountIDs.push(first.id)

    await expect(
      payload.create({
        collection: 'platform-accounts',
        context: { [platformMessagingIdentityWriteContextKey]: true, skipAudit: true },
        data: {
          ...accountData({
            accountKind: 'instagram-professional',
            externalAccountId: `3${messagingExternalAccountId.slice(1)}`,
            name: `Instagram Messaging Second ${suffix}`,
            state: 'pending',
          }),
          messagingExternalAccountId,
        },
        overrideAccess: true,
      }),
    ).rejects.toThrow()

    const stored = await payload.findByID({
      collection: 'platform-accounts',
      id: first.id,
      overrideAccess: true,
    })
    expect(stored.externalAccountId).not.toBe(stored.messagingExternalAccountId)
    expect(stored.messagingConnectionKey).toBe(
      `instagram-professional:messaging:${messagingExternalAccountId}`,
    )
  })

  it('keeps the Instagram Messaging identity server-managed', async () => {
    const suffix = randomUUID().replaceAll('-', '')
    const numericSuffix = suffix.replaceAll(/[a-f]/gu, '1').slice(0, 15)
    const account = await payload.create({
      collection: 'platform-accounts',
      context: { [platformMessagingIdentityWriteContextKey]: true, skipAudit: true },
      data: {
        ...accountData({
          accountKind: 'instagram-professional',
          externalAccountId: `4${numericSuffix}`,
          name: `Instagram Messaging Access ${suffix}`,
          state: 'pending',
        }),
        messagingExternalAccountId: `5${numericSuffix}`,
      },
      overrideAccess: true,
    })
    createdAccountIDs.push(account.id)

    await expect(
      payload.update({
        collection: 'platform-accounts',
        data: { messagingExternalAccountId: `6${numericSuffix}` },
        id: account.id,
        overrideAccess: false,
        user: admin,
      }),
    ).rejects.toThrow()
  })

  it('keeps account tokens write-only, encrypted, and visible only to administrators', async () => {
    const suffix = randomUUID()
    const token = `platform-access-token-${suffix}`
    const refreshToken = `platform-refresh-token-${suffix}`
    const created = await payload.create({
      collection: 'platform-accounts',
      data: {
        ...accountData({
          accountKind: 'facebook-page',
          accessToken: token,
          externalAccountId: `page-${suffix}`,
          name: `Facebook Page ${suffix}`,
          refreshToken,
          state: 'connected',
        }),
        authorization: {
          ...accountData({
            accountKind: 'facebook-page',
            accessToken: token,
            externalAccountId: `page-${suffix}`,
            name: `Facebook Page ${suffix}`,
            refreshToken,
            state: 'connected',
          }).authorization,
          appId: `meta-app-${suffix}`,
        },
        capabilities: {
          messagingInbound: 'pending',
          publishing: 'not_started',
        },
      },
      overrideAccess: false,
      user: admin,
    })
    createdAccountIDs.push(created.id)

    expect(JSON.stringify(created)).not.toContain(token)
    expect(JSON.stringify(created)).not.toContain(refreshToken)
    expect(created).toMatchObject({
      accountKind: 'facebook-page',
      connectionKey: `facebook-page:page-${suffix}`,
      platformFamily: 'meta',
    })
    expect(created.authorization).toMatchObject({ accessTokenConfigured: true, state: 'connected' })

    const stored = await payload.findByID({
      collection: 'platform-accounts',
      id: created.id,
      overrideAccess: true,
    })
    expect(stored.authorization?.accessToken).toMatch(/^v1:/)
    expect(stored.authorization?.accessToken).not.toContain(token)
    expect(stored.authorization?.refreshToken).toMatch(/^v1:/)
    expect(stored.authorization?.refreshToken).not.toContain(refreshToken)
    const encryptedAccessToken = stored.authorization?.accessToken
    const encryptedRefreshToken = stored.authorization?.refreshToken
    if (!encryptedAccessToken || !encryptedRefreshToken) {
      throw new Error('Expected both encrypted credentials to be persisted')
    }
    const auditEntries = await payload.find({
      collection: 'audit-logs',
      overrideAccess: true,
      where: {
        and: [
          { documentId: { equals: String(created.id) } },
          { resource: { equals: 'platform-accounts' } },
        ],
      },
    })
    const auditBody = JSON.stringify(auditEntries.docs)
    expect(auditBody).not.toContain(token)
    expect(auditBody).not.toContain(refreshToken)
    expect(auditBody).not.toContain(encryptedAccessToken)
    expect(auditBody).not.toContain(encryptedRefreshToken)

    const login = await payload.login({
      collection: 'users',
      data: { email: admin.email, password: 'platform-accounts-admin-password' },
    })
    const authorization = `JWT ${login.token}`
    process.env.META_WEBHOOK_ALLOWED_ACCOUNT_IDS = `other-page,page-${suffix}`
    process.env.META_WEBHOOK_APP_SECRET = `meta-app-secret-${suffix}`
    process.env.META_WEBHOOK_VERIFY_TOKEN = `meta-verify-token-${suffix}`
    const response = await restGet(
      new NextRequest(`http://localhost/api/platform-accounts/${created.id}`, {
        headers: { authorization },
      }),
      { params: Promise.resolve({ slug: ['platform-accounts', String(created.id)] }) },
    )
    const responseBody = await response.text()
    expect(response.status).toBe(200)
    expect(responseBody).not.toContain(token)
    expect(responseBody).not.toContain(refreshToken)
    expect(responseBody).not.toContain(encryptedAccessToken)
    expect(responseBody).not.toContain(encryptedRefreshToken)

    const graphQLResponse = await graphQLPost(
      new NextRequest('http://localhost/api/graphql', {
        body: JSON.stringify({
          query: `query PlatformAccount($id: Int!) {
            PlatformAccount(id: $id) {
              authorization {
                accessToken
                refreshToken
              }
              id
            }
          }`,
          variables: { id: created.id },
        }),
        headers: { authorization, 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    const graphQLBody = await graphQLResponse.text()
    expect(graphQLResponse.status).toBe(200)
    expect(graphQLBody).not.toContain(token)
    expect(graphQLBody).not.toContain(refreshToken)
    expect(graphQLBody).not.toContain(encryptedAccessToken)
    expect(graphQLBody).not.toContain(encryptedRefreshToken)

    const readinessResponse = await platformReadinessGet(
      new NextRequest('http://localhost/api/platforms/readiness', {
        headers: { authorization },
      }),
    )
    const readinessBody = await readinessResponse.text()
    expect(readinessResponse.status).toBe(200)
    expect(readinessBody).not.toContain(token)
    expect(readinessBody).not.toContain(refreshToken)
    expect(readinessBody).not.toContain(encryptedAccessToken)
    expect(readinessBody).not.toContain(encryptedRefreshToken)
    expect(JSON.parse(readinessBody)).toMatchObject({
      accounts: expect.arrayContaining([
        expect.objectContaining({
          id: created.id,
          name: `Facebook Page ${suffix}`,
          readiness: expect.objectContaining({
            capabilities: expect.arrayContaining([
              expect.objectContaining({
                capability: 'messaging-inbound',
                missing: [],
                status: 'ready-for-controlled-test',
              }),
            ]),
            family: 'meta',
          }),
        }),
      ]),
    })

    await payload.update({
      collection: 'platform-accounts',
      data: { capabilities: { messagingInbound: 'blocked' } },
      id: created.id,
      overrideAccess: false,
      user: admin,
    })
    const blockedReadiness = await platformReadinessGet(
      new NextRequest('http://localhost/api/platforms/readiness', {
        headers: { authorization },
      }),
    )
    await expect(blockedReadiness.json()).resolves.toMatchObject({
      accounts: expect.arrayContaining([
        expect.objectContaining({
          id: created.id,
          readiness: expect.objectContaining({
            capabilities: expect.arrayContaining([
              expect.objectContaining({
                capability: 'messaging-inbound',
                reasonCode: 'platform_capability_blocked',
                status: 'blocked',
              }),
            ]),
          }),
        }),
      ]),
    })

    const operatorLogin = await payload.login({
      collection: 'users',
      data: { email: operator.email, password: 'platform-accounts-operator-password' },
    })
    await expect(
      platformReadinessGet(
        new NextRequest('http://localhost/api/platforms/readiness', {
          headers: { authorization: `JWT ${operatorLogin.token}` },
        }),
      ),
    ).resolves.toMatchObject({ status: 403 })

    const renamed = await payload.update({
      collection: 'platform-accounts',
      data: { name: `Renamed Facebook Page ${suffix}` },
      id: created.id,
      overrideAccess: false,
      user: admin,
    })
    expect(renamed.authorization).toMatchObject({ accessTokenConfigured: true })
    const afterRename = await payload.findByID({
      collection: 'platform-accounts',
      id: created.id,
      overrideAccess: true,
    })
    expect(afterRename.authorization?.accessToken).toBe(stored.authorization?.accessToken)

    // The credential master key is intentionally optional until a token is written.
    // A deployment that temporarily lacks it must still be able to change harmless
    // account metadata without decrypting, exposing, or replacing the opaque value.
    const configuredKey = process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
    delete process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
    try {
      const renamedWithoutKey = await payload.update({
        collection: 'platform-accounts',
        data: { notes: 'Metadata update while token encryption is unavailable.' },
        id: created.id,
        overrideAccess: false,
        user: admin,
      })
      expect(renamedWithoutKey.authorization).toMatchObject({ accessTokenConfigured: true })
      const afterMetadataUpdate = await payload.findByID({
        collection: 'platform-accounts',
        id: created.id,
        overrideAccess: true,
      })
      expect(afterMetadataUpdate.authorization?.accessToken).toBe(stored.authorization?.accessToken)
      expect(afterMetadataUpdate.authorization?.refreshToken).toBe(
        stored.authorization?.refreshToken,
      )

      const unreadableReadinessResponse = await platformReadinessGet(
        new NextRequest('http://localhost/api/platforms/readiness', {
          headers: { authorization },
        }),
      )
      const unreadableReadinessBody = await unreadableReadinessResponse.text()
      expect(unreadableReadinessResponse.status).toBe(200)
      expect(unreadableReadinessBody).not.toContain(token)
      expect(unreadableReadinessBody).not.toContain(encryptedAccessToken)
      expect(JSON.parse(unreadableReadinessBody)).toMatchObject({
        accounts: expect.arrayContaining([
          expect.objectContaining({
            id: created.id,
            readiness: expect.objectContaining({
              connection: {
                missing: ['credential_decryption', 'refresh_token_decryption'],
                status: 'action-required',
              },
            }),
          }),
        ]),
      })
    } finally {
      if (configuredKey === undefined) delete process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
      else process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY = configuredKey
    }

    await expect(
      payload.update({
        collection: 'platform-accounts',
        data: { authorization: { clearAccessToken: true } },
        id: created.id,
        overrideAccess: false,
        user: admin,
      }),
    ).rejects.toBeDefined()
    const revoked = await payload.update({
      collection: 'platform-accounts',
      data: {
        authorization: {
          clearAccessToken: true,
          clearRefreshToken: true,
          state: 'disabled',
        },
      },
      id: created.id,
      overrideAccess: false,
      user: admin,
    })
    expect(revoked.authorization).toMatchObject({
      accessTokenConfigured: false,
      refreshTokenConfigured: false,
      state: 'disabled',
    })

    await expect(
      payload.update({
        collection: 'platform-accounts',
        data: { name: `Operator update ${suffix}` },
        id: created.id,
        overrideAccess: false,
        user: operator,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('clears stale access-token expiry when the access token is replaced or revoked', async () => {
    const suffix = randomUUID()
    const firstExpiry = '2099-01-01T00:00:00.000Z'
    const secondExpiry = '2099-02-01T00:00:00.000Z'
    const base = accountData({
      accountKind: 'facebook-page',
      accessToken: `initial-expiry-token-${suffix}`,
      externalAccountId: `expiry-page-${suffix}`,
      name: `Expiry Page ${suffix}`,
      state: 'connected',
    })
    const account = await payload.create({
      collection: 'platform-accounts',
      data: {
        ...base,
        authorization: { ...base.authorization, expiresAt: firstExpiry },
      },
      overrideAccess: false,
      user: admin,
    })
    createdAccountIDs.push(account.id)
    expect(account.authorization?.expiresAt).toBe(firstExpiry)

    const replacedWithoutExpiry = await payload.update({
      collection: 'platform-accounts',
      data: { authorization: { accessToken: `replacement-expiry-token-${suffix}` } },
      id: account.id,
      overrideAccess: false,
      user: admin,
    })
    expect(replacedWithoutExpiry.authorization?.expiresAt).toBeNull()

    const replacedWithExpiry = await payload.update({
      collection: 'platform-accounts',
      data: {
        authorization: {
          accessToken: `second-expiry-token-${suffix}`,
          expiresAt: secondExpiry,
        },
      },
      id: account.id,
      overrideAccess: false,
      user: admin,
    })
    expect(replacedWithExpiry.authorization?.expiresAt).toBe(secondExpiry)

    const revoked = await payload.update({
      collection: 'platform-accounts',
      data: { authorization: { clearAccessToken: true, state: 'disabled' } },
      id: account.id,
      overrideAccess: false,
      user: admin,
    })
    expect(revoked.authorization).toMatchObject({
      accessTokenConfigured: false,
      expiresAt: null,
      state: 'disabled',
    })
  })

  it('reports an expired access token while proving a configured refresh token is readable', async () => {
    const suffix = randomUUID()
    const externalAccountId = `expired-page-${suffix}`
    const base = accountData({
      accountKind: 'facebook-page',
      accessToken: `expired-access-token-${suffix}`,
      externalAccountId,
      name: `Expired Page ${suffix}`,
      refreshToken: `readable-refresh-token-${suffix}`,
      state: 'connected',
    })
    const account = await payload.create({
      collection: 'platform-accounts',
      data: {
        ...base,
        authorization: { ...base.authorization, expiresAt: '2000-01-01T00:00:00.000Z' },
        capabilities: { messagingInbound: 'pending', publishing: 'not_started' },
      },
      overrideAccess: false,
      user: admin,
    })
    createdAccountIDs.push(account.id)
    process.env.META_WEBHOOK_ALLOWED_ACCOUNT_IDS = externalAccountId
    process.env.META_WEBHOOK_APP_SECRET = `meta-app-secret-${suffix}`
    process.env.META_WEBHOOK_VERIFY_TOKEN = `meta-verify-token-${suffix}`
    const login = await payload.login({
      collection: 'users',
      data: { email: admin.email, password: 'platform-accounts-admin-password' },
    })

    const response = await platformReadinessGet(
      new NextRequest('http://localhost/api/platforms/readiness', {
        headers: { authorization: `JWT ${login.token}` },
      }),
    )
    const body = (await response.json()) as {
      accounts: Array<{ id: number | string; readiness: { connection: unknown } }>
    }
    expect(response.status).toBe(200)
    expect(body.accounts.find(({ id }) => id === account.id)?.readiness.connection).toEqual({
      missing: ['access_token_expired'],
      status: 'action-required',
    })
  })

  it('allows an administrator to stage an unconnected account before a credential key exists', async () => {
    const configuredKey = process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
    delete process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
    const suffix = randomUUID()

    try {
      const staged = await payload.create({
        collection: 'platform-accounts',
        data: {
          accountKind: 'tiktok-business',
          authorizationRevision: 0,
          authorization: { state: 'not_started' },
          name: `TikTok staging ${suffix}`,
          platformFamily: 'tiktok',
        },
        overrideAccess: false,
        user: admin,
      })
      createdAccountIDs.push(staged.id)

      expect(staged).toMatchObject({
        accountKind: 'tiktok-business',
        authorization: { accessTokenConfigured: false, state: 'not_started' },
        platformFamily: 'tiktok',
      })
    } finally {
      if (configuredKey === undefined) delete process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
      else process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY = configuredKey
    }
  })

  it('refuses to promote a retained credential to connected when the master key is unavailable', async () => {
    const suffix = randomUUID()
    const pending = await payload.create({
      collection: 'platform-accounts',
      data: accountData({
        accountKind: 'linkedin-member',
        accessToken: `pending-linkedin-token-${suffix}`,
        externalAccountId: `pending-member-${suffix}`,
        name: `Pending LinkedIn ${suffix}`,
        state: 'pending',
      }),
      overrideAccess: false,
      user: admin,
    })
    createdAccountIDs.push(pending.id)

    const configuredKey = process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
    delete process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
    try {
      await expect(
        payload.update({
          collection: 'platform-accounts',
          data: { authorization: { state: 'connected' } },
          id: pending.id,
          overrideAccess: false,
          user: admin,
        }),
      ).rejects.toBeDefined()
    } finally {
      if (configuredKey === undefined) delete process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
      else process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY = configuredKey
    }

    await expect(
      payload.findByID({
        collection: 'platform-accounts',
        id: pending.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ authorization: { state: 'pending' } })
  })

  it('requires a fresh access token before a connected record can point to another provider account', async () => {
    const suffix = randomUUID()
    const connected = await payload.create({
      collection: 'platform-accounts',
      data: accountData({
        accountKind: 'facebook-page',
        accessToken: `original-page-token-${suffix}`,
        externalAccountId: `original-page-${suffix}`,
        name: `Identity guarded Page ${suffix}`,
        state: 'connected',
      }),
      overrideAccess: false,
      user: admin,
    })
    createdAccountIDs.push(connected.id)

    await expect(
      payload.update({
        collection: 'platform-accounts',
        data: { externalAccountId: `replacement-page-${suffix}` },
        id: connected.id,
        overrideAccess: false,
        user: admin,
      }),
    ).rejects.toBeInstanceOf(PlatformAccountIdentityCredentialConflictError)

    await expect(
      payload.findByID({
        collection: 'platform-accounts',
        id: connected.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      connectionKey: `facebook-page:original-page-${suffix}`,
      externalAccountId: `original-page-${suffix}`,
    })

    const reauthorized = await payload.update({
      collection: 'platform-accounts',
      data: {
        authorization: { accessToken: `replacement-page-token-${suffix}` },
        externalAccountId: `replacement-page-${suffix}`,
      },
      id: connected.id,
      overrideAccess: false,
      user: admin,
    })
    expect(reauthorized).toMatchObject({
      connectionKey: `facebook-page:replacement-page-${suffix}`,
      externalAccountId: `replacement-page-${suffix}`,
    })
  })

  it('does not attach a staged access token to its first external account without reauthorization', async () => {
    const suffix = randomUUID()
    const staged = await payload.create({
      collection: 'platform-accounts',
      data: {
        ...accountData({
          accountKind: 'facebook-page',
          accessToken: `staged-page-token-${suffix}`,
          externalAccountId: `placeholder-page-${suffix}`,
          name: `Staged identity Page ${suffix}`,
          state: 'pending',
        }),
        externalAccountId: null,
      },
      overrideAccess: false,
      user: admin,
    })
    createdAccountIDs.push(staged.id)

    await expect(
      payload.update({
        collection: 'platform-accounts',
        data: { externalAccountId: `first-page-${suffix}` },
        id: staged.id,
        overrideAccess: false,
        user: admin,
      }),
    ).rejects.toBeInstanceOf(PlatformAccountIdentityCredentialConflictError)

    await expect(
      payload.findByID({
        collection: 'platform-accounts',
        id: staged.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      connectionKey: null,
      externalAccountId: null,
    })

    await expect(
      payload.update({
        collection: 'platform-accounts',
        data: {
          authorization: { accessToken: `first-page-token-${suffix}` },
          externalAccountId: `first-page-${suffix}`,
        },
        id: staged.id,
        overrideAccess: false,
        user: admin,
      }),
    ).resolves.toMatchObject({
      connectionKey: `facebook-page:first-page-${suffix}`,
      externalAccountId: `first-page-${suffix}`,
    })
  })

  it('does not carry a retained refresh token to another provider account identity', async () => {
    const suffix = randomUUID()
    const staged = await payload.create({
      collection: 'platform-accounts',
      data: accountData({
        accountKind: 'linkedin-member',
        externalAccountId: `original-member-${suffix}`,
        name: `Refresh token identity guard ${suffix}`,
        refreshToken: `original-refresh-token-${suffix}`,
        state: 'pending',
      }),
      overrideAccess: false,
      user: admin,
    })
    createdAccountIDs.push(staged.id)

    await expect(
      payload.update({
        collection: 'platform-accounts',
        data: { externalAccountId: `replacement-member-${suffix}` },
        id: staged.id,
        overrideAccess: false,
        user: admin,
      }),
    ).rejects.toBeInstanceOf(PlatformAccountIdentityCredentialConflictError)

    const cleared = await payload.update({
      collection: 'platform-accounts',
      data: {
        authorization: { clearRefreshToken: true },
        externalAccountId: `replacement-member-${suffix}`,
      },
      id: staged.id,
      overrideAccess: false,
      user: admin,
    })
    expect(cleared).toMatchObject({
      authorization: { refreshTokenConfigured: false, state: 'pending' },
      connectionKey: `linkedin-member:replacement-member-${suffix}`,
      externalAccountId: `replacement-member-${suffix}`,
    })
  })

  it('rejects an invalid connected state and duplicate provider account identity', async () => {
    const suffix = randomUUID()
    await expect(
      payload.create({
        collection: 'platform-accounts',
        data: accountData({
          accountKind: 'linkedin-member',
          externalAccountId: `member-${suffix}`,
          name: `Invalid LinkedIn ${suffix}`,
          state: 'connected',
        }),
        overrideAccess: false,
        user: admin,
      }),
    ).rejects.toBeDefined()

    const first = await payload.create({
      collection: 'platform-accounts',
      data: accountData({
        accountKind: 'linkedin-member',
        accessToken: `linkedin-token-${suffix}`,
        externalAccountId: `member-${suffix}`,
        name: `LinkedIn ${suffix}`,
        state: 'connected',
      }),
      overrideAccess: false,
      user: admin,
    })
    createdAccountIDs.push(first.id)

    await expect(
      payload.create({
        collection: 'platform-accounts',
        data: accountData({
          accountKind: 'linkedin-member',
          accessToken: `duplicate-token-${suffix}`,
          externalAccountId: `member-${suffix}`,
          name: `Duplicate LinkedIn ${suffix}`,
          state: 'connected',
        }),
        overrideAccess: false,
        user: admin,
      }),
    ).rejects.toBeDefined()
  })

  it('serializes credential, revocation, and identity updates with concurrent metadata writes', async () => {
    const suffix = randomUUID()
    const attempts = 12

    const replacement = await payload.create({
      collection: 'platform-accounts',
      data: accountData({
        accountKind: 'facebook-page',
        accessToken: `initial-replacement-token-${suffix}`,
        externalAccountId: `replacement-page-${suffix}`,
        name: `Replacement race ${suffix}`,
        state: 'connected',
      }),
      overrideAccess: false,
      user: admin,
    })
    createdAccountIDs.push(replacement.id)

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const replacementToken = `replacement-token-${attempt}-${suffix}`
      await Promise.all([
        payload.update({
          collection: 'platform-accounts',
          data: { authorization: { accessToken: replacementToken } },
          id: replacement.id,
          overrideAccess: false,
          user: admin,
        }),
        payload.update({
          collection: 'platform-accounts',
          data: { notes: `metadata-replacement-${attempt}` },
          id: replacement.id,
          overrideAccess: false,
          user: admin,
        }),
      ])
      await expect(storedAccessToken(replacement.id)).resolves.toBe(replacementToken)
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const revocation = await payload.create({
        collection: 'platform-accounts',
        data: accountData({
          accountKind: 'facebook-page',
          accessToken: `initial-revocation-token-${attempt}-${suffix}`,
          externalAccountId: `revocation-page-${attempt}-${suffix}`,
          name: `Revocation race ${attempt} ${suffix}`,
          state: 'connected',
        }),
        overrideAccess: false,
        user: admin,
      })
      createdAccountIDs.push(revocation.id)

      await Promise.all([
        payload.update({
          collection: 'platform-accounts',
          data: {
            authorization: {
              clearAccessToken: true,
              clearRefreshToken: true,
              state: 'disabled',
            },
          },
          id: revocation.id,
          overrideAccess: false,
          user: admin,
        }),
        payload.update({
          collection: 'platform-accounts',
          data: { notes: `metadata-revocation-${attempt}` },
          id: revocation.id,
          overrideAccess: false,
          user: admin,
        }),
      ])

      await expect(
        payload.findByID({
          collection: 'platform-accounts',
          id: revocation.id,
          overrideAccess: true,
        }),
      ).resolves.toMatchObject({
        authorization: {
          accessToken: null,
          accessTokenConfigured: false,
          refreshToken: null,
          refreshTokenConfigured: false,
          state: 'disabled',
        },
      })
    }

    const identity = await payload.create({
      collection: 'platform-accounts',
      data: accountData({
        accountKind: 'linkedin-member',
        accessToken: `initial-identity-token-${suffix}`,
        externalAccountId: `identity-member-${suffix}`,
        name: `Identity race ${suffix}`,
        state: 'pending',
      }),
      overrideAccess: false,
      user: admin,
    })
    createdAccountIDs.push(identity.id)

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const externalAccountId = `identity-replacement-${attempt}-${suffix}`
      const replacementToken = `identity-replacement-token-${attempt}-${suffix}`
      await Promise.all([
        payload.update({
          collection: 'platform-accounts',
          data: {
            authorization: { accessToken: replacementToken },
            externalAccountId,
          },
          id: identity.id,
          overrideAccess: false,
          user: admin,
        }),
        payload.update({
          collection: 'platform-accounts',
          data: { notes: `metadata-identity-${attempt}` },
          id: identity.id,
          overrideAccess: false,
          user: admin,
        }),
      ])

      await expect(
        payload.findByID({
          collection: 'platform-accounts',
          id: identity.id,
          overrideAccess: true,
        }),
      ).resolves.toMatchObject({
        connectionKey: `linkedin-member:${externalAccountId}`,
        externalAccountId,
      })
      await expect(storedAccessToken(identity.id)).resolves.toBe(replacementToken)
    }
  })

  it('rejects update paths that would bypass platform account row serialization', async () => {
    const suffix = randomUUID()
    const account = await payload.create({
      collection: 'platform-accounts',
      data: accountData({
        accountKind: 'facebook-page',
        accessToken: `serialization-token-${suffix}`,
        externalAccountId: `serialization-page-${suffix}`,
        name: `Serialization guard ${suffix}`,
        state: 'connected',
      }),
      overrideAccess: false,
      user: admin,
    })
    createdAccountIDs.push(account.id)

    await expect(
      payload.update({
        collection: 'platform-accounts',
        data: { notes: 'A bulk write must not bypass the account lock.' },
        overrideAccess: true,
        where: { id: { equals: account.id } },
      }),
    ).rejects.toBeDefined()

    await expect(
      payload.update({
        collection: 'platform-accounts',
        data: { notes: 'A transactionless write must fail closed.' },
        disableTransaction: true,
        id: account.id,
        overrideAccess: true,
      }),
    ).rejects.toBeDefined()

    await expect(storedAccessToken(account.id)).resolves.toBe(`serialization-token-${suffix}`)
  })
})
