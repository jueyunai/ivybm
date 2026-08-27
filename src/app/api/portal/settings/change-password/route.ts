import {
  executePortalRouteCommand,
  portalPasswordCommandFingerprint,
} from '@/admin-portal/core/commands/portalCommandReceipts'
import { changePersonalPassword } from '@/admin-portal/modules/settings/userSettingsCommands'
import type { ChangePersonalPasswordInput } from '@/admin-portal/modules/settings/userSettingsContracts'
import {
  assertSameOrigin,
  authorizeUserSettingsRequest,
  readUserSettingsJSON,
  userSettingsErrorResponse,
  userSettingsJSON,
} from '@/admin-portal/modules/settings/userSettingsRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request)
    const { payload, req, user } = await authorizeUserSettingsRequest(request, {
      requireAdmin: false,
    })
    const raw = await readUserSettingsJSON(request)
    const input: ChangePersonalPasswordInput = {
      confirmNewPassword:
        typeof raw.confirmNewPassword === 'string' ? raw.confirmNewPassword : '',
      currentPassword: typeof raw.currentPassword === 'string' ? raw.currentPassword : '',
      newPassword: typeof raw.newPassword === 'string' ? raw.newPassword : '',
    }

    const fingerprintInput = portalPasswordCommandFingerprint({
      nonSensitivePayload: {
        action: 'change_personal_password',
        userId: user.id,
      },
      sensitiveInputs: [input.currentPassword, input.newPassword, input.confirmNewPassword],
    })

    const result = await executePortalRouteCommand({
      fingerprintInput,
      operation: async (transactionReq) =>
        changePersonalPassword({
          input,
          payload,
          req: transactionReq,
          user,
        }),
      payload,
      req,
      request,
      scope: 'portal-settings:change-password',
      target: typeof user.id === 'number' ? { collection: 'users', id: user.id } : undefined,
    })

    return userSettingsJSON(result)
  } catch (error) {
    return userSettingsErrorResponse(error)
  }
}
