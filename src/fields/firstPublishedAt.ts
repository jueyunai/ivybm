import type { CollectionBeforeChangeHook, Field } from 'payload'

export const firstPublishedAtField: Field = {
  name: 'publishedAt',
  type: 'date',
  admin: {
    description: 'Recorded on first publication; later edits and republication preserve this date.',
    readOnly: true,
  },
  index: true,
}

export const preserveFirstPublishedAt: CollectionBeforeChangeHook = ({
  context,
  data,
  originalDoc,
}) => {
  const candidate = (data ?? {}) as Record<string, unknown>
  if (originalDoc?.publishedAt) {
    candidate.publishedAt = originalDoc.publishedAt
    return candidate
  }

  const status = candidate._status ?? originalDoc?._status
  if (status !== 'published') {
    candidate.publishedAt = null
    return candidate
  }

  const importedDate = candidate.publishedAt
  candidate.publishedAt =
    context?.importPublicationDate === true &&
    typeof importedDate === 'string' &&
    Number.isFinite(Date.parse(importedDate))
      ? new Date(importedDate).toISOString()
      : new Date().toISOString()
  return candidate
}
