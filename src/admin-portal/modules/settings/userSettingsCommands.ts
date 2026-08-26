import { sql } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'

import type { User } from '@/payload-types'
import { getDatabaseForRequest } from '@/admin-portal/core/commands/portalCommandReceipts'

import {
  MANUAL_LOCK_UNTIL,
  selectPortalTeamMemberDTO,
  UserSettingsCommandError,
  validateEmail,
  validatePassword,
  validateRole,
  validateUpdatedAt,
  type ChangePersonalPasswordInput,
  type CreateTeamMemberInput,
  type DeleteTeamMemberInput,
  type LockTeamMemberInput,
  type PortalTeamMemberDTO,
  type ResetMemberPasswordInput,
  type UnlockTeamMemberInput,
  type UpdateTeamMemberInput,
} from './userSettingsContracts'

const isForeignKeyConstraintError = (error: unknown): boolean => {
  const candidate = error as { cause?: { code?: unknown }; code?: unknown }
  return candidate?.code === '23503' || candidate?.cause?.code === '23503'
}

// All commands that can remove an available administrator share this
// transaction-scoped lock. Target-row locks alone cannot serialize commands
// that operate on two different administrator rows.
const lockAvailableAdminInvariant = async (
  payload: Payload,
  req: PayloadRequest,
): Promise<void> => {
  const transactionID = await req.transactionID
  if (!transactionID) {
    throw new UserSettingsCommandError(
      'last-admin-transaction-required',
      'Administrator safety checks require an active database transaction.',
      500,
    )
  }
  const database = await getDatabaseForRequest(payload, req)
  await database.execute(sql`SELECT pg_advisory_xact_lock(49565942, 16)`)
}

export const revokeUserSessions = async (
  payload: Payload,
  req: PayloadRequest,
  userId: number | string,
): Promise<void> => {
  const database = await getDatabaseForRequest(payload, req)
  await database.execute(sql`
    DELETE FROM "users_sessions" WHERE "_parent_id" = ${userId}
  `)
}

export const assertRemainingAvailableAdmin = async ({
  excludingUserId,
  payload,
  req,
}: {
  excludingUserId: number | string
  payload: Payload
  req: PayloadRequest
}): Promise<void> => {
  await lockAvailableAdminInvariant(payload, req)

  // Read the current administrator rows through the same transaction
  // connection as the advisory lock. Payload's collection query may reuse a
  // snapshot that was created before another command released the invariant
  // lock; this SQL query runs after the advisory wait and observes the latest
  // committed row versions. The advisory lock is deliberately the sole
  // cross-target serializer here, avoiding a lock-order deadlock with the
  // generic command target-row lock acquired before the operation callback.
  const database = await getDatabaseForRequest(payload, req)
  const adminsResult = await database.execute(sql`
    SELECT "id", "lock_until"
    FROM "users"
    WHERE "role" = 'admin'
    ORDER BY "id"
  `)

  const now = Date.now()
  const availableAdmins = adminsResult.rows.filter((row) => {
    const admin = row as { id?: number | string; lock_until?: string | Date | null }
    if (String(admin.id) === String(excludingUserId)) return false
    if (!admin.lock_until) return true
    const lockDate = new Date(admin.lock_until).getTime()
    return Number.isFinite(lockDate) && lockDate <= now
  })

  if (availableAdmins.length === 0) {
    throw new UserSettingsCommandError(
      'last-admin-protected',
      'This operation would leave the system without an available administrator.',
      409,
    )
  }
}

