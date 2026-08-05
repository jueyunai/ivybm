import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  ValidationError,
  type CollectionBeforeChangeHook,
  type CollectionBeforeOperationHook,
  type CollectionConfig,
} from 'payload'

import { admins } from '../access/roles'

const lockStateBeforeUpdate: CollectionBeforeOperationHook = async ({ args, operation, req }) => {
  if (operation !== 'update') return args
  const id = 'id' in args ? args.id : undefined
  if (id === undefined || id === null) {
    throw new ValidationError({
      collection: 'feishu-oauth-states',
      errors: [{ message: 'OAuth states do not support bulk updates', path: 'id' }],
      req,
    })
  }
  const transactionID = await req.transactionID
  const adapter = req.payload.db as unknown as PostgresAdapter
  const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
  if (!database) {
    throw new ValidationError({
      collection: 'feishu-oauth-states',
      errors: [{ message: 'OAuth state consumption requires a database transaction', path: 'id' }],
      req,
    })
  }
  await database.execute(sql`
    SELECT "id" FROM "feishu_oauth_states" WHERE "id" = ${id} FOR UPDATE
  `)
  return args
}

const consumeStateOnce: CollectionBeforeChangeHook = ({ data, operation, originalDoc, req }) => {
  if (operation === 'update' && data?.usedAt && originalDoc?.usedAt) {
    throw new ValidationError({
      collection: 'feishu-oauth-states',
      errors: [{ message: 'OAuth state has already been consumed', path: 'usedAt' }],
      req,
    })
  }
  return data
}

export const FeishuOAuthStates: CollectionConfig = {
  disableBulkEdit: true,
  slug: 'feishu-oauth-states',
  access: {
    admin: admins,
    create: () => false,
    delete: () => false,
    read: () => false,
    update: () => false,
  },
  admin: { hidden: true },
  fields: [
    { name: 'stateHash', type: 'text', index: true, required: true, unique: true },
    { name: 'verifierEncrypted', type: 'text', access: { read: () => false }, required: true },
    { name: 'expiresAt', type: 'date', index: true, required: true },
    { name: 'usedAt', type: 'date', index: true },
    { name: 'requestedBy', type: 'relationship', relationTo: 'users', required: true },
    { name: 'registration', type: 'relationship', relationTo: 'feishu-app-registrations' },
  ],
  hooks: {
    beforeChange: [consumeStateOnce],
    beforeOperation: [lockStateBeforeUpdate],
  },
}
