import type { Payload, PayloadRequest } from 'payload'

import { platformReadinessCredentialReadContext } from '@/access/platformCredentials'
import { canDecryptPlatformCredential } from '@/modules/platforms/credentials'
import {
  assessPlatformAccountReadiness,
  type PlatformAccountReadiness,
} from '@/modules/platforms/readiness'
import type { PortalEnvironment, PortalRole } from '@/admin-portal/core/modules/types'
import type { PlatformAccount } from '@/payload-types'

export type PlatformReadinessPageState =
  'available' | 'forbidden' | 'module-disabled' | 'portal-disabled'

export interface PlatformReadinessAccountSummary {
  accountKind: PlatformAccount['accountKind']
  authorization: {
    accessTokenConfigured: boolean
    refreshTokenConfigured: boolean
    state: PlatformAccount['authorization']['state']
  }
  authorizationRevision: number
  capabilities: {
    messagingInbound: NonNullable<PlatformAccount['capabilities']>['messagingInbound']
    publishing: NonNullable<PlatformAccount['capabilities']>['publishing']
  }
  externalAccountId: string | null
  id: number
  name: string
  notes: string | null
  readiness: PlatformAccountReadiness
}

export interface PlatformReadinessSummary {
  accounts: PlatformReadinessAccountSummary[]
}

export interface PlatformReadinessPageData {
  state: PlatformReadinessPageState
  summary: PlatformReadinessSummary | null
}

export class PlatformReadinessReadError extends Error {
  readonly code = 'platform-readiness-read-failed'

  constructor(cause?: unknown) {
    super('Unable to read platform readiness', cause === undefined ? undefined : { cause })
  }
}

export const toPlatformReadinessAccountSummary = ({
  account,
  controlledPublishingTest,
  environment,
}: {
  account: PlatformAccount
  controlledPublishingTest?: { completedAt: string; reference: string }
  environment: Readonly<Record<string, string | undefined>>
}): PlatformReadinessAccountSummary => {
  const authorization = account.authorization
  const capabilities = account.capabilities
  const accessTokenConfigured = authorization.accessTokenConfigured === true

  return {
    accountKind: account.accountKind,
    authorization: {
      accessTokenConfigured,
      refreshTokenConfigured: authorization.refreshTokenConfigured === true,
      state: authorization.state,
    },
    authorizationRevision: account.authorizationRevision,
    capabilities: {
      messagingInbound: capabilities?.messagingInbound,
      publishing: capabilities?.publishing,
    },
    externalAccountId: account.externalAccountId ?? null,
    id: account.id,
    name: account.name,
    notes: account.notes ?? null,
    readiness: assessPlatformAccountReadiness({
      account: {
        accessTokenConfigured,
        accessTokenExpiresAt: authorization.expiresAt,
        accessTokenReadable:
          accessTokenConfigured && canDecryptPlatformCredential(authorization.accessToken),
        accountKind: account.accountKind,
        authorizationState: authorization.state,
        capabilityApprovals: {
          ...(capabilities?.messagingInbound
            ? { messagingInbound: capabilities.messagingInbound }
            : {}),
          ...(capabilities?.publishing ? { publishing: capabilities.publishing } : {}),
        },
        ...(controlledPublishingTest
          ? {
              controlledTestEvidence: {
                publishing: {
                  ...controlledPublishingTest,
                  outcome: 'passed' as const,
                },
              },
            }
          : {}),
        externalAccountId: account.externalAccountId,
        refreshTokenConfigured: authorization.refreshTokenConfigured === true,
        refreshTokenReadable:
          authorization.refreshTokenConfigured === true &&
          canDecryptPlatformCredential(authorization.refreshToken),
      },
      environment,
    }),
  }
}

