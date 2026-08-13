import type { ConfirmedPlatformPublishErrorCode } from '../publishing/contracts'

export class ProviderPublicationResultUnknownError extends Error {
  readonly code = 'delivery_unknown' as const
  readonly retryable = false as const

  constructor(message: string) {
    super(message)
    this.name = 'ProviderPublicationResultUnknownError'
  }
}

export class ProviderPublicationConfirmedError extends Error {
  constructor(
    readonly code: ConfirmedPlatformPublishErrorCode,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Provider rejected publication request: ${code}`)
    this.name = 'ProviderPublicationConfirmedError'
  }
}

/** A failure before provider I/O starts. The caller may retry the same command key. */
export class ProviderPublicationTransportError extends Error {
  readonly code = 'provider_unavailable' as const
  readonly retryable = true as const

  constructor() {
    super('Publication transport is unavailable before provider I/O')
    this.name = 'ProviderPublicationTransportError'
  }
}
