import type { FieldAccess } from 'payload'

// AI credential ciphertext stays write-only except for this server-side
// readiness check. The caller only uses it to prove decryptability.
const readinessContextKey = 'portalAiReadinessCredentialRead'

export const portalAiReadinessCredentialReadContext = {
  [readinessContextKey]: true,
} as const

export const aiCredentialRead: FieldAccess = ({ req }): boolean =>
  req.context[readinessContextKey] === true
