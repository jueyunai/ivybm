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
  'facebook-page' | 'instagram-professional'
>

export type PlatformOAuthAccountSnapshot = {
  accountId: string
  accountKind: PlatformOAuthAccountKind
  authorizationRevision: string
  externalAccountId: string
}

type LockedPlatformAccount = {
  account_kind: string
  authorization_state: string
  external_account_id: null | string
  updated_at: Date | string
}

export class PlatformOAuthAccountChangedError extends Error {
  constructor() {
    super('Platform account changed during OAuth')
    this.name = 'PlatformOAuthAccountChangedError'
  }
}

const normalizeRevision = (value: unknown): string | undefined => {
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'string') return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
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
    normalizeRevision(account.updated_at) === snapshot.authorizationRevision &&
    account.authorization_state !== 'blocked' &&
    account.authorization_state !== 'disabled'
  )
}

/**
 * Serialize the final OAuth write against disconnects and account edits.
 *
 * `updated_at` is the durable account revision already maintained by Payload.
 * The encrypted OAuth transaction carries the value observed at start; the
 * callback locks the row after provider I/O and refuses to write when the
 * revision, provider identity, or account kind changed in the meantime.
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
        "authorization_state",
        "external_account_id",
        "updated_at"
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
