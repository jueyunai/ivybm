import { ValidationError, type PayloadRequest } from 'payload'

type PlatformAccountCredentialField = 'authorization.accessToken' | 'authorization.refreshToken'

export class PlatformAccountIdentityCredentialConflictError extends ValidationError {
  constructor({
    path,
    req,
  }: {
    path: PlatformAccountCredentialField
    req?: Partial<PayloadRequest>
  }) {
    super({
      collection: 'platform-accounts',
      errors: [
        {
          message:
            'Changing a provider account identity requires replacing or clearing every configured credential first',
          path,
        },
      ],
      req,
    })
    this.name = 'PlatformAccountIdentityCredentialConflictError'
  }
}
