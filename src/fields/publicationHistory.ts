import type { CollectionBeforeChangeHook, Field } from 'payload'

export const publicationHistoryField: Field = {
  name: 'hasBeenPublished',
  type: 'checkbox',
  admin: { hidden: true, readOnly: true },
  defaultValue: false,
  index: true,
}

export const preservePublicationHistory: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  const candidate = (data ?? {}) as Record<string, unknown>
  candidate.hasBeenPublished =
    originalDoc?.hasBeenPublished === true || candidate._status === 'published'
  return candidate
}
