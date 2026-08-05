import { getPayload } from 'payload'

import { getRoleUser } from '@/access/roles'
import {
  findOrCreateFeishuAppRegistration,
  getFeishuAppRegistration,
  isFeishuQRRegistrationEnabled,
  launchFeishuAppRegistration,
} from '@/modules/feishu/appRegistration'
import config from '@/payload.config'
import type { User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const noStore = { 'cache-control': 'no-store' }

const errorResponse = (status: number, code: string, message: string): Response =>
  Response.json({ error: { code, message } }, { headers: noStore, status })

const isSameOriginRequest = (request: Request): boolean => {
  const source = request.headers.get('origin') ?? request.headers.get('referer')
  if (!source) return false
  try {
    return new URL(source).origin === new URL(request.url).origin
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
    if (!process.env.FEISHU_OAUTH_REDIRECT_URI?.trim()) {
      return errorResponse(
        503,
        'feishu-registration-not-configured',
        'Feishu redirect URI is not configured',
      )
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
