import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload'

import { PayloadJobQueue } from '@/modules/jobs/claim'
import type { JobHandler } from '@/modules/jobs/contracts'

import { PayloadFeishuTokenProvider } from './connectionClient'
import { FeishuApiError, FeishuConfigurationError } from './contracts'
import {
  createFeishuCRMBase,
  createFeishuCRMTable,
  DEFAULT_FEISHU_FIELD_MAPPINGS,
} from './provision'

export const FEISHU_CONNECTION_PROVISION_JOB_TYPE = 'feishu.connection.provision'

type UnknownRecord = Record<string, unknown>
type ConnectionProvisionPayload = {
  connectionId: number
  connectionRevision: string
}
type ProvisionCounts = { created: number; duplicate: number }

const record = (value: unknown): UnknownRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : undefined

const numericId = (value: unknown, field: string): number => {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  throw new FeishuConfigurationError(`Feishu provisioning ${field} is invalid`)
}

const requiredString = (value: unknown, field: string): string => {
  if (typeof value === 'string' && value.trim()) return value.trim()
  throw new FeishuConfigurationError(`Feishu provisioning ${field} is invalid`)
}

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const parseProvisionPayload = (value: unknown): ConnectionProvisionPayload => {
  const input = record(value)
  if (!input) throw new FeishuConfigurationError('Feishu provisioning payload is invalid')
  return {
    connectionId: numericId(input.connectionId, 'connectionId'),
    connectionRevision: requiredString(input.connectionRevision, 'connectionRevision'),
  }
}

const canProvision = (connection: UnknownRecord, revision: string): boolean =>
  (connection.status === 'provisioning' || connection.status === 'error') &&
  connection.lastConnectedAt === revision

const findConnection = async (
  payload: Payload,
  connectionId: number | string,
  req?: PayloadRequest,
): Promise<UnknownRecord> =>
  (await payload.findByID({
    collection: 'feishu-connections',
    depth: 0,
    id: connectionId,
    overrideAccess: true,
    ...(req ? { req } : {}),
  })) as unknown as UnknownRecord

const withLockedConnection = async <T>({
  connectionId,
  payload,
  run,
}: {
  connectionId: number | string
  payload: Payload
  run: (connection: UnknownRecord, req: PayloadRequest) => Promise<T>
}): Promise<T> => {
  const req = await createLocalReq({}, payload)
  await initTransaction(req)
  try {
    const transactionID = await req.transactionID
    const adapter = payload.db as unknown as PostgresAdapter
    const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
    if (!database) {
      throw new FeishuConfigurationError('Feishu provisioning transaction is unavailable')
    }
    await database.execute(sql`
      SELECT "id" FROM "feishu_connections" WHERE "id" = ${connectionId} FOR UPDATE
    `)
    const result = await run(await findConnection(payload, connectionId, req), req)
    await commitTransaction(req)
    return result
  } catch (error) {
    await killTransaction(req).catch(() => undefined)
    throw error
  }
}

const persistBase = async ({
  appToken,
  baseURL,
  input,
  payload,
}: {
  appToken: string
  baseURL: string
  input: ConnectionProvisionPayload
  payload: Payload
}): Promise<UnknownRecord | null> =>
  withLockedConnection({
    connectionId: input.connectionId,
    payload,
    run: async (connection, req) => {
      if (!canProvision(connection, input.connectionRevision)) return null
      return (await payload.update({
        collection: 'feishu-connections',
        data: { appToken, baseURL, tableId: null },
        id: input.connectionId,
        overrideAccess: true,
        req,
      })) as unknown as UnknownRecord
    },
  })

const persistTable = async ({
  input,
  payload,
  tableId,
}: {
  input: ConnectionProvisionPayload
  payload: Payload
  tableId: string
}): Promise<UnknownRecord | null> =>
  withLockedConnection({
    connectionId: input.connectionId,
    payload,
    run: async (connection, req) => {
      if (!canProvision(connection, input.connectionRevision)) return null
      return (await payload.update({
        collection: 'feishu-connections',
        data: { tableId },
        id: input.connectionId,
        overrideAccess: true,
        req,
      })) as unknown as UnknownRecord
    },
  })

const finalizeProvisioning = async ({
  input,
  payload,
}: {
  input: ConnectionProvisionPayload
  payload: Payload
}): Promise<boolean> =>
  withLockedConnection({
    connectionId: input.connectionId,
    payload,
    run: async (connection, req) => {
      if (!canProvision(connection, input.connectionRevision)) return false
      const appToken = requiredString(connection.appToken, 'appToken')
      const tableId = requiredString(connection.tableId, 'tableId')
      const installerOpenId = requiredString(connection.installerOpenId, 'installerOpenId')
      const mappings = await payload.find({
        collection: 'feishu-mappings',
        depth: 0,
        limit: 3,
        overrideAccess: true,
        req,
        where: {
          or: [{ key: { equals: 'primary-leads' } }, { status: { equals: 'active' } }],
        },
      })
      const targetMapping =
        mappings.docs.find((mapping) => mapping.key === 'primary-leads') ??
        mappings.docs.find((mapping) => String(mapping.connection) === String(input.connectionId))

      for (const mapping of mappings.docs) {
        if (mapping.id !== targetMapping?.id && mapping.status === 'active') {
          await payload.update({
            collection: 'feishu-mappings',
            data: { status: 'disabled' },
            id: mapping.id,
            overrideAccess: true,
            req,
          })
        }
      }

      const mappingData = {
        appToken,
        connection: input.connectionId,
        fieldMappings: DEFAULT_FEISHU_FIELD_MAPPINGS.map((field) => ({ ...field })),
        name: '飞书 CRM 主客户表',
        notificationRecipients: [
          {
            enabled: true,
            label: optionalString(connection.name) ?? '飞书安装管理员',
            receiveId: installerOpenId,
            receiveIdType: 'open_id' as const,
          },
        ],
        status: 'active' as const,
        tableId,
      }
      if (targetMapping) {
        await payload.update({
          collection: 'feishu-mappings',
          data: mappingData,
          id: targetMapping.id,
          overrideAccess: true,
          req,
        })
      } else {
        await payload.create({
          collection: 'feishu-mappings',
          data: { ...mappingData, key: 'primary-leads' },
          overrideAccess: true,
          req,
        })
      }
      await payload.update({
        collection: 'feishu-connections',
        data: { lastErrorCode: null, status: 'connected' },
        id: input.connectionId,
        overrideAccess: true,
        req,
      })
      return true
    },
  })

