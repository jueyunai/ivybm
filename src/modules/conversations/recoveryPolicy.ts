const WEBSITE_SILENT_RECOVERY_HANDOFF_REASONS = new Set([
  'ai_service_unavailable',
  'high_risk_topic',
  'reviewed_knowledge_unavailable',
])

export const isWebsiteSilentRecoveryHandoff = (
  channel: unknown,
  reason: unknown,
): boolean =>
  channel === 'website' &&
  typeof reason === 'string' &&
  WEBSITE_SILENT_RECOVERY_HANDOFF_REASONS.has(reason.trim())
