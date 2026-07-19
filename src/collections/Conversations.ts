import type { CollectionConfig } from 'payload'

import {
  conversationsAdmin,
  conversationsCreate,
  conversationsDelete,
  conversationsRead,
  conversationsUpdate,
} from '../access/conversations'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'

export const Conversations: CollectionConfig = {
  slug: 'conversations',
  access: {
    admin: conversationsAdmin,
    create: conversationsCreate,
    delete: conversationsDelete,
    read: conversationsRead,
    update: conversationsUpdate,
  },
  admin: {
    defaultColumns: ['publicId', 'channel', 'handoffStatus', 'intentLevel', 'assignedTo', 'lastMessageAt'],
    group: 'Conversations',
    useAsTitle: 'publicId',
  },
  fields: [
    { name: 'publicId', type: 'text', index: true, required: true, unique: true },
    { name: 'requestId', type: 'text', index: true, required: true, unique: true },
    {
      name: 'visitorSession',
      type: 'relationship',
      index: true,
      relationTo: 'visitor-sessions',
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
    { name: 'externalThreadId', type: 'text', index: true },
    {
      name: 'locale',
      type: 'select',
      options: [
        { label: 'English', value: 'en' },
        { label: 'العربية', value: 'ar' },
      ],
      required: true,
    },
    {
      name: 'handoffStatus',
      type: 'select',
      defaultValue: 'ai_active',
      index: true,
      options: ['ai_active', 'handoff_requested', 'human_active', 'resolved'],
      required: true,
    },
    { name: 'assignedTo', type: 'relationship', index: true, relationTo: 'users' },
    { name: 'lead', type: 'relationship', index: true, relationTo: 'leads' },
    {
      name: 'intentLevel',
      type: 'select',
      defaultValue: 'unscored',
      index: true,
      options: ['unscored', 'a', 'b', 'c'],
      required: true,
    },
    { name: 'intentScore', type: 'number', max: 100, min: 0 },
    { name: 'summary', type: 'textarea', maxLength: 10_000 },
    { name: 'lastMessageAt', type: 'date', index: true },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
  },
}
