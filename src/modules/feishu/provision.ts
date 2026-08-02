import { FeishuApiError } from './contracts'

type FetchLike = typeof fetch
type JsonRecord = Record<string, unknown>

export const DEFAULT_FEISHU_FIELD_MAPPINGS = [
  { localField: 'localLeadId', required: true, targetField: '系统 Lead ID' },
  { localField: 'customerName', required: true, targetField: '客户名称' },
  { localField: 'country', required: true, targetField: '国家或地区' },
  { localField: 'source', required: true, targetField: '来源渠道' },
  { localField: 'sourceURL', targetField: '来源链接' },
  { localField: 'productNeed', targetField: '需求产品' },
  { localField: 'projectStage', targetField: '项目阶段' },
  { localField: 'intentLevel', targetField: 'AI 意向等级' },
  { localField: 'owner', targetField: '负责人' },
  { localField: 'email', required: true, targetField: '邮箱' },
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
  path,
  signal,
}: {
  accessToken: string
  body: unknown
  fetch: FetchLike
  path: string
  signal?: AbortSignal
}): Promise<JsonRecord> => {
  const response = await fetchImpl(`https://open.feishu.cn${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    method: 'POST',
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
}): Promise<{ appToken: string; baseURL: string }> => {
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
  if (!appToken || !baseURL) {
    throw new FeishuApiError({
      code: 'invalid_base_create_response',
      message: 'Feishu Base creation response is incomplete',
      retryable: false,
    })
  }

  return { appToken, baseURL }
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
}): Promise<{ appToken: string; baseURL: string; tableId: string }> => {
  const base = await createFeishuCRMBase({ accessToken, baseName, fetch: fetchImpl, signal })
  const table = await createFeishuCRMTable({
    accessToken,
    appToken: base.appToken,
    fetch: fetchImpl,
    signal,
  })
  return { ...base, ...table }
}
