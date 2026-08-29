import { FeishuApiError } from './contracts'

type FetchLike = typeof fetch
type JsonRecord = Record<string, unknown>

export const DEFAULT_FEISHU_FIELD_MAPPINGS = [
  { localField: 'localLeadId', required: true, targetField: '系统 Lead ID' },
  { localField: 'customerName', required: true, targetField: '客户名称' },
  { localField: 'country', required: false, targetField: '国家或地区' },
  { localField: 'source', required: true, targetField: '来源渠道' },
  { localField: 'sourceURL', targetField: '来源链接' },
  { localField: 'productNeed', targetField: '需求产品' },
  { localField: 'projectStage', targetField: '项目阶段' },
  { localField: 'intentLevel', targetField: 'AI 意向等级' },
  { localField: 'owner', targetField: '负责人' },
  { localField: 'email', required: false, targetField: '邮箱' },
  { localField: 'phone', targetField: '电话' },
  { localField: 'nextFollowUpAt', targetField: '下次跟进时间' },
  { localField: 'originalInquiry', required: true, targetField: '原始咨询' },
] as const

const CRM_FIELDS = [
  ...DEFAULT_FEISHU_FIELD_MAPPINGS.filter(({ localField }) => localField !== 'nextFollowUpAt').map(
    ({ targetField }) => ({ field_name: targetField, type: 1 }),
  ),
  {
    field_name: '人工客户等级',
    property: { options: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] },
    type: 3,
  },
  { field_name: '下次跟进时间', property: { date_formatter: 'yyyy/MM/dd HH:mm' }, type: 5 },
  { field_name: '最近跟进时间', property: { date_formatter: 'yyyy/MM/dd HH:mm' }, type: 5 },
]

const record = (value: unknown): JsonRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined
const string = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined
const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const request = async ({
  accessToken,
  body,
  fetch: fetchImpl,
  method = 'POST',
  path,
  signal,
}: {
  accessToken: string
  body?: unknown
  fetch: FetchLike
  method?: 'DELETE' | 'GET' | 'POST'
  path: string
  signal?: AbortSignal
}): Promise<JsonRecord> => {
  const response = await fetchImpl(`https://open.feishu.cn${path}`, {
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    method,
    signal,
  })
  const responseBody = record(await response.json().catch(() => undefined)) ?? {}
  if (!response.ok || number(responseBody.code) !== 0) {
    const code = number(responseBody.code) ?? response.status
    throw new FeishuApiError({
      code,
      message: string(responseBody.msg) ?? 'Feishu Base provisioning failed',
      retryable: response.status >= 500 || response.status === 429 || code === 1254290,
      status: response.status,
    })
  }
  return responseBody
}

export const createFeishuCRMBase = async ({
  accessToken,
  baseName = 'IVYBM 客户管理',
  fetch: fetchImpl = globalThis.fetch,
  signal,
}: {
  accessToken: string
  baseName?: string
  fetch?: FetchLike
  signal?: AbortSignal
}): Promise<{ appToken: string; baseURL: string; defaultTableId?: string }> => {
  const created = await request({
    accessToken,
    body: { name: baseName, time_zone: 'Asia/Shanghai' },
    fetch: fetchImpl,
    path: '/open-apis/bitable/v1/apps',
    signal,
  })
  const app = record(record(created.data)?.app)
  const appToken = string(app?.app_token)
  const baseURL = string(app?.url)
  const defaultTableId = string(app?.default_table_id) ?? string(record(created.data)?.default_table_id)
  if (!appToken || !baseURL) {
    throw new FeishuApiError({
      code: 'invalid_base_create_response',
      message: 'Feishu Base creation response is incomplete',
      retryable: false,
    })
  }

  return { appToken, baseURL, ...(defaultTableId ? { defaultTableId } : {}) }
}

export const createFeishuCRMTable = async ({
  accessToken,
  appToken,
  fetch: fetchImpl = globalThis.fetch,
  signal,
}: {
  accessToken: string
  appToken: string
  fetch?: FetchLike
  signal?: AbortSignal
}): Promise<{ tableId: string }> => {
  const table = await request({
    accessToken,
    body: {
      table: {
        default_view_name: '全部客户',
        fields: CRM_FIELDS,
        name: '客户档案',
      },
    },
    fetch: fetchImpl,
    path: `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`,
    signal,
  })
  const tableId = string(record(table.data)?.table_id)
  if (!tableId) {
    throw new FeishuApiError({
      code: 'invalid_table_create_response',
      message: 'Feishu table creation response is incomplete',
      retryable: false,
    })
  }
  return { tableId }
}

export type FeishuBaseTableRef = {
  name: string
  tableId: string
}

const FEISHU_DEFAULT_TABLE_NAME_PATTERNS = [
  /^数据表(?:\s*\d+)?$/i,
  /^默认数据表(?:\s*\d+)?$/i,
  /^Table(?:\s*\d+)?$/i,
  /^Sheet(?:\s*\d+)?$/i,
]

export const isFeishuDefaultTableName = (name: string): boolean => {
  const trimmed = name.trim()
  return Boolean(trimmed && FEISHU_DEFAULT_TABLE_NAME_PATTERNS.some((pattern) => pattern.test(trimmed)))
}

