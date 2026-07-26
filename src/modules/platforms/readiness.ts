export const PLATFORM_ACCOUNT_KINDS = [
  'facebook-page',
  'instagram-professional',
  'tiktok-business',
  'linkedin-member',
  'linkedin-organization',
] as const

export type PlatformAccountKind = (typeof PLATFORM_ACCOUNT_KINDS)[number]

export const PLATFORM_AUTHORIZATION_STATES = [
  'not_started',
  'pending',
  'connected',
  'expired',
  'blocked',
  'disabled',
] as const

export type PlatformAuthorizationState = (typeof PLATFORM_AUTHORIZATION_STATES)[number]

export const PLATFORM_CAPABILITY_APPROVAL_STATES = [
  'not_started',
  'pending',
  'approved',
  'blocked',
] as const

export type PlatformCapabilityApprovalState = (typeof PLATFORM_CAPABILITY_APPROVAL_STATES)[number]

export type PlatformAccountFamily = 'linkedin' | 'meta' | 'tiktok'
export type PlatformAccountCapability = 'messaging-inbound' | 'publishing'

export type PlatformAccountDefinition = {
  capabilities: PlatformAccountCapability[]
  family: PlatformAccountFamily
}

const PLATFORM_ACCOUNT_DEFINITIONS: Record<PlatformAccountKind, PlatformAccountDefinition> = {
  'facebook-page': {
    capabilities: ['messaging-inbound', 'publishing'],
    family: 'meta',
  },
  'instagram-professional': {
    capabilities: ['messaging-inbound', 'publishing'],
    family: 'meta',
  },
  'linkedin-member': {
    capabilities: ['publishing'],
    family: 'linkedin',
  },
  'linkedin-organization': {
    capabilities: ['publishing'],
    family: 'linkedin',
  },
  'tiktok-business': {
    capabilities: ['messaging-inbound'],
    family: 'tiktok',
  },
}

export type PlatformReadinessRequirement =
  | 'access_token'
  | 'access_token_expired'
  | 'approval'
  | 'authorization'
  | 'credential_decryption'
  | 'external_account_id'
  | 'meta_account_allowlist'
  | 'meta_app_secret'
  | 'meta_verify_token'
  | 'official_tiktok_dm_schema'
  | 'publishing_job_adapter'
  | 'refresh_token'
  | 'refresh_token_decryption'
  | 'tiktok_dm_api_eligibility'

export type PlatformConnectionReadinessStatus = 'action-required' | 'ready-for-controlled-test'

export type PlatformCapabilityReadinessStatus =
  'action-required' | 'blocked' | 'ready-for-controlled-test'

export type PlatformCapabilityImplementation = 'blocked' | 'implemented'

export type PlatformCapabilityReasonCode =
  | 'official_tiktok_dm_schema_unavailable'
  | 'platform_capability_blocked'
  | 'publishing_job_adapter_pending'

export type PlatformAccountReadinessInput = {
  account: {
    accessTokenConfigured: boolean
    accessTokenExpiresAt?: string | null
    // The caller must prove that a configured encrypted credential can be
    // authenticated by the current process. This prevents a future endpoint
    // from treating a stored-token flag as equivalent to a usable token.
    accessTokenReadable: boolean
    accountKind: PlatformAccountKind
    authorizationState: PlatformAuthorizationState
    capabilityApprovals?: Partial<{
      messagingInbound: PlatformCapabilityApprovalState
      publishing: PlatformCapabilityApprovalState
    }>
    externalAccountId?: string | null
    refreshTokenConfigured: boolean
    refreshTokenReadable: boolean
  }
  environment?: Readonly<Record<string, string | undefined>>
  nowMilliseconds?: number
}

export type PlatformAccountReadiness = {
  capabilities: Array<{
    capability: PlatformAccountCapability
    implementation: PlatformCapabilityImplementation
    missing: PlatformReadinessRequirement[]
    productionRequirements: PlatformReadinessRequirement[]
    reasonCode?: PlatformCapabilityReasonCode
    status: PlatformCapabilityReadinessStatus
  }>
  connection: {
    missing: PlatformReadinessRequirement[]
    status: PlatformConnectionReadinessStatus
  }
  family: PlatformAccountFamily
}

const nonEmpty = (value: string | null | undefined): string | undefined => {
  const normalized = value?.trim()
  return normalized || undefined
}

const unique = <Value>(values: Value[]): Value[] => [...new Set(values)]

export const isPlatformAccountKind = (value: unknown): value is PlatformAccountKind =>
  typeof value === 'string' && PLATFORM_ACCOUNT_KINDS.some((kind) => kind === value)

export const isPlatformAuthorizationState = (value: unknown): value is PlatformAuthorizationState =>
  typeof value === 'string' && PLATFORM_AUTHORIZATION_STATES.some((state) => state === value)

export const isPlatformCapabilityApprovalState = (
  value: unknown,
): value is PlatformCapabilityApprovalState =>
  typeof value === 'string' && PLATFORM_CAPABILITY_APPROVAL_STATES.some((state) => state === value)

export const getPlatformAccountDefinition = (
  kind: PlatformAccountKind,
): PlatformAccountDefinition => PLATFORM_ACCOUNT_DEFINITIONS[kind]

