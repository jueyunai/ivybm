import type { CollectionConfig } from 'payload'

import { conversationInternalWrite, visitorSessionsAdmin } from '../access/conversations'

export const VisitorSessions: CollectionConfig = {
  slug: 'visitor-sessions',
  access: {
    admin: visitorSessionsAdmin,
    create: conversationInternalWrite,
    delete: conversationInternalWrite,
    read: visitorSessionsAdmin,
    update: conversationInternalWrite,
  },
  admin: {
    defaultColumns: ['publicId', 'channel', 'locale', 'lastSeenAt', 'createdAt'],
    group: 'Conversations',
    useAsTitle: 'publicId',
  },
  fields: [
    { name: 'publicId', type: 'text', index: true, required: true, unique: true },
    {
      name: 'sessionTokenHash',
      type: 'text',
      admin: { hidden: true },
      index: true,
      required: true,
      unique: true,
    },
    {
      name: 'idempotencyKey',
      type: 'text',
      admin: { hidden: true },
      index: true,
      required: true,
      unique: true,
    },
    {
      name: 'channel',
      type: 'select',
      index: true,
      options: ['website', 'whatsapp', 'facebook', 'instagram'],
      required: true,
    },
    {
      name: 'locale',
      type: 'select',
      options: [
        { label: 'English', value: 'en' },
        { label: 'العربية', value: 'ar' },
      ],
      required: true,
    },
    { name: 'sourceURL', type: 'text', maxLength: 2_048 },
    { name: 'lastSeenAt', type: 'date', index: true, required: true },
  ],
}
