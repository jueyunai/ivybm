import { createHash, randomUUID } from 'node:crypto'

import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload'

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue }
type ReceiptRecord = Record<string, unknown>
type PortalCommandReplayPolicy = 'retry-safe' | 'unknown-on-expiry'
export type PortalCommandExecution = { markExternalDispatch: () => void }

const COMMAND_LEASE_MS = 2 * 60 * 1000
const UNKNOWN_RESULT_CODE = 'portal-command-result-unknown'
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$/

const TARGET_TABLES = {
  'ai-model-profiles': 'ai_model_profiles',
  'ai-providers': 'ai_providers',
  'ai-usage-routes': 'ai_usage_routes',
  'generated-contents': 'generated_contents',
  'knowledge-documents': 'knowledge_documents',
  'knowledge-source-documents': 'knowledge_source_documents',
  leads: 'leads',
  media: 'media',
  pages: 'pages',
  posts: 'posts',
  'product-categories': 'product_categories',
  products: 'products',
  projects: 'projects',
  downloads: 'downloads',
} as const

export type PortalCommandTarget = {
  collection: keyof typeof TARGET_TABLES
  id: number
}

export class PortalCommandReceiptError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'PortalCommandReceiptError'
  }
}

const canonicalize = (value: unknown): JsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }
  return String(value)
}

export const portalCommandFingerprint = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')

export const requirePortalIdempotencyKey = (request: Request): string => {
  const key = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new PortalCommandReceiptError(
      'portal-idempotency-key-required',
      'A valid Idempotency-Key header is required',
      400,
    )
  }
  return key
}

const relationID = (value: unknown): number | string | null => {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  }
  return null
}

const isUniqueConstraintError = (error: unknown): boolean => {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } }
  return candidate?.code === '23505' || candidate?.cause?.code === '23505'
}

const transaction = async <T>(
  payload: Payload,
  user: PayloadRequest['user'],
  operation: (req: PayloadRequest) => Promise<T>,
): Promise<T> => {
  const req = await createLocalReq({ user: user ?? undefined }, payload)
  await initTransaction(req)
  try {
    const result = await operation(req)
    await commitTransaction(req)
    return result
  } catch (error) {
    await killTransaction(req).catch(() => undefined)
    throw error
  }
}

const databaseForRequest = async (payload: Payload, req: PayloadRequest) => {
  const adapter = payload.db as unknown as PostgresAdapter
  const transactionID = await req.transactionID
  if (!transactionID) return adapter.drizzle
  const database = adapter.sessions[transactionID]?.db
  if (!database) {
    throw new Error('Portal command transaction session is unavailable')
  }
  return database
}

const receiptWasUpdated = (result: { rows: unknown[] }): boolean => Boolean(result.rows[0])

const findReceipt = async ({
  actorID,
  idempotencyKey,
  payload,
  req,
  scope,
}: {
  actorID: number
  idempotencyKey: string
  payload: Payload
  req: PayloadRequest
  scope: string
}): Promise<ReceiptRecord | null> => {
  const result = await payload.find({
    collection: 'portal-command-receipts',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: {
      and: [
        { actor: { equals: actorID } },
        { scope: { equals: scope } },
        { idempotencyKey: { equals: idempotencyKey } },
      ],
    },
  })
  return (result.docs[0] as unknown as ReceiptRecord | undefined) ?? null
}

const assertFingerprint = (receipt: ReceiptRecord, fingerprint: string) => {
  if (receipt.fingerprint !== fingerprint) {
    throw new PortalCommandReceiptError(
      'portal-idempotency-conflict',
      'This Idempotency-Key belongs to a different command payload',
      409,
    )
  }
}