export const assertNoActiveBusinessAssignments = async ({
  payload,
  req,
  userId,
}: {
  payload: Payload
  req: PayloadRequest
  userId: number | string
}): Promise<void> => {
  const [
    leadsCount,
    convCount,
    handoffsCount,
    feishuRegistrationsCount,
    pendingPublishJobsCount,
    generatedContentsCount,
    contentReviewsCount,
    publishJobsHistoryCount,
    commandReceiptsCount,
  ] = await Promise.all([
    payload.count({
      collection: 'leads',
      overrideAccess: true,
      req,
      where: { assignedTo: { equals: userId } },
    }),
    payload.count({
      collection: 'conversations',
      overrideAccess: true,
      req,
      where: { assignedTo: { equals: userId } },
    }),
    payload.count({
      collection: 'handoffs',
      overrideAccess: true,
      req,
      where: {
        and: [{ assignedTo: { equals: userId } }, { status: { in: ['requested', 'active'] } }],
      },
    }),
    payload.count({
      collection: 'feishu-app-registrations',
      overrideAccess: true,
      req,
      where: {
        and: [
          { requestedBy: { equals: userId } },
          {
            status: {
              in: ['pending', 'registering', 'qr_ready', 'configuring', 'authorization_ready'],
            },
          },
        ],
      },
    }),
    payload.count({
      collection: 'publish-jobs',
      overrideAccess: true,
      req,
      where: {
        and: [
          { createdBy: { equals: userId } },
          { status: { in: ['scheduled', 'accepted', 'publishing'] } },
        ],
      },
    }),
    payload.count({
      collection: 'generated-contents',
      overrideAccess: true,
      req,
      where: { createdBy: { equals: userId } },
    }),
    payload.count({
      collection: 'content-reviews',
      overrideAccess: true,
      req,
      where: { reviewedBy: { equals: userId } },
    }),
    payload.count({
      collection: 'publish-jobs',
      overrideAccess: true,
      req,
      where: { createdBy: { equals: userId } },
    }),
    payload.count({
      collection: 'portal-command-receipts',
      overrideAccess: true,
      req,
      where: {
        and: [{ actor: { equals: userId } }, { status: { equals: 'processing' } }],
      },
    }),
  ])

  let feishuMemberCount = 0
  try {
    const feishuMappings = await payload.find({
      collection: 'feishu-mappings',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      req,
      where: { status: { equals: 'active' } },
    })
    for (const mapping of feishuMappings.docs) {
      if (Array.isArray(mapping.memberMappings)) {
        for (const member of mapping.memberMappings) {
          const mappedId =
            typeof member.user === 'object' && member.user !== null
              ? (member.user as { id?: number | string }).id
              : member.user
          if (String(mappedId) === String(userId) && member.enabled !== false) {
            feishuMemberCount += 1
          }
        }
      }
    }
  } catch (error) {
    throw new UserSettingsCommandError(
      'user-assignment-check-failed',
      'Unable to verify Feishu member assignments. Lock the user or try again later.',
      503,
      { cause: error instanceof Error ? error.name : 'unknown' },
    )
  }

  const hasAssignments =
    leadsCount.totalDocs > 0 ||
    convCount.totalDocs > 0 ||
    handoffsCount.totalDocs > 0 ||
    feishuMemberCount > 0 ||
    feishuRegistrationsCount.totalDocs > 0 ||
    pendingPublishJobsCount.totalDocs > 0 ||
    generatedContentsCount.totalDocs > 0 ||
    contentReviewsCount.totalDocs > 0 ||
    publishJobsHistoryCount.totalDocs > 0 ||
    commandReceiptsCount.totalDocs > 0

  if (hasAssignments) {
    const details = {
      conversations: convCount.totalDocs,
      contentReviews: contentReviewsCount.totalDocs,
      feishuActiveRegistrations: feishuRegistrationsCount.totalDocs,
      feishuMemberMappings: feishuMemberCount,
      generatedContents: generatedContentsCount.totalDocs,
      handoffs: handoffsCount.totalDocs,
      leads: leadsCount.totalDocs,
      pendingPublishJobs: pendingPublishJobsCount.totalDocs,
      activePortalCommands: commandReceiptsCount.totalDocs,
      publishJobs: publishJobsHistoryCount.totalDocs,
    }
    throw new UserSettingsCommandError(
      'user-has-assignments',
      'Cannot delete a user with active assignments or retained business history. Reassign active work or lock the user instead.',
      409,
      details,
    )
  }
}

const deleteRetiredCommandReceipts = async ({
  payload,
  req,
  userId,
}: {
  payload: Payload
  req: PayloadRequest
  userId: number | string
}): Promise<void> => {
  await payload.delete({
    collection: 'portal-command-receipts',
    context: { skipAudit: true },
    overrideAccess: true,
    req,
    where: {
      and: [{ actor: { equals: userId } }, { status: { in: ['completed', 'failed'] } }],
    },
  })
}

