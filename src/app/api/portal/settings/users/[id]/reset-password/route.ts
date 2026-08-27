import {
  executePortalRouteCommand,
  portalPasswordCommandFingerprint,
} from '@/admin-portal/core/commands/portalCommandReceipts'
import { resetMemberPassword } from '@/admin-portal/modules/settings/userSettingsCommands'
import type { ResetMemberPasswordInput } from '@/admin-portal/modules/settings/userSettingsContracts'
import {
  assertSameOrigin,
  authorizeUserSettingsRequest,
  readUserSettingsJSON,
  userSettingsErrorResponse,
  userSettingsJSON,
} from '@/admin-portal/modules/settings/userSettingsRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ id: string }>
}

const parseMemberId = (raw: string): number | string => {
  const numeric = Number(raw)
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : raw
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request)
    const { id: rawId } = await params
    const id = parseMemberId(rawId)
    const { actor, payload, req } = await authorizeUserSettingsRequest(request, {
      requireAdmin: true,
    })
    const raw = await readUserSettingsJSON(request)
    const input: ResetMemberPasswordInput = {
      confirmPassword: typeof raw.confirmPassword === 'string' ? raw.confirmPassword : '',
      password: typeof raw.password === 'string' ? raw.password : '',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    }

    const fingerprintInput = portalPasswordCommandFingerprint({
      nonSensitivePayload: {
        action: 'reset_member_password',
        id,
        updatedAt: input.updatedAt,
      },
      sensitiveInputs: [input.password, input.confirmPassword],
    })

    const member = await executePortalRouteCommand({
      fingerprintInput,
      operation: async (transactionReq) =>
        resetMemberPassword({
          actor,
          id,
          input,
          payload,
          req: transactionReq,
        }),
      payload,
      req,
      request,
      scope: 'portal-settings:reset-member-password',
      target: typeof id === 'number' ? { collection: 'users', id } : undefined,
    })

    return userSettingsJSON({ member })
  } catch (error) {
    return userSettingsErrorResponse(error)
  }
}