const claimCommand = async ({
  actorID,
  fingerprint,
  idempotencyKey,
  now,
  payload,
  replayPolicy,
  scope,
  user,
}: {
  actorID: number
  fingerprint: string
  idempotencyKey: string
  now: Date
  payload: Payload
  replayPolicy: PortalCommandReplayPolicy
  scope: string
  user: PayloadRequest['user']
}): Promise<{ id: number | string; ownerToken: string } | { result: unknown }> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await transaction(payload, user, async (req) => {
        const existing = await findReceipt({ actorID, idempotencyKey, payload, req, scope })
        const ownerToken = randomUUID()
        const leaseExpiresAt = new Date(now.getTime() + COMMAND_LEASE_MS).toISOString()
        if (!existing) {
          const created = await payload.create({
            collection: 'portal-command-receipts',
            context: { skipAudit: true },
            data: {
              actor: actorID,
              fingerprint,
              idempotencyKey,
              leaseExpiresAt,
              ownerToken,
              scope,
              status: 'processing',
            },
            overrideAccess: true,
            req,
          })
          return { id: created.id, ownerToken }
        }
        assertFingerprint(existing, fingerprint)
        if (existing.status === 'completed') return { result: existing.result }
        const expired =
          typeof existing.leaseExpiresAt !== 'string' ||
          existing.leaseExpiresAt <= now.toISOString()
        if (
          replayPolicy === 'unknown-on-expiry' &&
          ((existing.status === 'processing' && expired) ||
            (existing.status === 'failed' && existing.errorCode === UNKNOWN_RESULT_CODE))
        ) {
          throw new PortalCommandReceiptError(
            UNKNOWN_RESULT_CODE,
            'The command outcome is unknown. Check current data before starting a new command.',
            409,
          )
        }
        if (existing.status === 'processing' && !expired) {
          throw new PortalCommandReceiptError(
            'portal-command-processing',
            'This command is already processing',
            409,
          )
        }
        const database = await databaseForRequest(payload, req)
        const reclaimed = await database.execute(sql`
          UPDATE portal_command_receipts
          SET
            error_code = NULL,
            lease_expires_at = ${leaseExpiresAt},
            owner_token = ${ownerToken},
            result = NULL,
            status = 'processing',
            updated_at = ${now.toISOString()}
          WHERE id = ${existing.id as number | string}
            AND (
              status = 'failed'
              OR (status = 'processing' AND lease_expires_at <= ${now.toISOString()})
            )
          RETURNING id
        `)
        if (!receiptWasUpdated(reclaimed)) {
          throw new PortalCommandReceiptError(
            'portal-command-processing',
            'This command is already processing',
            409,
          )
        }
        return { id: existing.id as number | string, ownerToken }
      })
    } catch (error) {
      if (attempt === 0 && isUniqueConstraintError(error)) continue
      throw error
    }
  }
  throw new PortalCommandReceiptError('portal-command-conflict', 'Unable to claim command', 409)
}