export const listFeishuCRMTables = async ({
  accessToken,
  appToken,
  fetch: fetchImpl = globalThis.fetch,
  signal,
}: {
  accessToken: string
  appToken: string
  fetch?: FetchLike
  signal?: AbortSignal
}): Promise<FeishuBaseTableRef[]> => {
  const tables: FeishuBaseTableRef[] = []
  let pageToken = ''
  do {
    const query = pageToken
      ? `?page_size=100&page_token=${encodeURIComponent(pageToken)}`
      : '?page_size=100'
    const page = await request({
      accessToken,
      fetch: fetchImpl,
      method: 'GET',
      path: `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables${query}`,
      signal,
    })
    const data = record(page.data) ?? {}
    const items = Array.isArray(data.items) ? data.items : []
    for (const item of items) {
      const entry = record(item)
      const tableId = string(entry?.table_id)
      if (tableId) tables.push({ name: string(entry?.name) ?? '', tableId })
    }
    pageToken = data.has_more === true ? (string(data.page_token) ?? '') : ''
  } while (pageToken)
  return tables
}

export const feishuCRMTableIsEmpty = async ({
  accessToken,
  appToken,
  fetch: fetchImpl = globalThis.fetch,
  signal,
  tableId,
}: {
  accessToken: string
  appToken: string
  fetch?: FetchLike
  signal?: AbortSignal
  tableId: string
}): Promise<boolean> => {
  const result = await request({
    accessToken,
    fetch: fetchImpl,
    method: 'GET',
    path: `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?page_size=1`,
    signal,
  })
  const data = record(result.data) ?? {}
  const total = number(data.total)
  if (total !== undefined) return total === 0
  return !Array.isArray(data.items) || data.items.length === 0
}

export const deleteFeishuCRMTable = async ({
  accessToken,
  appToken,
  fetch: fetchImpl = globalThis.fetch,
  signal,
  tableId,
}: {
  accessToken: string
  appToken: string
  fetch?: FetchLike
  signal?: AbortSignal
  tableId: string
}): Promise<void> => {
  await request({
    accessToken,
    fetch: fetchImpl,
    method: 'DELETE',
    path: `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}`,
    signal,
  })
}

/**
 * A Feishu Base created through the API always ships with an auto-generated
 * empty default table next to our 客户档案 table.
 *
 * To avoid deleting custom empty tables created by users, we strictly only
 * delete tables that:
 * 1. Are not the CRM table (tableId !== keepTableId)
 * 2. Match a known Feishu default table name (e.g. "数据表", "默认数据表", "Table 1")
 *    OR match the defaultTableId explicitly passed from Base creation
 * 3. Have 0 records (feishuCRMTableIsEmpty)
 *
 * Cleanup is best-effort: any network or API error (including table listing)
 * is caught to prevent failing the primary provisioning flow.
 */
export const cleanupFeishuDefaultTables = async ({
  accessToken,
  appToken,
  defaultTableId,
  fetch: fetchImpl = globalThis.fetch,
  keepTableId,
  signal,
}: {
  accessToken: string
  appToken: string
  defaultTableId?: string
  fetch?: FetchLike
  keepTableId: string
  signal?: AbortSignal
}): Promise<{ deletedTableIds: string[] }> => {
  const deletedTableIds: string[] = []
  try {
    const tables = await listFeishuCRMTables({ accessToken, appToken, fetch: fetchImpl, signal })
    for (const table of tables) {
      if (table.tableId === keepTableId) continue
      const isDefaultCandidate =
        (defaultTableId && table.tableId === defaultTableId) ||
        isFeishuDefaultTableName(table.name)
      if (!isDefaultCandidate) continue

      try {
        const empty = await feishuCRMTableIsEmpty({
          accessToken,
          appToken,
          fetch: fetchImpl,
          signal,
          tableId: table.tableId,
        })
        if (!empty) continue
        await deleteFeishuCRMTable({
          accessToken,
          appToken,
          fetch: fetchImpl,
          signal,
          tableId: table.tableId,
        })
        deletedTableIds.push(table.tableId)
      } catch {
        // Cleanup is cosmetic: a stranded empty default table never blocks provisioning.
      }
    }
  } catch {
    // Listing tables failure is caught: cosmetic cleanup must never throw or block provisioning.
  }
  return { deletedTableIds }
}

export const provisionFeishuCRM = async ({
  accessToken,
  baseName,
  fetch: fetchImpl = globalThis.fetch,
  signal,
}: {
  accessToken: string
  baseName?: string
  fetch?: FetchLike
  signal?: AbortSignal
}): Promise<{ appToken: string; baseURL: string; defaultTableId?: string; tableId: string }> => {
  const base = await createFeishuCRMBase({ accessToken, baseName, fetch: fetchImpl, signal })
  const table = await createFeishuCRMTable({
    accessToken,
    appToken: base.appToken,
    fetch: fetchImpl,
    signal,
  })
  await cleanupFeishuDefaultTables({
    accessToken,
    appToken: base.appToken,
    defaultTableId: base.defaultTableId,
    fetch: fetchImpl,
    keepTableId: table.tableId,
    signal,
  })
  return { ...base, ...table }
}
