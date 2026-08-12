import type { CollectionConfig } from 'payload'

import {
  conversationsAdmin,
  conversationsRead,
  conversationInternalFieldWrite,
  conversationInternalWrite,
} from '../access/conversations'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'

export const Conversations: CollectionConfig = {
  slug: 'conversations',
  access: {
    admin: conversationsAdmin,
    create: conversationInternalWrite,
    delete: conversationInternalWrite,
    read: conversationsRead,
    update: conversationInternalWrite,
  },
  admin: {
    defaultColumns: ['publicId', 'channel', 'handoffStatus', 'intentLevel', 'assignedTo', 'lastMessageAt'],
    group: 'Conversations',
    useAsTitle: 'publicId',
  },
  fields: [
    {
      name: 'publicId', type: 'text', index: true, required: true, unique: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'requestId', type: 'text', index: true, required: true, unique: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'visitorSession',
      type: 'relationship',
      index: true,
      relationTo: 'visitor-sessions',
      required: true,
      unique: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'channel',
      type: 'select',
      index: true,
      options: ['website', 'whatsapp', 'facebook', 'instagram', 'tiktok'],
      required: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'externalThreadId', type: 'text', index: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'locale',
      type: 'select',
      options: [
        { label: 'English', value: 'en' },
        { label: 'العربية', value: 'ar' },
      ],
      required: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'handoffStatus',
      type: 'select',
      defaultValue: 'ai_active',
      index: true,
      options: ['ai_active', 'handoff_requested', 'human_active', 'resolved'],
      required: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'revision',
      type: 'number',
      defaultValue: 1,
      min: 1,
      required: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'assignedTo', type: 'relationship', index: true, relationTo: 'users',
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'lead', type: 'relationship', index: true, relationTo: 'leads',
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'intentLevel',
      type: 'select',
      defaultValue: 'unscored',
      index: true,
      options: ['unscored', 'a', 'b', 'c'],
      required: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'intentScore', type: 'number', max: 100, min: 0,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'qualificationSignals',
      type: 'group',
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
      fields: [
        { name: 'budget', type: 'text', maxLength: 240 },
        { name: 'procurementPlan', type: 'text', maxLength: 240 },
        { name: 'projectStage', type: 'text', maxLength: 40 },
        { name: 'quantitySquareMeters', type: 'number', min: 0 },
        { name: 'timeline', type: 'text', maxLength: 40 },
        { name: 'hasDrawings', type: 'checkbox' },
      ],
    },
    {
      name: 'qualificationRoundCount', type: 'number', defaultValue: 0, max: 3, min: 0,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'qualificationAskedFields', type: 'select', hasMany: true,
      options: ['country', 'company', 'projectStage', 'quantity', 'drawings', 'budget', 'timeline', 'contact'],
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'qualificationAnsweredCompany', type: 'text', maxLength: 160,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'qualificationAwaitingFields', type: 'select', hasMany: true,
      options: ['country', 'company', 'projectStage', 'quantity', 'drawings', 'budget', 'timeline', 'contact'],
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'summary', type: 'textarea', maxLength: 10_000,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'lastMessageAt', type: 'date', index: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
  },
}
