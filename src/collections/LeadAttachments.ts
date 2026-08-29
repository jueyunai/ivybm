import path from 'node:path'

import { ValidationError, type CollectionBeforeOperationHook, type CollectionConfig } from 'payload'

import { adminFieldAccess, leadManagerFieldAccess } from '@/access/leads'
import { enqueueFeishuLeadAttachmentChange } from '@/modules/feishu/jobs'
import {
  LEAD_ATTACHMENT_MAX_BYTES,
  LEAD_ATTACHMENT_MIME_TYPES,
  attachmentBytesMatch,
  attachmentExtension,
  attachmentMimeMatchesExtension,
  isAllowedAttachmentName,
} from '@/modules/lead-attachments/files'

const privateRead = leadManagerFieldAccess
const internalWrite = () => false

const validateAttachmentUpload: CollectionBeforeOperationHook = ({ operation, req }) => {
  if ((operation !== 'create' && operation !== 'update') || !req.file) return
  const { data, mimetype, name, size } = req.file
  const extension = attachmentExtension(name)
  const isKnownMime = LEAD_ATTACHMENT_MIME_TYPES.includes(
    mimetype as (typeof LEAD_ATTACHMENT_MIME_TYPES)[number],
  )
  const validMime = attachmentMimeMatchesExtension(mimetype, extension)
  const validBytes = attachmentBytesMatch(data, extension)

  if (!isAllowedAttachmentName(name) || !isKnownMime || !validMime || !validBytes) {
    throw new ValidationError({
      collection: 'lead-attachments',
      errors: [{ message: 'The attachment type or file bytes are invalid.', path: 'file' }],
      req,
    })
  }
  if (!Number.isSafeInteger(size) || size <= 0 || size > LEAD_ATTACHMENT_MAX_BYTES) {
    throw new ValidationError({
      collection: 'lead-attachments',
      errors: [{ message: 'Each attachment must be 50 MB or smaller.', path: 'file' }],
      req,
    })
  }
}

export const LeadAttachments: CollectionConfig = {
  slug: 'lead-attachments',
  access: {
    admin: privateRead,
    create: internalWrite,
    delete: internalWrite,
    read: privateRead,
    update: internalWrite,
  },
  admin: {
    defaultColumns: ['filename', 'lead', 'status', 'byteSize', 'expiresAt', 'createdAt'],
    group: 'Lead Management',
    useAsTitle: 'filename',
  },
  fields: [
    {
      name: 'lead',
      type: 'relationship',
      index: true,
      relationTo: 'leads',
    },
    {
      name: 'ticketHash',
      type: 'text',
      admin: { hidden: true },
      index: true,
      required: true,
      access: { read: adminFieldAccess, update: () => false },
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'pending',
      index: true,
      options: [
        { label: 'Pending association', value: 'pending' },
        { label: 'Associated', value: 'associated' },
        { label: 'Missing', value: 'missing' },
        { label: 'Expired', value: 'expired' },
      ],
      required: true,
    },
    { name: 'byteSize', type: 'number', required: true, min: 1 },
    { name: 'mimeType', type: 'text', required: true },
    { name: 'expiresAt', type: 'date', index: true, required: true },
    { name: 'associatedAt', type: 'date', index: true },
  ],
  upload: {
    staticDir: path.resolve(process.cwd(), 'private/lead-attachments'),
    mimeTypes: [...LEAD_ATTACHMENT_MIME_TYPES],
  },
  hooks: {
    afterChange: [enqueueFeishuLeadAttachmentChange],
    beforeOperation: [validateAttachmentUpload],
  },
}
