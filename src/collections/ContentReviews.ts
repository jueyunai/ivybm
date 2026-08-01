import type { CollectionConfig } from 'payload'

import { contentStudioAdmin, contentStudioCommandWrite, contentStudioRead } from '../access/contentStudio'
import { writeAuditLogAfterChange } from '../hooks/writeAuditLog'

export const CONTENT_REVIEW_DECISIONS = ['approved', 'revision-requested'] as const

export const ContentReviews: CollectionConfig = {
  slug: 'content-reviews',
  access: {
    admin: contentStudioAdmin,
    create: contentStudioCommandWrite,
    delete: contentStudioCommandWrite,
    read: contentStudioRead,
    update: () => false,
  },
  admin: {
    defaultColumns: ['content', 'decision', 'reviewedBy', 'createdAt'],
    group: 'Content Studio',
  },
  fields: [
    { name: 'content', type: 'relationship', index: true, relationTo: 'generated-contents', required: true },
    {
      name: 'decision',
      type: 'select',
      options: [...CONTENT_REVIEW_DECISIONS],
      required: true,
    },
    {
      name: 'checklist',
      type: 'group',
      fields: [
        { name: 'factsTraceable', type: 'checkbox', required: true },
        { name: 'technicalClaimsChecked', type: 'checkbox', required: true },
        { name: 'noCommercialCommitment', type: 'checkbox', required: true },
        { name: 'platformFormatChecked', type: 'checkbox', required: true },
        { name: 'arabicProofread', type: 'checkbox', required: true },
      ],
    },
    { name: 'comments', type: 'textarea', maxLength: 5_000 },
    { name: 'reviewedBy', type: 'relationship', relationTo: 'users', required: true },
  ],
  hooks: { afterChange: [writeAuditLogAfterChange] },
}