export const getPortalTeamMembers = async ({
  payload,
  req,
}: {
  payload: Payload
  req: PayloadRequest
}): Promise<PortalTeamMemberDTO[]> => {
  const result = await payload.find({
    collection: 'users',
    depth: 0,
    limit: 100,
    overrideAccess: false,
    req,
    showHiddenFields: true,
    sort: 'createdAt',
  })

  return result.docs.map((doc) => selectPortalTeamMemberDTO(doc as User))
}

export const createTeamMember = async ({
  actor,
  input,
  payload,
  req,
}: {
  actor: { id: number | string; role: string }
  input: CreateTeamMemberInput
  payload: Payload
  req: PayloadRequest
}): Promise<PortalTeamMemberDTO> => {
  const email = validateEmail(input.email)
  const password = validatePassword(input.password, 'Initial password')
  const confirmPassword = validatePassword(input.confirmPassword, 'Confirm initial password')

  if (password !== confirmPassword) {
    throw new UserSettingsCommandError(
      'invalid-input',
      'Initial password and confirmation must match.',
      400,
    )
  }

  const role = validateRole(input.role)

  const existing = await payload.find({
    collection: 'users',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { email: { equals: email } },
  })

  if (existing.totalDocs > 0) {
    throw new UserSettingsCommandError(
      'email-already-exists',
      'A user with this email address already exists.',
      409,
    )
  }

  const created = await payload.create({
    collection: 'users',
    data: {
      email,
      password,
      role,
    } as never,
    overrideAccess: false,
    req,
  })

  console.info('portal.team_member.created', {
    actorId: actor.id,
    role,
    targetId: created.id,
  })

  return selectPortalTeamMemberDTO(created as User)
}

export const updateTeamMember = async ({
  actor,
  id,
  input,
  payload,
  req,
}: {
  actor: { id: number | string; role: string }
  id: number | string
  input: UpdateTeamMemberInput
  payload: Payload
  req: PayloadRequest
}): Promise<PortalTeamMemberDTO> => {
  const updatedAt = validateUpdatedAt(input.updatedAt)
  const email = input.email !== undefined ? validateEmail(input.email) : undefined
  const role = input.role !== undefined ? validateRole(input.role) : undefined

  if (email === undefined && role === undefined) {
    throw new UserSettingsCommandError(
      'invalid-input',
      'At least email or role must be provided.',
      400,
    )
  }

  const current = await payload.findByID({
    collection: 'users',
    depth: 0,
    id,
    overrideAccess: false,
    req,
    showHiddenFields: true,
  })

  if (!current) {
    throw new UserSettingsCommandError('user-not-found', 'User not found.', 404)
  }

  if (current.updatedAt !== updatedAt) {
    throw new UserSettingsCommandError(
      'stale-user-version',
      'This user was modified by another administrator. Refresh before updating.',
      409,
    )
  }

  if (String(current.id) === String(actor.id) && role !== undefined && role !== current.role) {
    throw new UserSettingsCommandError(
      'self-role-change-forbidden',
      'Administrators cannot modify their own role.',
      403,
    )
  }

  if (current.role === 'admin' && role !== undefined && role !== 'admin') {
    await assertRemainingAvailableAdmin({ excludingUserId: current.id, payload, req })
  }

  if (email !== undefined && email !== current.email) {
    const existing = await payload.find({
      collection: 'users',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: {
        and: [{ email: { equals: email } }, { id: { not_equals: current.id } }],
      },
    })
    if (existing.totalDocs > 0) {
      throw new UserSettingsCommandError(
        'email-already-exists',
        'A user with this email address already exists.',
        409,
      )
    }
  }

  const dataToUpdate: Record<string, unknown> = {}
  if (email !== undefined) dataToUpdate.email = email
  if (role !== undefined) dataToUpdate.role = role

  const updated = await payload.update({
    collection: 'users',
    data: dataToUpdate as never,
    id: current.id,
    overrideAccess: false,
    req,
    showHiddenFields: true,
  })

  await revokeUserSessions(payload, req, current.id)

  console.info('portal.team_member.updated', {
    actorId: actor.id,
    changedFields: Object.keys(dataToUpdate),
    targetId: current.id,
  })

  return selectPortalTeamMemberDTO(updated as User)
}

