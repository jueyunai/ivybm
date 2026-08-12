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
  | 'publishing_disabled'
  | 'publishing_runtime_configuration'
  | 'refresh_token'
  | 'refresh_token_decryption'
  | 'tiktok_dm_api_eligibility'

export type PlatformConnectionReadinessStatus = 'action-required' | 'ready-for-controlled-test'

export type PlatformCapabilityReadinessStatus =
  'action-required' | 'available' | 'blocked' | 'ready-for-controlled-test'

export type PlatformReadinessStatus =
  PlatformCapabilityReadinessStatus | PlatformConnectionReadinessStatus

export type PlatformControlledTestEvidence = {
  completedAt: string
  outcome: 'passed'
  reference: string
}

export type PlatformReadinessActionOwner =
  'account-owner' | 'administrator' | 'engineering' | 'platform'

export type PlatformReadinessActionCode =
  | 'configure-meta-webhook'
  | 'configure-publishing-runtime'
  | 'configure-credentials'
  | 'complete-authorization'
  | 'complete-tiktok-eligibility'
  | 'implement-publishing-adapter'
  | 'monitor-available-capability'
  | 'provide-external-account'
  | 'request-platform-approval'
  | 'run-controlled-test'
  | 'wait-for-official-schema'

export type PlatformReadinessAction = {
  code: PlatformReadinessActionCode
  owner: PlatformReadinessActionOwner
}

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
    controlledTestEvidence?: Partial<
      Record<PlatformAccountCapability, PlatformControlledTestEvidence>
    >
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

const hasPassedControlledTest = ({
  evidence,
  nowMilliseconds,
}: {
  evidence: PlatformControlledTestEvidence | undefined
  nowMilliseconds: number
}): boolean => {
  if (!evidence || evidence.outcome !== 'passed' || !nonEmpty(evidence.reference)) return false
  const completedAt = Date.parse(evidence.completedAt)
  return Number.isFinite(completedAt) && completedAt <= nowMilliseconds
}

export const getPlatformReadinessAction = ({
  missing,
  status,
}: {
  missing: readonly PlatformReadinessRequirement[]
  status: PlatformReadinessStatus
}): PlatformReadinessAction => {
  if (status === 'available') {
    return { code: 'monitor-available-capability', owner: 'administrator' }
  }

  if (missing.includes('official_tiktok_dm_schema')) {
    return { code: 'wait-for-official-schema', owner: 'platform' }
  }
  if (missing.includes('publishing_job_adapter')) {
    return { code: 'implement-publishing-adapter', owner: 'engineering' }
  }
  if (
    missing.includes('publishing_disabled') ||
    missing.includes('publishing_runtime_configuration')
  ) {
    return { code: 'configure-publishing-runtime', owner: 'engineering' }
  }
  if (
    missing.includes('meta_app_secret') ||
    missing.includes('meta_verify_token') ||
    missing.includes('meta_account_allowlist')
  ) {
    return { code: 'configure-meta-webhook', owner: 'engineering' }
  }
  if (missing.includes('external_account_id')) {
    return { code: 'provide-external-account', owner: 'account-owner' }
  }
  if (missing.includes('authorization')) {
    return { code: 'complete-authorization', owner: 'account-owner' }
  }
  if (
    missing.includes('access_token') ||
    missing.includes('access_token_expired') ||
    missing.includes('credential_decryption') ||
    missing.includes('refresh_token') ||
    missing.includes('refresh_token_decryption')
  ) {
    return { code: 'configure-credentials', owner: 'administrator' }
  }
  if (missing.includes('tiktok_dm_api_eligibility')) {
    return { code: 'complete-tiktok-eligibility', owner: 'account-owner' }
  }
  if (missing.includes('approval')) {
    return { code: 'request-platform-approval', owner: 'account-owner' }
  }

  return { code: 'run-controlled-test', owner: 'administrator' }
}

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

const publishingEnvironmentMissing = (
  environment: Readonly<Record<string, string | undefined>>,
): PlatformReadinessRequirement[] => {
  if (environment.ADMIN_PORTAL_PUBLISHING_ENABLED !== 'true') return ['publishing_disabled']
  const uploadOrigins = (environment.LINKEDIN_UPLOAD_ALLOWED_ORIGINS ?? '').split(',')
  const validUploadOrigins =
    uploadOrigins.length > 0 &&
    uploadOrigins.every((origin) => {
      if (!origin || origin !== origin.trim()) return false
      try {
        const parsed = new URL(origin)
        return (
          parsed.protocol === 'https:' &&
          !parsed.username &&
          !parsed.password &&
          parsed.pathname === '/' &&
          !parsed.search &&
          !parsed.hash &&
          parsed.origin === origin
        )
      } catch {
        return false
      }
    })
  if (
    !/^[a-fA-F0-9]{64}$/u.test(environment.PLATFORM_CREDENTIAL_ENCRYPTION_KEY ?? '') ||
    !/^20\d{2}(0[1-9]|1[0-2])$/u.test(environment.LINKEDIN_API_VERSION ?? '') ||
    !validUploadOrigins ||
    !/^[a-fA-F0-9]{64}$/u.test(environment.LINKEDIN_UPLOAD_TICKET_KEY ?? '')
  ) {
    return ['publishing_runtime_configuration']
  }
  return []
}

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
  const publishingEnvironment = publishingEnvironmentMissing(environment)
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
      const missing = unique([...connection, ...publishingEnvironment])
      const hasVerifiedCapability =
        missing.length === 0 &&
        approval === 'approved' &&
        hasPassedControlledTest({
          evidence: account.controlledTestEvidence?.publishing,
          nowMilliseconds,
        })
      return {
        capability,
        implementation: 'implemented' as const,
        missing,
        productionRequirements:
          approval === 'approved' ? [] : (['approval'] as PlatformReadinessRequirement[]),
        status: hasVerifiedCapability
          ? ('available' as const)
          : missing.length === 0
            ? ('ready-for-controlled-test' as const)
            : ('action-required' as const),
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
    const hasVerifiedCapability =
      missing.length === 0 &&
      approval === 'approved' &&
      hasPassedControlledTest({
        evidence: account.controlledTestEvidence?.[capability],
        nowMilliseconds,
      })
    const status: PlatformCapabilityReadinessStatus = hasVerifiedCapability
      ? 'available'
      : missing.length === 0
        ? 'ready-for-controlled-test'
        : 'action-required'
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
