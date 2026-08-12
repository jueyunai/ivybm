import type {
  PlatformPublicationStatus,
  PlatformPublishAcceptance,
  PlatformPublishRequest,
  PublishingService,
} from '../publishing/contracts'

export const PLATFORM_PUBLISH_EXECUTION_STATUSES = [
  'scheduled',
  'accepted',
  'publishing',
  'published',
  'failed',
  'delivery_unknown',
] as const

export type PlatformPublishExecutionStatus =
  (typeof PLATFORM_PUBLISH_EXECUTION_STATUSES)[number]

export type PlatformPublishExecutionSnapshot = PlatformPublishRequest & {
  externalPublicationId?: string
  status: PlatformPublishExecutionStatus
}

export type PlatformPublishExecutionEvent =
  | 'accepted'
  | 'delivery-unknown'
  | 'failed'
  | 'status-updated'

export type PlatformPublishExecutionTransition = {
  changed: boolean
  event?: PlatformPublishExecutionEvent
  externalPublicationId?: string
  lastErrorCode?: string
  retryable?: boolean
  status: PlatformPublishExecutionStatus
  summary?: string
}

const terminalStatuses = new Set<PlatformPublishExecutionStatus>([
  'delivery_unknown',
  'failed',
  'published',
])

const externalId = (
  value: PlatformPublishAcceptance | PlatformPublicationStatus,
): string | undefined =>
  'externalPublicationId' in value && typeof value.externalPublicationId === 'string'
    ? value.externalPublicationId.trim() || undefined
    : undefined

const correlationMatches = (
  snapshot: PlatformPublishExecutionSnapshot,
  result: PlatformPublishAcceptance | PlatformPublicationStatus,
): boolean =>
  result.platform === snapshot.platform &&
  String(result.platformAccountId) === String(snapshot.platformAccountId) &&
  result.idempotencyKey === snapshot.idempotencyKey

const unknownTransition = (
  summary = 'Provider result correlation is unknown; automatic resend is disabled.',
): PlatformPublishExecutionTransition => ({
  changed: true,
  event: 'delivery-unknown',
  lastErrorCode: 'delivery_unknown',
  retryable: false,
  status: 'delivery_unknown',
  summary,
})

const fromPublishAcceptance = (
  result: PlatformPublishAcceptance,
): PlatformPublishExecutionTransition => {
  if (result.status === 'accepted') {
    return {
      changed: true,
      event: 'accepted',
      externalPublicationId: externalId(result)!,
      status: 'accepted',
      summary: 'Provider accepted the publication command.',
    }
  }
  if (result.status === 'delivery_unknown') {
    return {
      changed: true,
      event: 'delivery-unknown',
      ...(externalId(result) ? { externalPublicationId: externalId(result) } : {}),
      lastErrorCode: result.errorCode,
      retryable: false,
      status: 'delivery_unknown',
      summary: 'Provider outcome is unknown; automatic resend is disabled.',
    }
  }
  return {
    changed: true,
    event: 'failed',
    ...(externalId(result) ? { externalPublicationId: externalId(result) } : {}),
    lastErrorCode: result.errorCode,
    retryable: result.retryable,
    status: 'failed',
    summary:
      result.status === 'blocked'
        ? 'Provider rejected the publication command before acceptance.'
        : 'Provider reported publication failure.',
  }
}

const fromStatusLookup = (
  result: PlatformPublicationStatus,
): PlatformPublishExecutionTransition => {
  if (result.status === 'published') {
    return {
      changed: true,
      event: 'status-updated',
      externalPublicationId: externalId(result)!,
      status: 'published',
      summary: 'Provider confirmed publication.',
    }
  }
  if (result.status === 'pending' || result.status === 'publishing') {
    return {
      changed: true,
      event: 'status-updated',
      externalPublicationId: externalId(result)!,
      status: 'publishing',
      summary: 'Provider publication is still processing.',
    }
  }
  if (result.status === 'delivery_unknown') {
    return {
      changed: true,
      event: 'delivery-unknown',
      ...(externalId(result) ? { externalPublicationId: externalId(result) } : {}),
      lastErrorCode: result.errorCode,
      retryable: false,
      status: 'delivery_unknown',
      summary: 'Provider status is unknown; automatic resend is disabled.',
    }
  }
  if (result.status !== 'failed') {
    throw new Error('Platform publication status is unsupported')
  }
  return {
    changed: true,
    event: 'failed',
    ...(externalId(result) ? { externalPublicationId: externalId(result) } : {}),
    lastErrorCode: result.errorCode,
    retryable: result.retryable,
    status: 'failed',
    summary: 'Provider confirmed publication failure.',
  }
}

/**
 * Pure orchestration boundary for a future lease-fenced worker. It never writes
 * Payload data. Persisting the returned transition and audit event remains the
 * Task 12-owned repository responsibility.
 */
export const executePlatformPublication = async ({
  service,
  snapshot,
}: {
  service: PublishingService
  snapshot: PlatformPublishExecutionSnapshot
}): Promise<PlatformPublishExecutionTransition> => {
  if (terminalStatuses.has(snapshot.status)) {
    return { changed: false, status: snapshot.status }
  }

  if (snapshot.status === 'scheduled') {
    const result = await service.publish({
        assets: snapshot.assets,
        idempotencyKey: snapshot.idempotencyKey,
        platform: snapshot.platform,
        platformAccountId: snapshot.platformAccountId,
        scheduledFor: snapshot.scheduledFor,
        text: snapshot.text,
      })
    if (!correlationMatches(snapshot, result)) return unknownTransition()
    if (
      result.status === 'accepted' &&
      (typeof result.externalPublicationId !== 'string' || !result.externalPublicationId.trim())
    ) {
      return unknownTransition('Provider acceptance identifier is unknown; automatic resend is disabled.')
    }
    return fromPublishAcceptance(result)
  }

  const snapshotExternalId =
    typeof snapshot.externalPublicationId === 'string' && snapshot.externalPublicationId.trim()
      ? snapshot.externalPublicationId.trim()
      : undefined
  if (snapshot.externalPublicationId !== undefined && !snapshotExternalId) {
    return unknownTransition(
      'Persisted provider status identifier is invalid; automatic resend is disabled.',
    )
  }
  const result = await service.getStatus({
      ...(snapshotExternalId
        ? { externalPublicationId: snapshotExternalId }
        : {}),
      idempotencyKey: snapshot.idempotencyKey,
      platform: snapshot.platform,
      platformAccountId: snapshot.platformAccountId,
    })
  if (!correlationMatches(snapshot, result)) return unknownTransition()
  if (
    (result.status === 'pending' ||
      result.status === 'publishing' ||
      result.status === 'published') &&
    (typeof result.externalPublicationId !== 'string' || !result.externalPublicationId.trim())
  ) {
    return unknownTransition('Provider status identifier is unknown; automatic resend is disabled.')
  }
  if (
    snapshotExternalId &&
    externalId(result) &&
    externalId(result) !== snapshotExternalId
  ) {
    return unknownTransition('Provider status identifier changed; automatic resend is disabled.')
  }
  return fromStatusLookup(result)
}
