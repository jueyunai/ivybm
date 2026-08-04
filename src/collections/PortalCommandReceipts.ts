import type { CollectionConfig } from 'payload'

const internalOnly = () => false

export const PortalCommandReceipts: CollectionConfig = {
  slug: 'portal-command-receipts',
  access: {
    admin: internalOnly,
    create: internalOnly,
    delete: internalOnly,
    read: internalOnly,
    update: internalOnly,
  },
  admin: { hidden: true },
  fields: [
    { name: 'scope', type: 'text', index: true, required: true },
    { name: 'idempotencyKey', type: 'text', required: true },
    { name: 'fingerprint', type: 'text', required: true },
    { name: 'actor', type: 'relationship', index: true, relationTo: 'users', required: true },
    { name: 'ownerToken', type: 'text', required: true },
    { name: 'leaseExpiresAt', type: 'date', index: true, required: true },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'processing',
      index: true,
      options: ['processing', 'completed', 'failed'],
      required: true,
    },
    { name: 'result', type: 'json' },
    { name: 'errorCode', type: 'text' },
  ],
  indexes: [
    {
      fields: ['actor', 'scope', 'idempotencyKey'],
      unique: true,
    },
  ],
}
