import { getPayload } from 'payload'

import { getRoleUser } from '@/access/roles'
import {
  findOrCreateFeishuAppRegistration,
  getFeishuAppRegistration,
  isFeishuQRRegistrationEnabled,
  launchFeishuAppRegistration,
  preflightFeishuQRRegistrationConfiguration,
} from '@/modules/feishu/appRegistration'
import { FeishuConfigurationError } from '@/modules/feishu/contracts'
import config from '@/payload.config'
import type { User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const noStore = { 'cache-control': 'no-store' }

const errorResponse = (status: number, code: string, message: string): Response =>
  Response.json({ error: { code, message } }, { headers: noStore, status })

const configuredPublicOrigin = (): string | undefined => {
  const value = process.env.NEXT_PUBLIC_SERVER_URL?.trim()
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    return url.origin
  } catch {
    return undefined
  }
}

const isSameOriginRequest = (request: Request): boolean => {
  const source = request.headers.get('origin') ?? request.headers.get('referer')
  const expectedOrigin = configuredPublicOrigin()
  if (!source || !expectedOrigin) return false
  try {
    return new URL(source).origin === expectedOrigin
  } catch {
    return false
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isFeishuQRRegistrationEnabled()) {
    return errorResponse(503, 'feishu-registration-disabled', 'Feishu QR registration is disabled')
  }
  try {
    const payload = await getPayload({ config })
    const authenticated = await payload.auth({ headers: request.headers })
    const actor = getRoleUser(authenticated.user)
    if (!authenticated.user || !actor || authenticated.user.collection !== 'users') {
      return errorResponse(401, 'authentication-required', 'Authentication required')
    }
    if (actor.role !== 'admin') return errorResponse(403, 'forbidden', 'Administrator required')
    if (!isSameOriginRequest(request)) {
      return errorResponse(403, 'invalid-origin', 'Same-origin request required')
    }
    try {
      preflightFeishuQRRegistrationConfiguration()
    } catch (error) {
      if (error instanceof FeishuConfigurationError) {
        return errorResponse(
          503,
          'feishu-registration-not-configured',
          'Feishu QR registration is not configured',
        )
      }
      throw error
    }
    const started = await findOrCreateFeishuAppRegistration({
      payload,
      user: authenticated.user as User,
    })
    if (
      started.registration.status === 'pending' ||
      started.registration.status === 'configuring' ||
      started.registration.status === 'failed'
    ) {
      launchFeishuAppRegistration({ payload, registrationId: started.registration.id })
    }
    const registration = await getFeishuAppRegistration({
      payload,
      registrationId: started.registration.id,
      user: authenticated.user as User,
    })
    return Response.json(
      { created: started.created, registration },
      { headers: noStore, status: started.created ? 202 : 200 },
    )
  } catch {
    return errorResponse(
      503,
      'feishu-registration-unavailable',
      'Unable to start Feishu connection',
    )
  }
}
