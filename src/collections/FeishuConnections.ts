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

const lockConnectionBeforeUpdate: CollectionBeforeOperationHook = async ({
  args,
  operation,
  req,
}) => {
  if (operation !== 'update') return args
  const id = 'id' in args ? args.id : undefined
  if (id === undefined || id === null) {
    throw new ValidationError({
      collection: 'feishu-connections',
      errors: [{ message: 'Feishu connections do not support bulk updates', path: 'id' }],
      req,
    })
  }
  const transactionID = await req.transactionID
  const adapter = req.payload.db as unknown as PostgresAdapter
  const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
  if (!database) {
    throw new ValidationError({
      collection: 'feishu-connections',
      errors: [{ message: 'Feishu connection updates require a database transaction', path: 'id' }],
      req,
    })
  }
  await database.execute(sql`
    SELECT "id" FROM "feishu_connections" WHERE "id" = ${id} FOR UPDATE
  `)
  return args
}

const validateConnectedCredentials: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  if (!data) return data
  const candidate = { ...originalDoc, ...data }
  if (candidate.status !== 'connected' && candidate.status !== 'provisioning') return data

  const accessToken = candidate.accessTokenEncrypted
  const refreshToken = candidate.refreshTokenEncrypted
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    throw new ValidationError({
      collection: 'feishu-connections',
      errors: [{ message: 'OAuth credentials are required', path: 'status' }],
      req,
    })
  }
  try {
    const key = readFeishuCredentialEncryptionKey()
    decryptFeishuCredential(accessToken, key)
    decryptFeishuCredential(refreshToken, key)
  } catch {
    throw new ValidationError({
      collection: 'feishu-connections',
      errors: [{ message: 'OAuth credentials cannot be decrypted', path: 'status' }],
      req,
    })
  }
  return data
}

export const FeishuConnections: CollectionConfig = {
  disableBulkEdit: true,
  slug: 'feishu-connections',
  access: {
    admin: admins,
    create: () => false,
    delete: admins,
    read: admins,
    update: () => false,
  },
  admin: {
    defaultColumns: ['name', 'tenantKey', 'status', 'baseURL', 'updatedAt'],
    group: 'Lead Management',
    useAsTitle: 'name',
  },
  fields: [
    { name: 'name', type: 'text', maxLength: 160, required: true },
    {
      name: 'authMode',
      type: 'select',
      defaultValue: 'store_oauth',
      options: ['store_oauth'],
      required: true,
    },
    { name: 'tenantKey', type: 'text', index: true, maxLength: 160, required: true, unique: true },
    { name: 'installerOpenId', type: 'text', maxLength: 200, required: true },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'provisioning',
      index: true,
      options: ['provisioning', 'connected', 'reconnect_required', 'disconnected', 'error'],
      required: true,
    },
    { name: 'scopes', type: 'array', fields: [{ name: 'scope', type: 'text', required: true }] },
    {
      name: 'accessTokenEncrypted',
      type: 'text',
      access: { read: () => false },
      admin: { hidden: true },
    },
    {
      name: 'refreshTokenEncrypted',
      type: 'text',
      access: { read: () => false },
      admin: { hidden: true },
    },
    { name: 'accessTokenExpiresAt', type: 'date' },
    { name: 'refreshTokenExpiresAt', type: 'date' },
    { name: 'appToken', type: 'text', maxLength: 200 },
    { name: 'tableId', type: 'text', maxLength: 200 },
    { name: 'baseURL', type: 'text', maxLength: 600 },
    { name: 'lastConnectedAt', type: 'date' },
    { name: 'lastRefreshedAt', type: 'date' },
    { name: 'lastErrorCode', type: 'text', maxLength: 120 },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
    beforeChange: [validateConnectedCredentials],
    beforeOperation: [lockConnectionBeforeUpdate],
  },
}
