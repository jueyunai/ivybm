import type { CollectionConfig } from 'payload'

import {
  leadSourcesAdmin,
  leadSourcesCreate,
  leadSourcesDelete,
  leadSourcesRead,
  leadSourcesUpdate,
} from '../access/leads'

export const LeadSources: CollectionConfig = {
  slug: 'lead-sources',
  access: {
    admin: leadSourcesAdmin,
    create: leadSourcesCreate,
    delete: leadSourcesDelete,
    read: leadSourcesRead,
    update: leadSourcesUpdate,
  },
  admin: {
    defaultColumns: ['name', 'key', 'channel', 'isActive', 'updatedAt'],
    group: 'Lead Management',
    useAsTitle: 'name',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'key',
      type: 'text',
      admin: {
        description: 'Stable integration key. Create a new source instead of renaming this value.',
      },
      index: true,
      required: true,
      unique: true,
      access: {
        update: () => false,
      },
    },
    {
      name: 'channel',
      type: 'select',
      defaultValue: 'website',
      options: [
        { label: 'Website Form', value: 'website' },
        { label: 'AI Chat', value: 'ai-chat' },
        { label: 'Social Platform', value: 'social' },
        { label: 'Manual Entry', value: 'manual' },
      ],
      required: true,
    },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      index: true,
      required: true,
    },
    {
      name: 'description',
      type: 'textarea',
    },
  ],
}