export const platformFamilyForAccountKind = (kind: PlatformAccountKind): PlatformAccountFamily =>
  getPlatformAccountDefinition(kind).family

export const derivePlatformConnectionKey = (
  kind: PlatformAccountKind,
  externalAccountId: string | null | undefined,
): string | undefined => {
  const normalizedID = nonEmpty(externalAccountId)
  return normalizedID ? `${kind}:${normalizedID}` : undefined
}

const configuredMetaAllowlist = (
  environment: Readonly<Record<string, string | undefined>>,
): Set<string> =>
  new Set(
    (environment.META_WEBHOOK_ALLOWED_ACCOUNT_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )

const connectionMissing = (
  {
    accessTokenConfigured,
    accessTokenExpiresAt,
    accessTokenReadable,
    authorizationState,
    externalAccountId,
    refreshTokenConfigured,
    refreshTokenReadable,
  }: PlatformAccountReadinessInput['account'],
  nowMilliseconds: number,
): PlatformReadinessRequirement[] => {
  const missing: PlatformReadinessRequirement[] = []
  if (!nonEmpty(externalAccountId)) missing.push('external_account_id')
  if (authorizationState !== 'connected') missing.push('authorization')
  if (!accessTokenConfigured) missing.push('access_token')
  if (accessTokenConfigured && accessTokenReadable === false) {
    missing.push('credential_decryption')
  }
  const expiresAt = nonEmpty(accessTokenExpiresAt)
  const expiresAtMilliseconds = expiresAt ? Date.parse(expiresAt) : undefined
  const accessTokenExpired =
    expiresAtMilliseconds !== undefined &&
    (!Number.isFinite(expiresAtMilliseconds) || expiresAtMilliseconds <= nowMilliseconds)
  if (accessTokenExpired) missing.push('access_token_expired')
  if (accessTokenExpired && !refreshTokenConfigured) missing.push('refresh_token')
  if (refreshTokenConfigured && !refreshTokenReadable) {
    missing.push('refresh_token_decryption')
  }
  return missing
}

export const assessPlatformAccountReadiness = ({
  account,
  environment = {},
  nowMilliseconds = Date.now(),
}: PlatformAccountReadinessInput): PlatformAccountReadiness => {
  const definition = getPlatformAccountDefinition(account.accountKind)
  const connection = connectionMissing(account, nowMilliseconds)
  const externalAccountId = nonEmpty(account.externalAccountId)
  const metaAllowlist = configuredMetaAllowlist(environment)
  const metaEnvironmentMissing: PlatformReadinessRequirement[] = []
  if (!nonEmpty(environment.META_WEBHOOK_APP_SECRET)) metaEnvironmentMissing.push('meta_app_secret')
  if (!nonEmpty(environment.META_WEBHOOK_VERIFY_TOKEN))
    metaEnvironmentMissing.push('meta_verify_token')
  if (!externalAccountId || !metaAllowlist.has(externalAccountId)) {
    metaEnvironmentMissing.push('meta_account_allowlist')
  }

  const capabilities = definition.capabilities.map((capability) => {
    const approval =
      capability === 'messaging-inbound'
        ? account.capabilityApprovals?.messagingInbound
        : account.capabilityApprovals?.publishing

    if (account.accountKind === 'tiktok-business') {
      return {
        capability,
        implementation: 'blocked' as const,
        missing: unique([
          ...connection,
          'official_tiktok_dm_schema' as const,
          'tiktok_dm_api_eligibility' as const,
        ]),
        productionRequirements: [
          'official_tiktok_dm_schema',
          'tiktok_dm_api_eligibility',
        ] as PlatformReadinessRequirement[],
        reasonCode: 'official_tiktok_dm_schema_unavailable' as const,
        status: 'blocked' as const,
      }
    }

    if (capability === 'publishing') {
      return {
        capability,
        implementation: 'blocked' as const,
        missing: unique([...connection, 'publishing_job_adapter' as const]),
        productionRequirements:
          approval === 'approved' ? [] : (['approval'] as PlatformReadinessRequirement[]),
        reasonCode: 'publishing_job_adapter_pending' as const,
        status: 'blocked' as const,
      }
    }

    if (approval === 'blocked') {
      return {
        capability,
        implementation: 'implemented' as const,
        missing: unique([...connection, 'approval' as const]),
        productionRequirements: ['approval'] as PlatformReadinessRequirement[],
        reasonCode: 'platform_capability_blocked' as const,
        status: 'blocked' as const,
      }
    }

    const missing = unique([...connection, ...metaEnvironmentMissing])
    const status: PlatformCapabilityReadinessStatus =
      missing.length === 0 ? 'ready-for-controlled-test' : 'action-required'
    return {
      capability,
      implementation: 'implemented' as const,
      missing,
      productionRequirements:
        approval === 'approved' ? [] : (['approval'] as PlatformReadinessRequirement[]),
      status,
    }
  })

  return {
    capabilities,
    connection: {
      missing: connection,
      status: connection.length === 0 ? 'ready-for-controlled-test' : 'action-required',
    },
    family: definition.family,
  }
}
