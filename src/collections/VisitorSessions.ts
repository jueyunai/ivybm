import type { CollectionConfig } from 'payload'

import {
  conversationInternalFieldRead,
  conversationInternalFieldWrite,
  conversationInternalWrite,
  visitorSessionsAdmin,
} from '../access/conversations'

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
    defaultColumns: ['publicId', 'channel', 'locale', 'lastSeenAt', 'expiresAt', 'createdAt'],
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
      access: {
        create: conversationInternalFieldWrite,
        read: conversationInternalFieldRead,
        update: conversationInternalFieldWrite,
      },
    },
    {
      name: 'idempotencyKey',
      type: 'text',
      admin: { hidden: true },
      index: true,
      required: true,
      unique: true,
      access: {
        create: conversationInternalFieldWrite,
        read: conversationInternalFieldRead,
        update: conversationInternalFieldWrite,
      },
    },
    {
      name: 'channel',
      type: 'select',
      index: true,
      options: ['website', 'whatsapp', 'facebook', 'instagram', 'tiktok'],
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
    { name: 'expiresAt', type: 'date', index: true, required: true },
    { name: 'lastSeenAt', type: 'date', index: true, required: true },
  ],
}
