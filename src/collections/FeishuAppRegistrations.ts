import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  ValidationError,
  type CollectionBeforeChangeHook,
  type CollectionBeforeOperationHook,
  type CollectionConfig,
} from 'payload'

import { admins } from '../access/roles'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'
import {
  decryptFeishuCredential,
  readFeishuCredentialEncryptionKey,
} from '../modules/feishu/credentials'

const lockRegistrationBeforeUpdate: CollectionBeforeOperationHook = async ({
  args,
  operation,
  req,
}) => {
  if (operation !== 'update') return args
  const id = 'id' in args ? args.id : undefined
  if (id === undefined || id === null) {
    throw new ValidationError({
      collection: 'feishu-app-registrations',
      errors: [{ message: 'Feishu registrations do not support bulk updates', path: 'id' }],
      req,
    })
  }
  const transactionID = await req.transactionID
  const adapter = req.payload.db as unknown as PostgresAdapter
  const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
  if (!database) {
    throw new ValidationError({
      collection: 'feishu-app-registrations',
      errors: [{ message: 'Feishu registration updates require a transaction', path: 'id' }],
      req,
    })
  }
  await database.execute(sql`
    SELECT "id" FROM "feishu_app_registrations" WHERE "id" = ${id} FOR UPDATE
  `)
  return args
}

const validateRegistrationCredential: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  if (!data) return data
  const candidate = { ...originalDoc, ...data }
  const credentialRequired =
    candidate.status === 'configuring' || candidate.status === 'authorization_ready'

  if (candidate.status === 'completed' && candidate.appSecretEncrypted) {
    throw new ValidationError({
      collection: 'feishu-app-registrations',
      errors: [{ message: 'Completed registration cannot retain an App Secret', path: 'status' }],
      req,
    })
  }
  if (!credentialRequired) return data
  if (typeof candidate.appId !== 'string' || typeof candidate.appSecretEncrypted !== 'string') {
    throw new ValidationError({
      collection: 'feishu-app-registrations',
      errors: [{ message: 'Registered application credentials are required', path: 'status' }],
      req,
    })
  }
  try {
    decryptFeishuCredential(candidate.appSecretEncrypted, readFeishuCredentialEncryptionKey())
  } catch {
    throw new ValidationError({
      collection: 'feishu-app-registrations',
      errors: [{ message: 'Registered App Secret cannot be decrypted', path: 'status' }],
      req,
    })
  }
  return data
}

export const FeishuAppRegistrations: CollectionConfig = {
  disableBulkEdit: true,
  slug: 'feishu-app-registrations',
  access: {
    admin: admins,
    create: () => false,
    delete: () => false,
    read: () => false,
    update: () => false,
  },
  admin: { hidden: true },
  fields: [
    {
      name: 'status',
      type: 'select',
      defaultValue: 'pending',
      index: true,
      options: [
        'pending',
        'registering',
        'qr_ready',
        'configuring',
        'authorization_ready',
        'completed',
        'failed',
        'expired',
        'cancelled',
      ],
      required: true,
    },
    { name: 'requestedBy', type: 'relationship', index: true, relationTo: 'users' },
    { name: 'qrUrl', type: 'text', maxLength: 2_000 },
    { name: 'qrExpiresAt', type: 'date', index: true },
    { name: 'authorizeUrl', type: 'text', maxLength: 2_000 },
    { name: 'authorizeExpiresAt', type: 'date', index: true },
    { name: 'appId', type: 'text', index: true, maxLength: 160 },
    {
      name: 'appSecretEncrypted',
      type: 'text',
      access: { read: () => false },
      admin: { hidden: true },
    },
    { name: 'lastErrorCode', type: 'text', maxLength: 120 },
    { name: 'completedAt', type: 'date' },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
    beforeChange: [validateRegistrationCredential],
    beforeOperation: [lockRegistrationBeforeUpdate],
  },
}
