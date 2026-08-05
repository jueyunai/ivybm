import type { CollectionConfig } from 'payload'

import {
  contentAdmin,
  contentCreate,
  contentDelete,
  contentUpdate,
  publishedContentRead,
} from '../access/content'
import { internalNotesField } from '../fields/internalNotes'
import { imageMediaFilter } from '../fields/media'
import { preservePublicationHistory, publicationHistoryField } from '../fields/publicationHistory'
import { seoField } from '../fields/seo'
import { stableSlugField } from '../fields/slug'
import {
  revalidateContentAfterChange,
  revalidateContentAfterDelete,
} from '../hooks/revalidateContent'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'

export const Products: CollectionConfig = {
  slug: 'products',
  access: {
    admin: contentAdmin,
    create: contentCreate,
    delete: contentDelete,
    read: publishedContentRead,
    update: contentUpdate,
  },
  admin: {
    defaultColumns: ['title', 'category', 'slug', '_status', 'updatedAt'],
    group: 'Website Content',
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      localized: true,
      required: true,
    },
    stableSlugField(),
    publicationHistoryField,
    {
      name: 'shortDescription',
      type: 'textarea',
      localized: true,
    },
    {
      name: 'description',
      type: 'richText',
      localized: true,
    },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'product-categories',
      required: true,
    },
    {
      name: 'coverImage',
      type: 'upload',
      filterOptions: imageMediaFilter,
      relationTo: 'media',
      required: true,
    },
    {
      name: 'gallery',
      type: 'upload',
      admin: {
        description:
          'Optional product detail images. The cover image is shown first; add up to 12 additional views in display order.',
      },
      filterOptions: imageMediaFilter,
      hasMany: true,
      maxRows: 12,
      relationTo: 'media',
    },
    {
      name: 'specifications',
      type: 'array',
      fields: [
        {
          name: 'label',
          type: 'text',
          localized: true,
          required: true,
        },
        {
          name: 'value',
          type: 'text',
          localized: true,
          required: true,
        },
      ],
    },
    seoField(),
    internalNotesField(),
  ],
  hooks: {
    afterChange: [revalidateContentAfterChange, writeAuditLogAfterChange],
    afterDelete: [revalidateContentAfterDelete, writeAuditLogAfterDelete],
    beforeChange: [preservePublicationHistory],
  },
  versions: {
    drafts: true,
    maxPerDoc: 50,
  },
}
