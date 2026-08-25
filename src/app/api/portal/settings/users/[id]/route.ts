import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import {
  deleteTeamMember,
  updateTeamMember,
} from '@/admin-portal/modules/settings/userSettingsCommands'
import type {
  DeleteTeamMemberInput,
  PortalTeamMemberRole,
  UpdateTeamMemberInput,
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

type RouteContext = {
  params: Promise<{ id: string }>
}

const parseMemberId = (raw: string): number | string => {
  const numeric = Number(raw)
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : raw
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request)
    const { id: rawId } = await params
    const id = parseMemberId(rawId)
    const { actor, payload, req } = await authorizeUserSettingsRequest(request, {
      requireAdmin: true,
    })
    const raw = await readUserSettingsJSON(request)
    const input: UpdateTeamMemberInput = {
      email: typeof raw.email === 'string' ? raw.email : undefined,
      role: typeof raw.role === 'string' ? (raw.role as PortalTeamMemberRole) : undefined,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    }

    const fingerprintInput = {
      action: 'update_team_member',
      email: input.email?.trim().toLowerCase(),
      id,
      role: input.role,
      updatedAt: input.updatedAt,
    }

    const member = await executePortalRouteCommand({
      fingerprintInput,
      operation: async (transactionReq) =>
        updateTeamMember({
          actor,
          id,
          input,
          payload,
          req: transactionReq,
        }),
      payload,
      req,
      request,
      scope: 'portal-settings:update-team-member',
      target: typeof id === 'number' ? { collection: 'users', id } : undefined,
    })

    return userSettingsJSON({ member })
  } catch (error) {
    return userSettingsErrorResponse(error)
  }
}

export async function DELETE(request: Request, { params }: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request)
    const { id: rawId } = await params
    const id = parseMemberId(rawId)
    const { actor, payload, req } = await authorizeUserSettingsRequest(request, {
      requireAdmin: true,
    })
    const raw = await readUserSettingsJSON(request)
    const input: DeleteTeamMemberInput = {
      confirmEmail: typeof raw.confirmEmail === 'string' ? raw.confirmEmail : '',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    }

    const fingerprintInput = {
      action: 'delete_team_member',
      confirmEmail: input.confirmEmail.trim().toLowerCase(),
      id,
      updatedAt: input.updatedAt,
    }

    const result = await executePortalRouteCommand({
      fingerprintInput,
      operation: async (transactionReq) =>
        deleteTeamMember({
          actor,
          id,
          input,
          payload,
          req: transactionReq,
        }),
      payload,
      req,
      request,
      scope: 'portal-settings:delete-team-member',
      target: typeof id === 'number' ? { collection: 'users', id } : undefined,
    })

    return userSettingsJSON(result)
  } catch (error) {
    return userSettingsErrorResponse(error)
  }
}
