import { createHash } from 'node:crypto'

import {
  FeishuApiError,
  FeishuConfigurationError,
  type FeishuAccessTokenProvider,
  type FeishuAccessTokenPurpose,
  type FeishuClientPort,
  type FeishuSendTextInput,
  type FeishuUpsertRecordInput,
} from './contracts'

type JsonRecord = Record<string, unknown>
type FetchLike = typeof fetch

const TOKEN_INVALID_CODES = new Set([99991661, 99991663])
const RETRYABLE_CODES = new Set([1254290, 99991400, 99991401])

const record = (value: unknown): JsonRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined

const string = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const readJson = async (response: Response): Promise<JsonRecord> => {
  const body = await response.json().catch(() => undefined)
  return record(body) ?? {}
}

const apiError = ({ body, response }: { body: JsonRecord; response: Response }): FeishuApiError => {
  const code = number(body.code) ?? response.status
  const message =
    string(body.msg) ?? string(body.message) ?? `Feishu API request failed (${response.status})`
  return new FeishuApiError({
    code,
    message,
    retryable:
      response.status === 429 || response.status >= 500 || RETRYABLE_CODES.has(Number(code)),
    status: response.status,
  })
}

const encodePath = (value: string): string => encodeURIComponent(value.trim())

const idempotencyUUID = (value: string): string => {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`
}

export class FeishuClient implements FeishuClientPort {
  private readonly appId?: string
  private readonly appSecret?: string
  private readonly baseUrl: string
  private readonly fetch: FetchLike
  private readonly tokenProvider?: FeishuAccessTokenProvider
  private token?: { expiresAt: number; value: string }

  constructor({
    appId,
    appSecret,
    baseUrl = 'https://open.feishu.cn',
    fetch: fetchImpl = globalThis.fetch,
    tokenProvider,
  }: {
    appId?: string
    appSecret?: string
    baseUrl?: string
    fetch?: FetchLike
    tokenProvider?: FeishuAccessTokenProvider
  }) {
    this.appId = appId?.trim()
    this.appSecret = appSecret?.trim()
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.fetch = fetchImpl
    this.tokenProvider = tokenProvider
    if (!this.tokenProvider && (!this.appId || !this.appSecret)) {
      throw new FeishuConfigurationError('FEISHU_APP_ID and FEISHU_APP_SECRET are required')
    }
  }

  private async tenantToken(signal?: AbortSignal): Promise<string> {
    if (this.tokenProvider) return this.tokenProvider('im', signal)
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value

    const response = await this.fetch(
      `${this.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        signal,
      },
    )
    const body = await readJson(response)
    if (!response.ok || number(body.code) !== 0) throw apiError({ body, response })

    const token = string(body.tenant_access_token)
    if (!token) {
      throw new FeishuApiError({
        code: 'invalid_response',
        message: 'Feishu token response did not include tenant_access_token',
        retryable: false,
        status: response.status,
      })
    }
    const expiresIn = number(body.expire) ?? 7_200
    this.token = { expiresAt: Date.now() + expiresIn * 1_000, value: token }
    return token
  }

  private async authenticatedRequest({
    body,
    method,
    path,
    purpose,
    signal,
  }: {
    body: unknown
    method: 'POST' | 'PUT'
    path: string
    purpose: FeishuAccessTokenPurpose
    signal?: AbortSignal
  }): Promise<JsonRecord> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = this.tokenProvider
        ? await this.tokenProvider(purpose, signal, attempt > 0)
        : await this.tenantToken(signal)
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        method,
        signal,
      })
      const responseBody = await readJson(response)
      const code = number(responseBody.code)
      if (response.ok && code === 0) return responseBody
      if (attempt === 0 && code !== undefined && TOKEN_INVALID_CODES.has(code)) {
        if (!this.tokenProvider) this.token = undefined
        continue
      }
      throw apiError({ body: responseBody, response })
    }
    throw new FeishuApiError({
      code: 'token_refresh_failed',
      message: 'Feishu token refresh failed',
      retryable: true,
    })
  }

  async upsertRecord({
    appToken,
    fields,
    localLeadId,
    localLeadIdField,
    signal,
    tableId,
  }: FeishuUpsertRecordInput): Promise<{ recordId: string; state: 'created' | 'updated' }> {
    const recordsPath = `/open-apis/bitable/v1/apps/${encodePath(appToken)}/tables/${encodePath(tableId)}/records`
    const searched = await this.authenticatedRequest({
      body: {
        filter: {
          conditions: [{ field_name: localLeadIdField, operator: 'is', value: [localLeadId] }],
          conjunction: 'and',
        },
        page_size: 2,
      },
      method: 'POST',
      path: `${recordsPath}/search`,
      purpose: 'base',
      signal,
    })
    const items = record(searched.data)?.items
    const records = Array.isArray(items)
      ? items.map(record).filter((item) => item !== undefined)
      : []
    if (records.length > 1) {
      throw new FeishuApiError({
        code: 'duplicate_local_lead_id',
        message: `Feishu contains multiple records for local lead ${localLeadId}`,
        retryable: false,
      })
    }

    const existingId = string(records[0]?.record_id)
    const result = await this.authenticatedRequest({
      body: { fields },
      method: existingId ? 'PUT' : 'POST',
      path: existingId ? `${recordsPath}/${encodePath(existingId)}` : recordsPath,
      purpose: 'base',
      signal,
    })
    const recordId = string(record(record(result.data)?.record)?.record_id)
    if (!recordId) {
      throw new FeishuApiError({
        code: 'invalid_response',
        message: 'Feishu record response did not include record_id',
        retryable: false,
      })
    }
    return { recordId, state: existingId ? 'updated' : 'created' }
  }

  async sendText({
    idempotencyKey,
    receiveId,
    receiveIdType,
    signal,
    text,
  }: FeishuSendTextInput): Promise<{ messageId: string }> {
    const response = await this.authenticatedRequest({
      body: {
        content: JSON.stringify({ text }),
        msg_type: 'text',
        receive_id: receiveId,
        uuid: idempotencyUUID(idempotencyKey),
      },
      method: 'POST',
      path: `/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
      purpose: 'im',
      signal,
    })
    const messageId = string(record(response.data)?.message_id)
    if (!messageId) {
      throw new FeishuApiError({
        code: 'invalid_response',
        message: 'Feishu message response did not include message_id',
        retryable: false,
      })
    }
    return { messageId }
  }
}

export const createFeishuClientFromEnv = (): FeishuClient =>
  new FeishuClient({
    appId: process.env.FEISHU_APP_ID ?? '',
    appSecret: process.env.FEISHU_APP_SECRET ?? '',
  })