export const resetMemberPassword = async ({
  actor,
  id,
  input,
  payload,
  req,
}: {
  actor: { id: number | string; role: string }
  id: number | string
  input: ResetMemberPasswordInput
  payload: Payload
  req: PayloadRequest
}): Promise<PortalTeamMemberDTO> => {
  const updatedAt = validateUpdatedAt(input.updatedAt)
  const password = validatePassword(input.password, 'New password')
  const confirmPassword = validatePassword(input.confirmPassword, 'Confirm new password')

  if (password !== confirmPassword) {
    throw new UserSettingsCommandError(
      'invalid-input',
      'New password and confirmation must match.',
      400,
    )
  }

  const current = await payload.findByID({
    collection: 'users',
    depth: 0,
    id,
    overrideAccess: false,
    req,
    showHiddenFields: true,
  })

  if (!current) {
    throw new UserSettingsCommandError('user-not-found', 'User not found.', 404)
  }

  if (current.updatedAt !== updatedAt) {
    throw new UserSettingsCommandError(
      'stale-user-version',
      'This user was modified by another administrator. Refresh before updating.',
      409,
    )
  }

  if (String(current.id) === String(actor.id)) {
    throw new UserSettingsCommandError(
      'self-reset-password-forbidden',
      'Use personal password change to update your own password.',
      403,
    )
  }

  const updated = await payload.update({
    collection: 'users',
    data: { password } as never,
    id: current.id,
    overrideAccess: false,
    req,
    showHiddenFields: true,
  })

  await revokeUserSessions(payload, req, current.id)

  console.info('portal.team_member.password_reset', {
    actorId: actor.id,
    targetId: current.id,
  })

  return selectPortalTeamMemberDTO(updated as User)
}

export const lockTeamMember = async ({
  actor,
  id,
  input,
  payload,
  req,
}: {
  actor: { id: number | string; role: string }
  id: number | string
  input: LockTeamMemberInput
  payload: Payload
  req: PayloadRequest
}): Promise<PortalTeamMemberDTO> => {
  const updatedAt = validateUpdatedAt(input.updatedAt)

  const current = await payload.findByID({
    collection: 'users',
    depth: 0,
    id,
    overrideAccess: false,
    req,
    showHiddenFields: true,
  })

  if (!current) {
    throw new UserSettingsCommandError('user-not-found', 'User not found.', 404)
  }

  if (current.updatedAt !== updatedAt) {
    throw new UserSettingsCommandError(
      'stale-user-version',
      'This user was modified by another administrator. Refresh before updating.',
      409,
    )
  }

  if (String(current.id) === String(actor.id)) {
    throw new UserSettingsCommandError(
      'self-lock-forbidden',
      'Administrators cannot lock their own account.',
      403,
    )
  }

  if (current.role === 'admin') {
    await assertRemainingAvailableAdmin({ excludingUserId: current.id, payload, req })
  }

  const updated = await payload.update({
    collection: 'users',
    data: { lockUntil: MANUAL_LOCK_UNTIL } as never,
    id: current.id,
    overrideAccess: true,
    req,
    showHiddenFields: true,
  })

  await revokeUserSessions(payload, req, current.id)

  console.info('portal.team_member.locked', {
    actorId: actor.id,
    targetId: current.id,
  })

  return selectPortalTeamMemberDTO(updated as User)
}

export const unlockTeamMember = async ({
  actor,
  id,
  input,
  payload,
  req,
}: {
  actor: { id: number | string; role: string }
  id: number | string
  input: UnlockTeamMemberInput
  payload: Payload
  req: PayloadRequest
}): Promise<PortalTeamMemberDTO> => {
  const updatedAt = validateUpdatedAt(input.updatedAt)

  const current = await payload.findByID({
    collection: 'users',
    depth: 0,
    id,
    overrideAccess: false,
    req,
    showHiddenFields: true,
  })

  if (!current) {
    throw new UserSettingsCommandError('user-not-found', 'User not found.', 404)
  }

  if (current.updatedAt !== updatedAt) {
    throw new UserSettingsCommandError(
      'stale-user-version',
      'This user was modified by another administrator. Refresh before updating.',
      409,
    )
  }

  const updated = await payload.update({
    collection: 'users',
    data: { lockUntil: null, loginAttempts: 0 } as never,
    id: current.id,
    overrideAccess: true,
    req,
    showHiddenFields: true,
  })

  console.info('portal.team_member.unlocked', {
    actorId: actor.id,
    targetId: current.id,
  })

  return selectPortalTeamMemberDTO(updated as User)
}

