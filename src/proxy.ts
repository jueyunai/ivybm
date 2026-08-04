import { NextRequest, NextResponse } from 'next/server'

import { PORTAL_REQUEST_PATH_HEADER } from './admin-portal/core/auth/portalRequestPath'

const ADMIN_LANGUAGE_COOKIE = 'payload-lng'
const ADMIN_LANGUAGE = 'zh'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/**
 * Payload otherwise chooses an initial interface language from Accept-Language.
 * Seed the company default only when the employee has not made a choice yet;
 * the Account settings language selector continues to own later preferences.
 */
export const proxy = (request: NextRequest): NextResponse => {
  const isAdminRequest = request.nextUrl.pathname.startsWith('/admin')
  const isPortalRequest = request.nextUrl.pathname.startsWith('/dashboard')

  if (!isPortalRequest && (!isAdminRequest || request.cookies.has(ADMIN_LANGUAGE_COOKIE))) {
    return NextResponse.next()
  }

  const headers = new Headers(request.headers)
  if (isPortalRequest) {
    headers.set(
      PORTAL_REQUEST_PATH_HEADER,
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    )
  }

  if (isAdminRequest && !request.cookies.has(ADMIN_LANGUAGE_COOKIE)) {
    const existingCookies = headers.get('cookie')
    headers.set(
      'cookie',
      existingCookies
        ? `${existingCookies}; ${ADMIN_LANGUAGE_COOKIE}=${ADMIN_LANGUAGE}`
        : `${ADMIN_LANGUAGE_COOKIE}=${ADMIN_LANGUAGE}`,
    )
  }

  const response = NextResponse.next({ request: { headers } })
  if (isAdminRequest && !request.cookies.has(ADMIN_LANGUAGE_COOKIE)) {
    response.cookies.set({
      maxAge: ONE_YEAR_SECONDS,
      name: ADMIN_LANGUAGE_COOKIE,
      path: '/',
      sameSite: 'lax',
      value: ADMIN_LANGUAGE,
    })
  }

  return response
}

export const config = {
  matcher: ['/admin/:path*', '/dashboard/:path*'],
}