const lockTarget = async (payload: Payload, req: PayloadRequest, target?: PortalCommandTarget) => {
  if (!target) return
  const db = await databaseForRequest(payload, req)
  const table = TARGET_TABLES[target.collection]
  await db.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id = ${target.id} FOR UPDATE`)
}

const markFailed = async ({
  code,
  id,
  ownerToken,
  payload,
  user,
}: {
  code: string
  id: number | string
  ownerToken: string
  payload: Payload
  user: PayloadRequest['user']
}): Promise<boolean> =>
  transaction(payload, user, async (req) => {
    const failedAt = new Date().toISOString()
    const database = await databaseForRequest(payload, req)
    const failed = await database.execute(sql`
      UPDATE portal_command_receipts
      SET
        error_code = ${code},
        lease_expires_at = ${failedAt},
        status = 'failed',
        updated_at = ${failedAt}
      WHERE id = ${id}
        AND owner_token = ${ownerToken}
        AND status = 'processing'
      RETURNING id
    `)
    return receiptWasUpdated(failed)
  })

const completeReceipt = async ({
  id,
  ownerToken,
  payload,
  req,
  result,
}: {
  id: number | string
  ownerToken: string
  payload: Payload
  req: PayloadRequest
  result: unknown
}): Promise<boolean> => {
  const completedAt = new Date().toISOString()
  const resultJSON = JSON.stringify(result) ?? 'null'
  const database = await databaseForRequest(payload, req)
  const completed = await database.execute(sql`
    UPDATE portal_command_receipts
    SET
      error_code = NULL,
      lease_expires_at = ${completedAt},
      result = ${resultJSON}::jsonb,
      status = 'completed',
      updated_at = ${completedAt}
    WHERE id = ${id}
      AND owner_token = ${ownerToken}
      AND status = 'processing'
    RETURNING id
  `)
  return receiptWasUpdated(completed)
}

export async function executePortalCommand<T>({
  atomic = true,
  fingerprintInput,
  idempotencyKey,
  operation,
  payload,
  replayPolicy = 'retry-safe',
  req,
  scope,
  target,
}: {
  atomic?: boolean
  fingerprintInput: unknown
  idempotencyKey: string
  operation: (transactionReq: PayloadRequest, execution: PortalCommandExecution) => Promise<T>
  payload: Payload
  replayPolicy?: PortalCommandReplayPolicy
  req: PayloadRequest
  scope: string
  target?: PortalCommandTarget
}): Promise<T> {
  const actorID = relationID(req.user)
  if (typeof actorID !== 'number') {
    throw new PortalCommandReceiptError('portal-unauthenticated', 'Authentication required', 401)
  }
  const claimed = await claimCommand({
    actorID,
    fingerprint: portalCommandFingerprint(fingerprintInput),
    idempotencyKey,
    now: new Date(),
    payload,
    replayPolicy,
    scope,
    user: req.user,
  })
  if ('result' in claimed) return claimed.result as T
  let externalDispatchStarted = false
  const execution: PortalCommandExecution = {
    markExternalDispatch: () => {
      externalDispatchStarted = true
    },
  }
  try {
    if (!atomic) {
      const result = await operation(req, execution)
      await transaction(payload, req.user, async (transactionReq) => {
        const completed = await completeReceipt({
          id: claimed.id,
          ownerToken: claimed.ownerToken,
          payload,
          req: transactionReq,
          result,
        })
        if (!completed) {
          throw new PortalCommandReceiptError(
            'portal-command-conflict',
            'Command ownership changed before completion',
            409,
          )
        }
      })
      return result
    }
    return await transaction(payload, req.user, async (transactionReq) => {
      const receipt = await findReceipt({
        actorID,
        idempotencyKey,
        payload,
        req: transactionReq,
        scope,
      })
      if (
        !receipt ||
        receipt.id !== claimed.id ||
        receipt.ownerToken !== claimed.ownerToken ||
        receipt.status !== 'processing'
      ) {
        throw new PortalCommandReceiptError(
          'portal-command-conflict',
          'Command ownership changed before completion',
          409,
        )
      }
      await lockTarget(payload, transactionReq, target)
      const result = await operation(transactionReq, execution)
      const completed = await completeReceipt({
        id: claimed.id,
        ownerToken: claimed.ownerToken,
        payload,
        req: transactionReq,
        result,
      })
      if (!completed) {
        throw new PortalCommandReceiptError(
          'portal-command-conflict',
          'Command ownership changed before completion',
          409,
        )
      }
      return result
    })
  } catch (error) {
    const code =
      replayPolicy === 'unknown-on-expiry' && externalDispatchStarted
        ? UNKNOWN_RESULT_CODE
        : error &&
            typeof error === 'object' &&
            typeof (error as { code?: unknown }).code === 'string'
          ? String((error as { code: string }).code)
          : 'portal-command-failed'
    try {
      await markFailed({
        code,
        id: claimed.id,
        ownerToken: claimed.ownerToken,
        payload,
        user: req.user,
      })
    } catch (receiptError) {
      throw new AggregateError(
        [error, receiptError],
        'Portal command failed and its receipt failure state could not be recorded',
      )
    }
    throw error
  }
}

export const executePortalRouteCommand = <T>({
  atomic,
  fingerprintInput,
  operation,
  payload,
  replayPolicy,
  req,
  request,
  scope,
  target,
}: {
  atomic?: boolean
  fingerprintInput: unknown
  operation: (transactionReq: PayloadRequest, execution: PortalCommandExecution) => Promise<T>
  payload: Payload
  replayPolicy?: PortalCommandReplayPolicy
  req: PayloadRequest
  request: Request
  scope: string
  target?: PortalCommandTarget
}): Promise<T> =>
  executePortalCommand({
    atomic,
    fingerprintInput,
    idempotencyKey: requirePortalIdempotencyKey(request),
    operation,
    payload,
    replayPolicy,
    req,
    scope,
    target,
  })
