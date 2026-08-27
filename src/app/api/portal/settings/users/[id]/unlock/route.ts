import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import { unlockTeamMember } from '@/admin-portal/modules/settings/userSettingsCommands'
import type { UnlockTeamMemberInput } from '@/admin-portal/modules/settings/userSettingsContracts'
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
    const input: UnlockTeamMemberInput = {
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    }

    const fingerprintInput = {
      action: 'unlock_team_member',
      id,
      updatedAt: input.updatedAt,
    }

    const member = await executePortalRouteCommand({
      fingerprintInput,
      operation: async (transactionReq) =>
        unlockTeamMember({
          actor,
          id,
          input,
          payload,
          req: transactionReq,
        }),
      payload,
      req,
      request,
      scope: 'portal-settings:unlock-team-member',
      target: typeof id === 'number' ? { collection: 'users', id } : undefined,
    })

    return userSettingsJSON({ member })
  } catch (error) {
    return userSettingsErrorResponse(error)
  }
}
