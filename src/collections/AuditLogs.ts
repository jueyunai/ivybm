import type { Access, CollectionConfig } from 'payload'

import { admins } from '../access/roles'

const denyAll: Access = () => false

export const AuditLogs: CollectionConfig = {
  slug: 'audit-logs',
  access: {
    admin: admins,
    create: denyAll,
    delete: denyAll,
    read: admins,
    update: denyAll,
  },
  admin: {
    defaultColumns: ['action', 'resource', 'documentId', 'actor', 'createdAt'],
    useAsTitle: 'action',
  },
  fields: [
    {
      name: 'action',
      type: 'select',
      options: ['create', 'update', 'delete', 'login'],
      required: true,
    },
    {
      name: 'resource',
      type: 'text',
      index: true,
      required: true,
    },
    {
      name: 'documentId',
      type: 'text',
      index: true,
      required: true,
    },
    {
      name: 'actor',
      type: 'relationship',
      relationTo: 'users',
    },
  ],
}
