import {
  executePortalRouteCommand,
  portalPasswordCommandFingerprint,
} from '@/admin-portal/core/commands/portalCommandReceipts'
import {
  createTeamMember,
  getPortalTeamMembers,
} from '@/admin-portal/modules/settings/userSettingsCommands'
import type {
  CreateTeamMemberInput,
  PortalTeamMemberRole,
} from '@/admin-portal/modules/settings/userSettingsContracts'
import {
  assertSameOrigin,
  authorizeUserSettingsRequest,
  readUserSettingsJSON,
  userSettingsErrorResponse,
  userSettingsJSON,
} from '@/admin-portal/modules/settings/userSettingsRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    const { payload, req } = await authorizeUserSettingsRequest(request, { requireAdmin: true })
    const members = await getPortalTeamMembers({ payload, req })
    return userSettingsJSON({ members })
  } catch (error) {
    return userSettingsErrorResponse(error)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request)
    const { actor, payload, req } = await authorizeUserSettingsRequest(request, {
      requireAdmin: true,
    })
    const raw = await readUserSettingsJSON(request)
    const input: CreateTeamMemberInput = {
      confirmPassword: typeof raw.confirmPassword === 'string' ? raw.confirmPassword : '',
      email: typeof raw.email === 'string' ? raw.email : '',
      password: typeof raw.password === 'string' ? raw.password : '',
      role: raw.role as PortalTeamMemberRole,
    }

    const fingerprintInput = portalPasswordCommandFingerprint({
      nonSensitivePayload: {
        action: 'create_team_member',
        email: input.email.trim().toLowerCase(),
        role: input.role,
      },
      sensitiveInputs: [input.password, input.confirmPassword],
    })

    const member = await executePortalRouteCommand({
      fingerprintInput,
      operation: async (transactionReq) =>
        createTeamMember({
          actor,
          input,
          payload,
          req: transactionReq,
        }),
      payload,
      req,
      request,
      scope: 'portal-settings:create-team-member',
    })

    return userSettingsJSON({ member }, { status: 201 })
  } catch (error) {
    return userSettingsErrorResponse(error)
  }
}
