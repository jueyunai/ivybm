export type KnowledgeIndexAction = 'processing' | 'reindex' | 'retry' | 'submit'

export type KnowledgeIndexActionReason =
  | 'admin_retry_required'
  | 'processing'
  | 'review_required'
  | 'save_changes'
  | 'save_document'

export type KnowledgeIndexActionState = {
  action: KnowledgeIndexAction
  enabled: boolean
  reason?: KnowledgeIndexActionReason
}

export const canOpenKnowledgeJob = (role: unknown): boolean => role === 'admin'

export const getKnowledgeIndexActionState = ({
  hasDocument,
  indexStatus,
  isModified = false,
  reviewStatus,
  role,
}: {
  hasDocument: boolean
  indexStatus: unknown
  isModified?: boolean
  reviewStatus: unknown
  role: unknown
}): KnowledgeIndexActionState => {
  const action: KnowledgeIndexAction =
    indexStatus === 'processing'
      ? 'processing'
      : indexStatus === 'ready'
        ? 'reindex'
        : indexStatus === 'failed'
          ? 'retry'
          : 'submit'

  if (!hasDocument) return { action, enabled: false, reason: 'save_document' }
  if (isModified) return { action, enabled: false, reason: 'save_changes' }
  if (reviewStatus !== 'reviewed') return { action, enabled: false, reason: 'review_required' }
  if (indexStatus === 'processing') return { action, enabled: false, reason: 'processing' }
  if (indexStatus === 'failed' && role !== 'admin') {
    return { action, enabled: false, reason: 'admin_retry_required' }
  }

  return { action, enabled: true }
}
