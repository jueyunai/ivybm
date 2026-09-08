import { NextRequest, NextResponse } from 'next/server'
import { getPayload, ValidationError } from 'payload'

import {
  isPortalSupportedAccountKind,
  isValidPortalExternalAccountId,
  toRedactedPlatformAccountSummary,
  validateDeletePlatformAccountInput,
  validateUpdatePlatformAccountInput,
} from '@/modules/platforms/accountPortalDto'
import {
  PlatformAccountMutationConflictError,
  withLockedPlatformAccountMutation,
} from '@/modules/platforms/accountOAuthConcurrency'
import { PlatformAccountIdentityCredentialConflictError } from '@/modules/platforms/accountValidation'
import { PlatformPortalRequestError, readPlatformPortalJSON } from '@/modules/platforms/portalHttp'
import config from '@/payload.config'
import type { User } from '@/payload-types'

class PlatformAccountDeleteConflictError extends Error {
  constructor() {
    super('Platform account has publication history')
    this.name = 'PlatformAccountDeleteConflictError'
  }
}

class PlatformAccountIdentityValidationError extends Error {
  constructor() {
    super('Platform account external identity is invalid')
    this.name = 'PlatformAccountIdentityValidationError'
  }
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const json = (status: number, body: Record<string, unknown>): Response =>
  NextResponse.json(body, {
    headers: { 'cache-control': 'private, no-store' },
    status,
  })

const authenticateAdmin = async (
  request: NextRequest,
): Promise<
  | { error: Response; success: false }
  | { payload: Awaited<ReturnType<typeof getPayload>>; success: true; user: User }
> => {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    return { error: json(503, { error: { code: 'portal_disabled' } }), success: false }
  }
  if (process.env.ADMIN_PORTAL_PLATFORMS_ENABLED !== 'true') {
    return { error: json(503, { error: { code: 'platform_module_disabled' } }), success: false }
  }
  const payload = await getPayload({ config })
  const authenticated = await payload.auth({ headers: request.headers })
  if (!authenticated.user || authenticated.user.collection !== 'users') {
    return { error: json(401, { error: { code: 'authentication_required' } }), success: false }
  }
  const user = authenticated.user as User
  if (user.role !== 'admin') {
    return { error: json(403, { error: { code: 'forbidden' } }), success: false }
  }
  return { payload, success: true, user }
}

