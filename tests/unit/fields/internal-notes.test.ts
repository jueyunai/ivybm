import { describe, expect, it } from 'vitest'

import { internalNotesField } from '@/fields/internalNotes'

describe('internal notes field access', () => {
  const field = internalNotesField()
  const readAccess = field.access?.read

  if (typeof readAccess !== 'function') {
    throw new Error('internalNotes read access must be a function')
  }

  it('hides internal notes from anonymous and invalid-role requests', async () => {
    expect(await readAccess({ req: { user: null } } as never)).toBe(false)
    expect(await readAccess({ req: { user: { id: 1, role: 'viewer' } } } as never)).toBe(false)
  })

  it.each(['admin', 'operator', 'sales'] as const)(
    'allows authenticated %s users to read internal notes',
    async (role) => {
      expect(await readAccess({ req: { user: { id: 1, role } } } as never)).toBe(true)
    },
  )
})
