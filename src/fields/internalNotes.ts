import type { TextareaField } from 'payload'

import { getRoleUser } from '../access/roles'

export const internalNotesField = (): TextareaField => ({
  name: 'internalNotes',
  type: 'textarea',
  access: {
    read: ({ req }) => Boolean(getRoleUser(req.user)),
  },
  admin: {
    description: 'Internal notes only. Not rendered on the public website.',
  },
})
