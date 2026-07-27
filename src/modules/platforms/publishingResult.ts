export class ProviderPublicationResultUnknownError extends Error {
  readonly code = 'delivery_unknown' as const

  constructor(message: string) {
    super(message)
    this.name = 'ProviderPublicationResultUnknownError'
  }
}
