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

export const Pages: CollectionConfig = {
  slug: 'pages',
  access: {
    admin: contentAdmin,
    create: contentCreate,
    delete: contentDelete,
    read: publishedContentRead,
    update: contentUpdate,
  },
  admin: {
    defaultColumns: ['title', 'slug', '_status', 'updatedAt'],
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
      name: 'summary',
      type: 'textarea',
      localized: true,
    },
    {
      name: 'body',
      type: 'richText',
      localized: true,
    },
    {
      name: 'heroImage',
      type: 'upload',
      filterOptions: imageMediaFilter,
      relationTo: 'media',
    },
    {
      name: 'capabilities',
      type: 'group',
      admin: {
        description:
          'Structured engineering & manufacturing capability blocks for capabilities/landing pages',
      },
      fields: [
        {
          name: 'items',
          type: 'array',
          fields: [
            { name: 'title', type: 'text', localized: true },
            { name: 'description', type: 'textarea', localized: true },
            { name: 'badge', type: 'text', localized: true },
            { name: 'metrics', type: 'text', localized: true },
            { name: 'image', type: 'upload', filterOptions: imageMediaFilter, relationTo: 'media' },
          ],
        },
        {
          name: 'workflow',
          type: 'array',
          fields: [
            { name: 'stepNumber', type: 'number' },
            { name: 'title', type: 'text', localized: true },
            { name: 'description', type: 'textarea', localized: true },
          ],
        },
      ],
    },
    {
      name: 'professionalSection',
      type: 'group',
      admin: {
        description:
          'Structured role-specific content blocks and resource matrix for For Professionals page',
      },
      fields: [
        {
          name: 'roleCards',
          type: 'array',
          fields: [
            {
              name: 'roleKey',
              type: 'select',
              options: [
                { label: 'Architects & Designers', value: 'architects' },
                { label: 'Façade Contractors', value: 'facade-contractors' },
                { label: 'Main Contractors & Procurement', value: 'main-contractors' },
              ],
            },
            { name: 'title', type: 'text', localized: true },
            { name: 'description', type: 'textarea', localized: true },
            { name: 'deliverables', type: 'textarea', localized: true },
          ],
        },
        {
          name: 'resourceMatrix',
          type: 'array',
          fields: [
            { name: 'title', type: 'text', localized: true },
            { name: 'category', type: 'text', localized: true },
            { name: 'description', type: 'textarea', localized: true },
            { name: 'file', type: 'upload', relationTo: 'media' },
          ],
        },
        {
          name: 'faq',
          type: 'array',
          fields: [
            { name: 'question', type: 'text', localized: true },
            { name: 'answer', type: 'textarea', localized: true },
          ],
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
