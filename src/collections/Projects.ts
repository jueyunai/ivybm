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
import { seoField } from '../fields/seo'
import { stableSlugField } from '../fields/slug'
import {
  revalidateContentAfterChange,
  revalidateContentAfterDelete,
} from '../hooks/revalidateContent'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'

export const Projects: CollectionConfig = {
  slug: 'projects',
  access: {
    admin: contentAdmin,
    create: contentCreate,
    delete: contentDelete,
    read: publishedContentRead,
    update: contentUpdate,
  },
  admin: {
    defaultColumns: ['title', 'location', 'slug', '_status', 'updatedAt'],
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
    {
      name: 'summary',
      type: 'textarea',
      localized: true,
    },
    {
      name: 'description',
      type: 'richText',
      localized: true,
    },
    {
      name: 'location',
      type: 'text',
      localized: true,
    },
    {
      name: 'application',
      type: 'text',
      localized: true,
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
      filterOptions: imageMediaFilter,
      hasMany: true,
      relationTo: 'media',
    },
    seoField(),
    internalNotesField(),
  ],
  hooks: {
    afterChange: [revalidateContentAfterChange, writeAuditLogAfterChange],
    afterDelete: [revalidateContentAfterDelete, writeAuditLogAfterDelete],
  },
  versions: {
    drafts: true,
    maxPerDoc: 50,
  },
}