export const deleteTeamMember = async ({
  actor,
  id,
  input,
  payload,
  req,
}: {
  actor: { id: number | string; role: string }
  id: number | string
  input: DeleteTeamMemberInput
  payload: Payload
  req: PayloadRequest
}): Promise<{ deletedId: number | string; success: true }> => {
  const confirmEmail = validateEmail(input.confirmEmail)
  const updatedAt = validateUpdatedAt(input.updatedAt)

  const current = await payload.findByID({
    collection: 'users',
    depth: 0,
    id,
    overrideAccess: false,
    req,
    showHiddenFields: true,
  })

  if (!current) {
    throw new UserSettingsCommandError('user-not-found', 'User not found.', 404)
  }

  if (current.updatedAt !== updatedAt) {
    throw new UserSettingsCommandError(
      'stale-user-version',
      'This user was modified by another administrator. Refresh before updating.',
      409,
    )
  }

  if (String(current.id) === String(actor.id)) {
    throw new UserSettingsCommandError(
      'self-delete-forbidden',
      'Administrators cannot delete their own account.',
      403,
    )
  }

  if (current.email.toLowerCase() !== confirmEmail) {
    throw new UserSettingsCommandError(
      'invalid-input',
      'Confirmation email does not match target user email.',
      400,
    )
  }

  if (current.role === 'admin') {
    await assertRemainingAvailableAdmin({ excludingUserId: current.id, payload, req })
  }

  await assertNoActiveBusinessAssignments({ payload, req, userId: current.id })

  await revokeUserSessions(payload, req, current.id)
  await deleteRetiredCommandReceipts({ payload, req, userId: current.id })

  try {
    await payload.delete({
      collection: 'users',
      id: current.id,
      overrideAccess: false,
      req,
    })
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      throw new UserSettingsCommandError(
        'user-has-assignments',
        'Cannot delete a user with retained business history. Lock the user instead.',
        409,
      )
    }
    throw error
  }

  console.info('portal.team_member.deleted', {
    actorId: actor.id,
    targetId: current.id,
  })

  return { deletedId: current.id, success: true }
}

export const changePersonalPassword = async ({
  input,
  payload,
  req,
  user,
}: {
  input: ChangePersonalPasswordInput
  payload: Payload
  req: PayloadRequest
  user: { email: string; id: number | string; role: string }
}): Promise<{ success: true }> => {
  if (typeof input.currentPassword !== 'string' || !input.currentPassword) {
    throw new UserSettingsCommandError('invalid-input', 'Current password is required.', 400)
  }

  const newPassword = validatePassword(input.newPassword, 'New password')
  const confirmNewPassword = validatePassword(input.confirmNewPassword, 'Confirm new password')

  if (newPassword !== confirmNewPassword) {
    throw new UserSettingsCommandError(
      'invalid-input',
      'New password and confirmation must match.',
      400,
    )
  }

  if (newPassword === input.currentPassword) {
    throw new UserSettingsCommandError(
      'invalid-input',
      'New password must be different from current password.',
      400,
    )
  }

  try {
    await payload.login({
      collection: 'users',
      data: {
        email: user.email,
        password: input.currentPassword,
      },
      req,
    })
  } catch {
    throw new UserSettingsCommandError(
      'current-password-invalid',
      'The current password is incorrect.',
      400,
    )
  }

  await payload.update({
    collection: 'users',
    data: { password: newPassword } as never,
    id: user.id,
    overrideAccess: false,
    req,
  })

  await revokeUserSessions(payload, req, user.id)

  console.info('portal.account.password_changed', {
    actorId: user.id,
  })

  return { success: true }
}
