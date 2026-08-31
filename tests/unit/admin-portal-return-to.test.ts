import { describe, expect, it } from 'vitest'

import { safePortalReturnTo } from '@/admin-portal/core/auth/safeReturnTo'

describe('safePortalReturnTo', () => {
  it('only accepts normalized paths inside /dashboard', () => {
    expect(safePortalReturnTo('/dashboard')).toBe('/dashboard')
    expect(safePortalReturnTo('/dashboard/content?locale=ar#seo')).toBe(
      '/dashboard/content?locale=ar#seo',
    )
    expect(safePortalReturnTo('/api/portal/leads/10/attachments/50')).toBe(
      '/api/portal/leads/10/attachments/50',
    )
    expect(safePortalReturnTo('/dashboard//content')).toBe('/dashboard')
  })

  it.each([
    undefined,
    '',
    '/',
    '/admin',
    '/en',
    'https://evil.example/dashboard',
    '//evil.example/dashboard',
    '/\\evil.example/dashboard',
    '/dashboard\\content',
    '/dashboard/%5c%5cevil.example',
    '/dashboard/%2f%2fevil.example',
    '/dashboard/%00content',
    '/dashboard/%0acontent',
    '/dashboard/../admin',
    '/api/portal/leads/10/attachments',
    '/api/portal/leads/10/attachments/50/extra',
    '/api/portal/leads/abc/attachments/50',
    '/api/portal/leads/10/attachments/0',
    'javascript:alert(1)',
  ])('rejects unsafe or non-Portal return target %s', (value) => {
    expect(safePortalReturnTo(value)).toBe('/dashboard')
  })
})
