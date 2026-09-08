import {
  isPlatformCapabilityApprovalState,
  type PlatformAuthorizationState,
  type PlatformCapabilityApprovalState,
} from '@/modules/platforms/readiness'
import type { PlatformAccount } from '@/payload-types'

export type PortalSupportedAccountKind =
  'facebook-page' | 'instagram-professional' | 'linkedin-member' | 'linkedin-organization'

export const PORTAL_SUPPORTED_ACCOUNT_KINDS: readonly PortalSupportedAccountKind[] = [
  'facebook-page',
  'instagram-professional',
  'linkedin-member',
  'linkedin-organization',
]

export const isPortalSupportedAccountKind = (value: unknown): value is PortalSupportedAccountKind =>
  typeof value === 'string' && PORTAL_SUPPORTED_ACCOUNT_KINDS.some((kind) => kind === value)

const META_EXTERNAL_ACCOUNT_ID_PATTERN = /^[1-9][0-9]{0,31}$/u
const LINKEDIN_MEMBER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u
const LINKEDIN_ORGANIZATION_ID_PATTERN = /^[0-9]{1,32}$/u

export const isValidPortalExternalAccountId = (
  accountKind: PortalSupportedAccountKind,
  externalAccountId: string,
): boolean => {
  if (accountKind === 'linkedin-member') {
    return LINKEDIN_MEMBER_ID_PATTERN.test(externalAccountId)
  }
  if (accountKind === 'linkedin-organization') {
    return LINKEDIN_ORGANIZATION_ID_PATTERN.test(externalAccountId)
  }
  return META_EXTERNAL_ACCOUNT_ID_PATTERN.test(externalAccountId)
}

export type RedactedPlatformAccountAuthorization = {
  accessTokenConfigured: boolean
  appId: string | null
  expiresAt: string | null
  refreshTokenConfigured: boolean
  scopes: Array<{ scope: string }>
  state: PlatformAuthorizationState
}

export type RedactedPlatformAccountCapabilities = {
  messagingInbound: string | null | undefined
  publishing: string | null | undefined
}

export type RedactedPlatformAccountSummary = {
  aiAutoReplyEnabled: boolean
  accountKind: PlatformAccount['accountKind']
  authorization: RedactedPlatformAccountAuthorization
  authorizationRevision: number
  capabilities: RedactedPlatformAccountCapabilities
  externalAccountId: string | null
  messagingExternalAccountId: string | null
  id: number
  name: string
  notes: string | null
  platformFamily: PlatformAccount['platformFamily']
}

export const toRedactedPlatformAccountSummary = (
  account: PlatformAccount,
): RedactedPlatformAccountSummary => {
  const authorization = account.authorization
  const capabilities = account.capabilities
  return {
    aiAutoReplyEnabled: account.aiAutoReplyEnabled === true,
    accountKind: account.accountKind,
    authorization: {
      accessTokenConfigured: authorization.accessTokenConfigured === true,
      appId: authorization.appId ?? null,
      expiresAt: authorization.expiresAt ?? null,
      refreshTokenConfigured: authorization.refreshTokenConfigured === true,
      scopes: Array.isArray(authorization.scopes)
        ? authorization.scopes
            .map((item) =>
              item && typeof item === 'object' && 'scope' in item && typeof item.scope === 'string'
                ? { scope: item.scope }
                : null,
            )
            .filter((item): item is { scope: string } => item !== null)
        : [],
      state: authorization.state,
    },
    authorizationRevision: account.authorizationRevision,
    capabilities: {
      messagingInbound: capabilities?.messagingInbound,
      publishing: capabilities?.publishing,
    },
    externalAccountId: account.externalAccountId ?? null,
    messagingExternalAccountId: account.messagingExternalAccountId ?? null,
    id: account.id,
    name: account.name,
    notes: account.notes ?? null,
    platformFamily: account.platformFamily,
  }
}

const nonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

export type CreatePlatformAccountInput = {
  accountKind: PortalSupportedAccountKind
  externalAccountId?: string | null
  name: string
  notes?: string | null
}

export const validateCreatePlatformAccountInput = (
  body: unknown,
):
  | { error: { code: string }; success: false }
  | { success: true; value: CreatePlatformAccountInput } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: { code: 'invalid_request' }, success: false }
  }
  const record = body as Record<string, unknown>
  const name = nonEmptyString(record.name)
  if (!name || name.length > 120) {
    return { error: { code: 'invalid_name' }, success: false }
  }
  const accountKind = record.accountKind
  if (!isPortalSupportedAccountKind(accountKind)) {
    return { error: { code: 'unsupported_account_kind' }, success: false }
  }
  const rawExternalAccountId = record.externalAccountId
  if (
    rawExternalAccountId !== undefined &&
    rawExternalAccountId !== null &&
    typeof rawExternalAccountId !== 'string'
  ) {
    return { error: { code: 'invalid_external_account_id' }, success: false }
  }
  const externalAccountId =
    rawExternalAccountId === undefined || rawExternalAccountId === null
      ? null
      : (nonEmptyString(rawExternalAccountId) ?? null)
  if (
    externalAccountId !== null &&
    !isValidPortalExternalAccountId(accountKind, externalAccountId)
  ) {
    return { error: { code: 'invalid_external_account_id' }, success: false }
  }
  const rawNotes = record.notes
  const notes =
    rawNotes === undefined || rawNotes === null ? null : (nonEmptyString(rawNotes) ?? null)
  if (notes !== null && notes.length > 2_000) {
    return { error: { code: 'invalid_notes' }, success: false }
  }
  return { success: true, value: { accountKind, externalAccountId, name, notes } }
}

