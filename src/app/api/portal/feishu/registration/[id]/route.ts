import { getPayload } from 'payload'

import { getRoleUser } from '@/access/roles'
import {
  getFeishuAppRegistration,
  isFeishuQRRegistrationEnabled,
} from '@/modules/feishu/appRegistration'
import config from '@/payload.config'
import type { User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const noStore = { 'cache-control': 'no-store' }

const errorResponse = (status: number, code: string, message: string): Response =>
  Response.json({ error: { code, message } }, { headers: noStore, status })

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
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
    const id = Number.parseInt((await params).id, 10)
    if (!Number.isSafeInteger(id) || id <= 0) {
      return errorResponse(400, 'invalid-registration-id', 'A valid registration id is required')
    }
    const registration = await getFeishuAppRegistration({
      payload,
      registrationId: id,
      user: authenticated.user as User,
    })
    if (!registration) {
      return errorResponse(404, 'registration-not-found', 'Feishu registration was not found')
    }
    return Response.json({ registration }, { headers: noStore })
  } catch {
    return errorResponse(503, 'feishu-registration-unavailable', 'Unable to read Feishu connection')
  }
}
