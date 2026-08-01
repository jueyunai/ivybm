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
  | 'available'
  | 'forbidden'
  | 'module-disabled'
  | 'portal-disabled'

export interface PlatformReadinessAccountSummary {
  accountKind: PlatformAccount['accountKind']
  externalAccountId: string | null
  id: number
  name: string
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
  environment,
}: {
  account: PlatformAccount
  environment: Readonly<Record<string, string | undefined>>
}): PlatformReadinessAccountSummary => {
  const authorization = account.authorization
  const capabilities = account.capabilities
  const accessTokenConfigured = authorization.accessTokenConfigured === true

  return {
    accountKind: account.accountKind,
    externalAccountId: account.externalAccountId ?? null,
    id: account.id,
    name: account.name,
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

  return {
    accounts: accounts.docs.map((account) =>
      toPlatformReadinessAccountSummary({ account, environment }),
    ),
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