export type UpdatePlatformAccountInput = {
  aiAutoReplyEnabled?: boolean
  authorizationRevision: number
  externalAccountId?: string | null
  messagingInbound?: PlatformCapabilityApprovalState
  name?: string
  notes?: string | null
  publishing?: PlatformCapabilityApprovalState
}

export const validateUpdatePlatformAccountInput = (
  body: unknown,
):
  | { error: { code: string }; success: false }
  | { success: true; value: UpdatePlatformAccountInput } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: { code: 'invalid_request' }, success: false }
  }
  const record = body as Record<string, unknown>
  const authorizationRevision = record.authorizationRevision
  if (
    typeof authorizationRevision !== 'number' ||
    !Number.isSafeInteger(authorizationRevision) ||
    authorizationRevision < 0
  ) {
    return { error: { code: 'invalid_authorization_revision' }, success: false }
  }
  const name = record.name === undefined ? undefined : nonEmptyString(record.name)
  if (record.name !== undefined && (!name || name.length > 120)) {
    return { error: { code: 'invalid_name' }, success: false }
  }
  const rawExternalAccountId = record.externalAccountId
  if (
    rawExternalAccountId !== undefined &&
    rawExternalAccountId !== null &&
    typeof rawExternalAccountId !== 'string'
  ) {
    return { error: { code: 'invalid_external_account_id' }, success: false }
  }
  const externalAccountId =
    rawExternalAccountId === undefined
      ? undefined
      : rawExternalAccountId === null
        ? null
        : (nonEmptyString(rawExternalAccountId) ?? null)
  if (
    externalAccountId !== null &&
    externalAccountId !== undefined &&
    externalAccountId.length > 240
  ) {
    return { error: { code: 'invalid_external_account_id' }, success: false }
  }
  const rawNotes = record.notes
  const notes =
    rawNotes === undefined
      ? undefined
      : rawNotes === null
        ? null
        : (nonEmptyString(rawNotes) ?? null)
  if (notes !== null && notes !== undefined && notes.length > 2_000) {
    return { error: { code: 'invalid_notes' }, success: false }
  }
  const rawMessagingInbound = record.messagingInbound
  const rawPublishing = record.publishing
  const rawAiAutoReplyEnabled = record.aiAutoReplyEnabled
  if (rawAiAutoReplyEnabled !== undefined && typeof rawAiAutoReplyEnabled !== 'boolean') {
    return { error: { code: 'invalid_ai_auto_reply_enabled' }, success: false }
  }
  const aiAutoReplyEnabled = rawAiAutoReplyEnabled as boolean | undefined
  const hasCapabilityUpdate = rawMessagingInbound !== undefined || rawPublishing !== undefined
  if (
    hasCapabilityUpdate &&
    (!isPlatformCapabilityApprovalState(rawMessagingInbound) ||
      !isPlatformCapabilityApprovalState(rawPublishing))
  ) {
    return { error: { code: 'invalid_capabilities' }, success: false }
  }
  const messagingInbound = hasCapabilityUpdate
    ? (rawMessagingInbound as PlatformCapabilityApprovalState)
    : undefined
  const publishing = hasCapabilityUpdate
    ? (rawPublishing as PlatformCapabilityApprovalState)
    : undefined
  if (
    name === undefined &&
    externalAccountId === undefined &&
    notes === undefined &&
    !hasCapabilityUpdate &&
    aiAutoReplyEnabled === undefined
  ) {
    return { error: { code: 'no_changes' }, success: false }
  }
  return {
    success: true,
    value: {
      authorizationRevision,
      aiAutoReplyEnabled,
      externalAccountId,
      messagingInbound,
      name,
      notes,
      publishing,
    },
  }
}

export type DeletePlatformAccountInput = {
  authorizationRevision: number
}

export type DisconnectPlatformAccountInput = DeletePlatformAccountInput & {
  accountId: number
}

export const validateDisconnectPlatformAccountInput = (
  body: unknown,
):
  | { error: { code: string }; success: false }
  | { success: true; value: DisconnectPlatformAccountInput } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: { code: 'invalid_request' }, success: false }
  }
  const record = body as Record<string, unknown>
  const accountId = record.accountId
  if (typeof accountId !== 'number' || !Number.isSafeInteger(accountId) || accountId <= 0) {
    return { error: { code: 'invalid_platform_account_id' }, success: false }
  }
  const revision = validateDeletePlatformAccountInput(body)
  if (!revision.success) return revision
  return {
    success: true,
    value: { accountId, authorizationRevision: revision.value.authorizationRevision },
  }
}

export const validateDeletePlatformAccountInput = (
  body: unknown,
):
  | { error: { code: string }; success: false }
  | { success: true; value: DeletePlatformAccountInput } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: { code: 'invalid_request' }, success: false }
  }
  const record = body as Record<string, unknown>
  const authorizationRevision = record.authorizationRevision
  if (
    typeof authorizationRevision !== 'number' ||
    !Number.isSafeInteger(authorizationRevision) ||
    authorizationRevision < 0
  ) {
    return { error: { code: 'invalid_authorization_revision' }, success: false }
  }
  return { success: true, value: { authorizationRevision } }
}
