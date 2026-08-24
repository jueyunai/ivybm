import { ValidationError, type CollectionBeforeValidateHook, type CollectionConfig } from 'payload'

import {
  adminFieldAccess,
  leadManagerFieldAccess,
  leadsAdmin,
  leadsCreate,
  leadsDelete,
  leadsRead,
  leadsUpdate,
} from '../access/leads'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'
import { enqueueFeishuLeadChange } from '../modules/feishu/jobs'

const immutableAfterCreate = () => false
const serverVerifiedIdentityAccess = {
  create: immutableAfterCreate,
  update: immutableAfterCreate,
}

const nonBlankString = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0

const validateLeadContact: CollectionBeforeValidateHook = ({ data, originalDoc }) => {
  if (!data) return data

  const lead = { ...(originalDoc ?? {}), ...data }
  const messagingIdentity = [
    lead.messagingPlatform,
    lead.messagingAccountExternalId,
    lead.messagingSenderExternalId,
    lead.messagingThreadExternalId,
  ]
  const hasAnyMessagingIdentity = messagingIdentity.some(
    (value) => value !== null && value !== undefined,
  )
  const hasCompleteMessagingIdentity = messagingIdentity.every(nonBlankString)

  if (hasAnyMessagingIdentity && !hasCompleteMessagingIdentity) {
    throw new ValidationError({
      collection: 'leads',
      errors: [
        {
          message:
            'Messaging contact identity must include non-empty platform, account, sender, and thread values',
          path: 'messagingPlatform',
        },
      ],
    })
  }

  if (!nonBlankString(lead.email) && !nonBlankString(lead.phone) && !hasCompleteMessagingIdentity) {
    throw new ValidationError({
      collection: 'leads',
      errors: [
        {
          message: 'Lead requires an email, phone, or complete server-verified messaging identity',
          path: 'email',
        },
      ],
    })
  }

  return data
}

export const Leads: CollectionConfig = {
  slug: 'leads',
  access: {
    admin: leadsAdmin,
    create: leadsCreate,
    delete: leadsDelete,
    read: leadsRead,
    update: leadsUpdate,
  },
  admin: {
    defaultColumns: [
      'name',
      'company',
      'country',
      'status',
      'intentLevel',
      'assignedTo',
      'createdAt',
    ],
    group: 'Lead Management',
    useAsTitle: 'name',
  },
  fields: [
    {
      name: 'requestId',
      type: 'text',
      index: true,
      required: true,
      unique: true,
      access: {
        update: immutableAfterCreate,
      },
    },
    {
      name: 'idempotencyKey',
      type: 'text',
      admin: {
        hidden: true,
      },
      index: true,
      required: true,
      unique: true,
      access: {
        read: adminFieldAccess,
        update: immutableAfterCreate,
      },
    },
    {
      name: 'source',
      type: 'relationship',
      index: true,
      relationTo: 'lead-sources',
      required: true,
      access: {
        update: leadManagerFieldAccess,
      },
    },
    {
      name: 'locale',
      type: 'select',
      options: [
        { label: 'English', value: 'en' },
        { label: 'العربية', value: 'ar' },
      ],
      required: true,
      access: {
        update: immutableAfterCreate,
      },
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'new',
      index: true,
      options: [
        { label: 'New', value: 'new' },
        { label: 'Contacted', value: 'contacted' },
        { label: 'Qualified', value: 'qualified' },
        { label: 'Disqualified', value: 'disqualified' },
      ],
      required: true,
    },
    {
      name: 'intentLevel',
      type: 'select',
      defaultValue: 'unscored',
      index: true,
      options: [
        { label: 'Unscored', value: 'unscored' },
        { label: 'A - High intent', value: 'a' },
        { label: 'B - Medium intent', value: 'b' },
        { label: 'C - Low intent', value: 'c' },
      ],
      required: true,
    },
    {
      name: 'assignedTo',
      type: 'relationship',
      index: true,
      relationTo: 'users',
      access: {
        create: leadManagerFieldAccess,
        update: leadManagerFieldAccess,
      },
    },
    {
      name: 'nextFollowUpAt',
      type: 'date',
      admin: {
        description: 'Next sales follow-up deadline. Due reminders are sent once per timestamp.',
      },
      index: true,
    },
    {
      name: 'name',
      type: 'text',
      index: true,
      maxLength: 120,
      required: true,
    },
    {
      name: 'company',
      type: 'text',
      maxLength: 160,
    },
    {
      name: 'country',
      type: 'text',
      index: true,
      maxLength: 120,
    },
    {
      name: 'email',
      type: 'email',
      index: true,
    },
    {
      name: 'phone',
      type: 'text',
      maxLength: 32,
    },
    {
      name: 'messagingPlatform',
      type: 'select',
      access: serverVerifiedIdentityAccess,
      admin: {
        description: 'Server-verified social messaging channel used to contact this Lead.',
        readOnly: true,
      },
      options: ['facebook-messenger', 'instagram', 'tiktok'],
    },
    {
      name: 'messagingAccountExternalId',
      type: 'text',
      access: serverVerifiedIdentityAccess,
      admin: {
        description: 'Provider account or Page identifier. This is not a credential.',
        readOnly: true,
      },
      maxLength: 200,
    },
    {
      name: 'messagingSenderExternalId',
      type: 'text',
      access: serverVerifiedIdentityAccess,
      admin: {
        description: 'Provider-scoped sender identifier. This is not a credential.',
        readOnly: true,
      },
      maxLength: 200,
    },
    {
      name: 'messagingThreadExternalId',
      type: 'text',
      access: serverVerifiedIdentityAccess,
      admin: {
        description: 'Stable provider thread identifier. This is not a credential.',
        readOnly: true,
      },
      maxLength: 400,
    },
    {
      name: 'interest',
      type: 'text',
      maxLength: 160,
    },
    { name: 'budget', type: 'text', maxLength: 240 },
    { name: 'procurementPlan', type: 'text', maxLength: 240 },
    { name: 'projectStage', type: 'text', maxLength: 40 },
    { name: 'quantitySquareMeters', type: 'number', min: 0 },
    { name: 'timeline', type: 'text', maxLength: 40 },
    { name: 'hasDrawings', type: 'checkbox' },
    {
      name: 'message',
      type: 'textarea',
      maxLength: 5_000,
      required: true,
    },
    {
      name: 'sourceURL',
      type: 'text',
      maxLength: 2_048,
      access: {
        update: immutableAfterCreate,
      },
    },
    {
      name: 'utm',
      type: 'group',
      access: {
        update: immutableAfterCreate,
      },
      fields: [
        { name: 'source', type: 'text', maxLength: 200 },
        { name: 'medium', type: 'text', maxLength: 200 },
        { name: 'campaign', type: 'text', maxLength: 200 },
        { name: 'term', type: 'text', maxLength: 200 },
        { name: 'content', type: 'text', maxLength: 200 },
      ],
    },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange, enqueueFeishuLeadChange],
    afterDelete: [writeAuditLogAfterDelete],
    beforeValidate: [validateLeadContact],
  },
}
