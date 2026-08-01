import type { FieldAccess } from 'payload'

// Credential values are write-only everywhere except the server-side readiness
// assessment. That assessment receives the ciphertext only long enough to
// prove decryptability and returns a credential-free DTO.
const readinessContextKey = 'portalPlatformReadinessCredentialRead'

export const platformReadinessCredentialReadContext = {
  [readinessContextKey]: true,
} as const

export const platformCredentialRead: FieldAccess = ({ req }): boolean =>
  req.context[readinessContextKey] === true