export const listPlatformReadiness = async ({
  environment,
  payload,
  req,
}: {
  environment: Readonly<Record<string, string | undefined>>
  payload: Payload
  req?: PayloadRequest
}): Promise<PlatformReadinessSummary> => {
  // Credential ciphertext is read only long enough to verify that the current
  // server can decrypt it. The returned DTO never contains it or the token state.
  const accounts = await payload.find({
    collection: 'platform-accounts',
    context: req ? platformReadinessCredentialReadContext : undefined,
    depth: 0,
    overrideAccess: req ? false : true,
    pagination: false,
    ...(req ? { req } : {}),
    sort: 'name',
  })
  const accountIDs = accounts.docs.map((account) => account.id)
  const successfulPublications = accountIDs.length
    ? await payload.find({
        collection: 'publish-jobs',
        depth: 0,
        limit: 100,
        overrideAccess: req ? false : true,
        pagination: false,
        ...(req ? { req } : {}),
        select: {
          externalPublicationId: true,
          platformAccount: true,
          publishedAt: true,
          updatedAt: true,
        },
        sort: '-publishedAt',
        where: {
          and: [
            { platformAccount: { in: accountIDs } },
            { status: { equals: 'published' } },
            { externalPublicationId: { exists: true } },
          ],
        },
      })
    : { docs: [] }
  const publishingEvidence = new Map<number, { completedAt: string; reference: string }>()
  for (const publication of successfulPublications.docs) {
    const accountID =
      typeof publication.platformAccount === 'number'
        ? publication.platformAccount
        : publication.platformAccount && typeof publication.platformAccount === 'object'
          ? publication.platformAccount.id
          : null
    if (typeof accountID !== 'number' || publishingEvidence.has(accountID)) continue
    const externalID = publication.externalPublicationId
    if (typeof externalID !== 'string' || !externalID.trim()) continue
    publishingEvidence.set(accountID, {
      completedAt: publication.publishedAt ?? publication.updatedAt,
      reference: `publish-job:${publication.id}`,
    })
  }

  return {
    accounts: accounts.docs.map((account) =>
      toPlatformReadinessAccountSummary({
        account,
        controlledPublishingTest: publishingEvidence.get(account.id),
        environment,
      }),
    ),
  }
}

export type PlatformAccountsPageData = {
  accounts: PlatformReadinessAccountSummary[]
  state: PlatformReadinessPageState | 'read-failed'
}

export const loadPlatformAccountsPageData = async ({
  env,
  payload,
  req,
  role,
}: {
  env: PortalEnvironment
  payload: Payload
  req?: PayloadRequest
  role: PortalRole
}): Promise<PlatformAccountsPageData> => {
  if (env.ADMIN_PORTAL_ENABLED !== 'true') return { accounts: [], state: 'portal-disabled' }
  if (env.ADMIN_PORTAL_PLATFORMS_ENABLED !== 'true') {
    return { accounts: [], state: 'module-disabled' }
  }
  if (role !== 'admin') return { accounts: [], state: 'forbidden' }

  try {
    const summary = await listPlatformReadiness({ environment: env, payload, req })
    return { accounts: summary.accounts, state: 'available' }
  } catch (error) {
    throw new PlatformReadinessReadError(error)
  }
}

export const loadPlatformReadinessPageData = async ({
  env,
  payload,
  req,
  role,
}: {
  env: PortalEnvironment
  payload: Payload
  req?: PayloadRequest
  role: PortalRole
}): Promise<PlatformReadinessPageData> => {
  if (env.ADMIN_PORTAL_ENABLED !== 'true') return { state: 'portal-disabled', summary: null }
  if (env.ADMIN_PORTAL_PLATFORMS_ENABLED !== 'true') {
    return { state: 'module-disabled', summary: null }
  }
  if (role !== 'admin') return { state: 'forbidden', summary: null }

  try {
    return {
      state: 'available',
      summary: await listPlatformReadiness({ environment: env, payload, req }),
    }
  } catch (error) {
    throw new PlatformReadinessReadError(error)
  }
}