const parseAccountId = (request: NextRequest): number | undefined => {
  const value = request.nextUrl.pathname.split('/').pop()
  if (!value || !/^[1-9][0-9]*$/.test(value)) return undefined
  const accountId = Number(value)
  return Number.isSafeInteger(accountId) ? accountId : undefined
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const accountId = parseAccountId(request)
  if (!accountId) return json(400, { error: { code: 'invalid_platform_account_id' } })

  let body: unknown
  try {
    body = await readPlatformPortalJSON(request)
  } catch (error) {
    if (error instanceof PlatformPortalRequestError) {
      return json(error.status, { error: { code: error.code } })
    }
    return json(400, { error: { code: 'invalid_request' } })
  }

  const auth = await authenticateAdmin(request)
  if (!auth.success) return auth.error
  const { payload, user } = auth

  const input = validateUpdatePlatformAccountInput(body)
  if (!input.success) return json(400, { error: input.error })

  try {
    const data: Record<string, unknown> = {}
    if (input.value.name !== undefined) data.name = input.value.name
    if (input.value.externalAccountId !== undefined) {
      data.externalAccountId = input.value.externalAccountId
    }
    if (input.value.notes !== undefined) data.notes = input.value.notes
    if (input.value.aiAutoReplyEnabled !== undefined) {
      data.aiAutoReplyEnabled = input.value.aiAutoReplyEnabled
    }
    if (input.value.messagingInbound !== undefined && input.value.publishing !== undefined) {
      data.capabilities = {
        messagingInbound: input.value.messagingInbound,
        publishing: input.value.publishing,
      }
    }

    const updated = await withLockedPlatformAccountMutation({
      operation: (req, lockedAccount) => {
        if (input.value.externalAccountId !== undefined) {
          if (!isPortalSupportedAccountKind(lockedAccount.account_kind)) {
            throw new PlatformAccountIdentityValidationError()
          }
          if (
            input.value.externalAccountId !== null &&
            !isValidPortalExternalAccountId(
              lockedAccount.account_kind,
              input.value.externalAccountId,
            )
          ) {
            throw new PlatformAccountIdentityValidationError()
          }
        }
        return payload.update({
          collection: 'platform-accounts',
          data,
          id: accountId,
          overrideAccess: false,
          req,
          user,
        })
      },
      payload,
      snapshot: {
        accountId,
        authorizationRevision: input.value.authorizationRevision,
      },
      user,
    })
    return json(200, { data: toRedactedPlatformAccountSummary(updated) })
  } catch (error) {
    if (error instanceof PlatformAccountIdentityValidationError) {
      return json(400, { error: { code: 'invalid_external_account_id' } })
    }
    if (error instanceof PlatformAccountMutationConflictError) {
      return json(409, { error: { code: 'stale_revision' } })
    }
    const message =
      error && typeof error === 'object' && 'message' in error ? String(error.message) : ''
    if (message.includes('unique') || message.includes('duplicate')) {
      return json(409, { error: { code: 'duplicate_account' } })
    }
    if (error instanceof PlatformAccountIdentityCredentialConflictError) {
      return json(409, { error: { code: 'identity_change_requires_credential_rotation' } })
    }
    if (error instanceof ValidationError) {
      return json(400, { error: { code: 'platform_account_validation_failed' } })
    }
    return json(503, { error: { code: 'platform_account_update_failed' } })
  }
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const accountId = parseAccountId(request)
  if (!accountId) return json(400, { error: { code: 'invalid_platform_account_id' } })

  let body: unknown
  try {
    body = await readPlatformPortalJSON(request)
  } catch (error) {
    if (error instanceof PlatformPortalRequestError) {
      return json(error.status, { error: { code: error.code } })
    }
    return json(400, { error: { code: 'invalid_request' } })
  }

  const auth = await authenticateAdmin(request)
  if (!auth.success) return auth.error
  const { payload, user } = auth

  const input = validateDeletePlatformAccountInput(body)
  if (!input.success) return json(400, { error: input.error })

  try {
    await withLockedPlatformAccountMutation({
      operation: async (req) => {
        // The parent row is already locked FOR UPDATE. PostgreSQL foreign-key
        // inserts must take a conflicting KEY SHARE lock, so a PublishJob
        // cannot appear between this count and the delete.
        const publications = await payload.count({
          collection: 'publish-jobs',
          overrideAccess: false,
          req,
          user,
          where: { platformAccount: { equals: accountId } },
        })
        if (publications.totalDocs > 0) throw new PlatformAccountDeleteConflictError()
        return payload.delete({
          collection: 'platform-accounts',
          id: accountId,
          overrideAccess: false,
          req,
          user,
        })
      },
      payload,
      snapshot: {
        accountId,
        allowedAuthorizationStates: ['not_started', 'blocked', 'disabled'],
        authorizationRevision: input.value.authorizationRevision,
      },
      user,
    })
    return json(200, { data: { accountId, deleted: true } })
  } catch (error) {
    if (error instanceof PlatformAccountDeleteConflictError) {
      return json(409, { error: { code: 'account_has_publication_history' } })
    }
    if (error instanceof PlatformAccountMutationConflictError) {
      return json(409, {
        error: {
          code: error.reason === 'state' ? 'account_not_disconnected' : 'stale_revision',
        },
      })
    }
    return json(503, { error: { code: 'platform_account_delete_failed' } })
  }
}
