import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { config, proxy } from '@/proxy'

describe('Admin language proxy', () => {
  it('seeds Simplified Chinese for the first Admin visit', () => {
    const response = proxy(new NextRequest('https://ivybm.com/admin'))

    expect(response.cookies.get('payload-lng')?.value).toBe('zh')
    expect(config.matcher).toEqual(['/admin/:path*', '/dashboard/:path*'])
  })

  it('does not overwrite an employee language preference', () => {
    const response = proxy(
      new NextRequest('https://ivybm.com/admin', {
        headers: { cookie: 'payload-lng=en' },
      }),
    )

    expect(response.cookies.get('payload-lng')).toBeUndefined()
  })

  it('passes the exact Portal path to the protected layout without trusting caller headers', () => {
    const response = proxy(
      new NextRequest('https://ivybm.com/dashboard/media?type=pdf', {
        headers: { 'x-ivybm-portal-path': '/dashboard/attacker' },
      }),
    )

    expect(response.headers.get('x-middleware-request-x-ivybm-portal-path')).toBe(
      '/dashboard/media?type=pdf',
    )
    expect(response.cookies.get('payload-lng')).toBeUndefined()
  })
})
