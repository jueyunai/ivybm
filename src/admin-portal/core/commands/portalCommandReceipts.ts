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

const COMMAND_LEASE_MS = 2 * 60 * 1000
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$/

const TARGET_TABLES = {
  'generated-contents': 'generated_contents',
  'knowledge-documents': 'knowledge_documents',
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
  scope,
  user,
}: {
  actorID: number
  fingerprint: string
  idempotencyKey: string
  now: Date
  payload: Payload
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
        if (existing.status === 'processing' && !expired) {
          throw new PortalCommandReceiptError(
            'portal-command-processing',
            'This command is already processing',
            409,
          )
        }
        const reclaimed = await payload.update({
          collection: 'portal-command-receipts',
          context: { skipAudit: true },
          data: {
            errorCode: null,
            leaseExpiresAt,
            ownerToken,
            result: null,
            status: 'processing',
          },
          overrideAccess: true,
          req,
          where: {
            and: [
              { id: { equals: existing.id } },
              {
                or: [
                  { status: { equals: 'failed' } },
                  {
                    and: [
                      { status: { equals: 'processing' } },
                      { leaseExpiresAt: { less_than_equal: now.toISOString() } },
                    ],
                  },
                ],
              },
            ],
          },
        })
        if (!reclaimed.docs[0]) {
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
  const adapter = payload.db as unknown as PostgresAdapter
  const transactionID = await req.transactionID
  const db = transactionID
    ? (adapter.sessions[transactionID]?.db ?? adapter.drizzle)
    : adapter.drizzle
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
}) => {
  await transaction(payload, user, async (req) => {
    await payload.update({
      collection: 'portal-command-receipts',
      context: { skipAudit: true },
      data: { errorCode: code, leaseExpiresAt: new Date().toISOString(), status: 'failed' },
      overrideAccess: true,
      req,
      where: {
        and: [
          { id: { equals: id } },
          { ownerToken: { equals: ownerToken } },
          { status: { equals: 'processing' } },
        ],
      },
    })
  })
}

export async function executePortalCommand<T>({
  atomic = true,
  fingerprintInput,
  idempotencyKey,
  operation,
  payload,
  req,
  scope,
  target,
}: {
  atomic?: boolean
  fingerprintInput: unknown
  idempotencyKey: string
  operation: (transactionReq: PayloadRequest) => Promise<T>
  payload: Payload
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
    scope,
    user: req.user,
  })
  if ('result' in claimed) return claimed.result as T
  try {
    if (!atomic) {
      const result = await operation(req)
      await transaction(payload, req.user, async (transactionReq) => {
        const completed = await payload.update({
          collection: 'portal-command-receipts',
          context: { skipAudit: true },
          data: {
            errorCode: null,
            leaseExpiresAt: new Date().toISOString(),
            result: result as JsonValue,
            status: 'completed',
          },
          overrideAccess: true,
          req: transactionReq,
          where: {
            and: [
              { id: { equals: claimed.id } },
              { ownerToken: { equals: claimed.ownerToken } },
              { status: { equals: 'processing' } },
            ],
          },
        })
        if (!completed.docs[0]) {
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
      const result = await operation(transactionReq)
      const completed = await payload.update({
        collection: 'portal-command-receipts',
        context: { skipAudit: true },
        data: {
          errorCode: null,
          leaseExpiresAt: new Date().toISOString(),
          result: result as JsonValue,
          status: 'completed',
        },
        overrideAccess: true,
        req: transactionReq,
        where: {
          and: [
            { id: { equals: claimed.id } },
            { ownerToken: { equals: claimed.ownerToken } },
            { status: { equals: 'processing' } },
          ],
        },
      })
      if (!completed.docs[0]) {
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
      error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? String((error as { code: string }).code)
        : 'portal-command-failed'
    await markFailed({
      code,
      id: claimed.id,
      ownerToken: claimed.ownerToken,
      payload,
      user: req.user,
    }).catch(() => undefined)
    throw error
  }
}

export const executePortalRouteCommand = <T>({
  atomic,
  fingerprintInput,
  operation,
  payload,
  req,
  request,
  scope,
  target,
}: {
  atomic?: boolean
  fingerprintInput: unknown
  operation: (transactionReq: PayloadRequest) => Promise<T>
  payload: Payload
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
    req,
    scope,
    target,
  })