const provisioningErrorCode = (error: unknown): string => {
  if (error instanceof FeishuApiError) return String(error.code).slice(0, 120)
  if (error instanceof FeishuConfigurationError) return 'configuration_error'
  return 'provisioning_failed'
}

const sanitizedProvisioningError = (error: unknown): Error => {
  if (error instanceof FeishuApiError) {
    return new FeishuApiError({
      code: error.code,
      message: 'Feishu connection provisioning failed',
      retryable: error.retryable,
      ...(error.status === undefined ? {} : { status: error.status }),
    })
  }
  if (error instanceof FeishuConfigurationError) {
    return new FeishuConfigurationError('Feishu connection provisioning configuration is invalid')
  }
  return new Error('Feishu connection provisioning failed')
}

const recordProvisioningFailure = async ({
  finalAttempt,
  input,
  payload,
  error,
}: {
  error: unknown
  finalAttempt: boolean
  input: ConnectionProvisionPayload
  payload: Payload
}): Promise<void> => {
  await withLockedConnection({
    connectionId: input.connectionId,
    payload,
    run: async (connection, req) => {
      if (!canProvision(connection, input.connectionRevision)) return
      await payload.update({
        collection: 'feishu-connections',
        data: {
          lastErrorCode: provisioningErrorCode(error),
          ...(finalAttempt ? { status: 'error' as const } : {}),
        },
        id: input.connectionId,
        overrideAccess: true,
        req,
      })
    },
  }).catch(() => undefined)
}

export const enqueueFeishuConnectionProvisionJob = async ({
  connection,
  payload,
}: {
  connection: UnknownRecord
  payload: Payload
}) => {
  const connectionId = numericId(connection.id, 'connectionId')
  const connectionRevision = requiredString(connection.lastConnectedAt, 'connectionRevision')
  return new PayloadJobQueue({ payload }).enqueue({
    idempotencyKey: `${connectionId}:${connectionRevision}`,
    payload: { connectionId, connectionRevision },
    type: FEISHU_CONNECTION_PROVISION_JOB_TYPE,
  })
}

export const enqueuePendingFeishuConnectionProvisionJobs = async ({
  payload,
}: {
  payload: Payload
}): Promise<ProvisionCounts> => {
  const result: ProvisionCounts = { created: 0, duplicate: 0 }
  let page = 1
  while (true) {
    const connections = await payload.find({
      collection: 'feishu-connections',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      page,
      sort: 'id',
      where: { status: { equals: 'provisioning' } },
    })
    for (const connection of connections.docs) {
      const enqueued = await enqueueFeishuConnectionProvisionJob({
        connection: connection as unknown as UnknownRecord,
        payload,
      })
      result[enqueued.state] += 1
    }
    if (!connections.hasNextPage) break
    page += 1
  }
  return result
}

export const createFeishuConnectionProvisionJobHandler =
  ({
    accessToken = (connectionId, signal) =>
      new PayloadFeishuTokenProvider({ connectionId, payload }).getToken('base', signal),
    createBase = createFeishuCRMBase,
    createTable = createFeishuCRMTable,
    payload,
  }: {
    accessToken?: (connectionId: number | string, signal?: AbortSignal) => Promise<string>
    createBase?: typeof createFeishuCRMBase
    createTable?: typeof createFeishuCRMTable
    payload: Payload
  }): JobHandler =>
  async (job, execution) => {
    const input = parseProvisionPayload(job.payload)
    let connection = await findConnection(payload, input.connectionId)
    if (!canProvision(connection, input.connectionRevision)) return

    try {
      const token = await accessToken(input.connectionId, execution.signal)
      execution.assertLease()
      if (!optionalString(connection.appToken) || !optionalString(connection.baseURL)) {
        const base = await createBase({ accessToken: token, signal: execution.signal })
        execution.assertLease()
        const persisted = await persistBase({ ...base, input, payload })
        if (!persisted) return
        connection = persisted
      }

      const appToken = requiredString(connection.appToken, 'appToken')
      if (!optionalString(connection.tableId)) {
        const table = await createTable({
          accessToken: token,
          appToken,
          signal: execution.signal,
        })
        execution.assertLease()
        const persisted = await persistTable({ input, payload, tableId: table.tableId })
        if (!persisted) return
        connection = persisted
      }

      requiredString(connection.tableId, 'tableId')
      execution.assertLease()
      await finalizeProvisioning({ input, payload })
      execution.assertLease()
    } catch (error) {
      await recordProvisioningFailure({
        error,
        finalAttempt: job.attempts >= job.maxAttempts,
        input,
        payload,
      })
      throw sanitizedProvisioningError(error)
    }
  }
