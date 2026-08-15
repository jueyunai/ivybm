import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload'

import type { PlatformAccount, User } from '@/payload-types'

type PlatformOAuthAccountKind = Extract<
  PlatformAccount['accountKind'],
  'facebook-page' | 'instagram-professional' | 'linkedin-member' | 'linkedin-organization'
>

export type PlatformOAuthAccountSnapshot = {
  accountId: string
  accountKind: PlatformOAuthAccountKind
  authorizationRevision: number
  externalAccountId: string
}

export type LockedPlatformAccount = {
  account_kind: string
  authorization_revision: number | string
  authorization_state: string
  external_account_id: null | string
}

export type PlatformAccountMutationSnapshot = {
  accountId: number
  allowedAuthorizationStates?: readonly PlatformAccount['authorization']['state'][]
  authorizationRevision: number
}

export class PlatformOAuthAccountChangedError extends Error {
  constructor() {
    super('Platform account changed during OAuth')
    this.name = 'PlatformOAuthAccountChangedError'
  }
}

export class PlatformAccountMutationConflictError extends Error {
  constructor(public readonly reason: 'state' | 'stale_revision') {
    super('Platform account changed before the requested mutation')
    this.name = 'PlatformAccountMutationConflictError'
  }
}

const normalizeRevision = (value: unknown): number | undefined => {
  const revision =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : undefined
}

const databaseForRequest = async (payload: Payload, req: PayloadRequest) => {
  const adapter = payload.db as unknown as PostgresAdapter
  const transactionID = await req.transactionID
  if (!transactionID) return adapter.drizzle
  const database = adapter.sessions[String(transactionID)]?.db
  if (!database) throw new Error('Platform OAuth transaction session is unavailable')
  return database
}

const matchesSnapshot = (
  account: LockedPlatformAccount | undefined,
  snapshot: PlatformOAuthAccountSnapshot,
): boolean => {
  if (!account) return false
  const externalAccountId = account.external_account_id?.trim()
  return (
    account.account_kind === snapshot.accountKind &&
    externalAccountId === snapshot.externalAccountId &&
    normalizeRevision(account.authorization_revision) === snapshot.authorizationRevision &&
    account.authorization_state !== 'blocked' &&
    account.authorization_state !== 'disabled'
  )
}

/**
 * Serialize the final OAuth write against disconnects and account edits.
 *
 * PlatformAccounts increments `authorization_revision` under the same row lock
 * for every account update. The encrypted OAuth transaction carries the value
 * observed at start; the callback locks and compares that generation before
 * writing in this same transaction, so disconnects and edits invalidate it.
 */
export const withLockedPlatformOAuthAccount = async <T>({
  operation,
  payload,
  snapshot,
  user,
}: {
  operation: (req: PayloadRequest) => Promise<T>
  payload: Payload
  snapshot: PlatformOAuthAccountSnapshot
  user: User
}): Promise<T> => {
  const req = await createLocalReq({ user }, payload)
  await initTransaction(req)
  try {
    const database = await databaseForRequest(payload, req)
    const locked = await database.execute(sql`
      SELECT
        "account_kind",
        "authorization_revision",
        "authorization_state",
        "external_account_id"
      FROM "platform_accounts"
      WHERE "id" = ${Number(snapshot.accountId)}
      FOR UPDATE
    `)
    const account = locked.rows[0] as LockedPlatformAccount | undefined
    if (!matchesSnapshot(account, snapshot)) throw new PlatformOAuthAccountChangedError()

    const result = await operation(req)
    await commitTransaction(req)
    return result
  } catch (error) {
    await killTransaction(req).catch(() => undefined)
    throw error
  }
}

/**
 * Atomically compare the Portal client's revision (and optional allowed states)
 * with the row that will be mutated. The operation receives the same Payload
 * request/transaction so no callback, disconnect, or competing edit can slip
 * between the comparison and the write.
 */
export const withLockedPlatformAccountMutation = async <T>({
  operation,
  payload,
  snapshot,
  user,
}: {
  operation: (req: PayloadRequest, account: LockedPlatformAccount) => Promise<T>
  payload: Payload
  snapshot: PlatformAccountMutationSnapshot
  user: User
}): Promise<T> => {
  const req = await createLocalReq({ user }, payload)
  await initTransaction(req)
  try {
    const database = await databaseForRequest(payload, req)
    const locked = await database.execute(sql`
      SELECT
        "account_kind",
        "authorization_revision",
        "authorization_state",
        "external_account_id"
      FROM "platform_accounts"
      WHERE "id" = ${snapshot.accountId}
      FOR UPDATE
    `)
    const account = locked.rows[0] as LockedPlatformAccount | undefined
    if (!account) throw new PlatformAccountMutationConflictError('stale_revision')
    if (normalizeRevision(account.authorization_revision) !== snapshot.authorizationRevision) {
      throw new PlatformAccountMutationConflictError('stale_revision')
    }
    if (
      snapshot.allowedAuthorizationStates &&
      !snapshot.allowedAuthorizationStates.includes(
        account.authorization_state as PlatformAccount['authorization']['state'],
      )
    ) {
      throw new PlatformAccountMutationConflictError('state')
    }

    const result = await operation(req, account)
    await commitTransaction(req)
    return result
  } catch (error) {
    await killTransaction(req).catch(() => undefined)
    throw error
  }
}
