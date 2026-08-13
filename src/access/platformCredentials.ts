import type { FieldAccess } from 'payload'

// Credential values are write-only everywhere except the server-side readiness
// assessment. That assessment receives the ciphertext only long enough to
// prove decryptability and returns a credential-free DTO.
const readinessContextKey = 'portalPlatformReadinessCredentialRead'
const runtimeContextKey = 'platformRuntimeCredentialRead'

export const platformReadinessCredentialReadContext = {
  [readinessContextKey]: true,
} as const

// Server-only providers use this context while resolving a credential for one
// already-authorized provider call. Never attach it to a client request.
export const platformRuntimeCredentialReadContext = {
  [runtimeContextKey]: true,
} as const

export const platformCredentialRead: FieldAccess = ({ req }): boolean =>
  req.context[readinessContextKey] === true || req.context[runtimeContextKey] === true
