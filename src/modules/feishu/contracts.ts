export const FEISHU_LEAD_FIELDS = [
  'localLeadId',
  'customerName',
  'country',
  'source',
  'productNeed',
  'projectStage',
  'intentLevel',
  'owner',
  'email',
  'phone',
  'sourceURL',
  'originalInquiry',
] as const

export type FeishuLeadField = (typeof FEISHU_LEAD_FIELDS)[number]

export type FeishuFieldMapping = {
  localField: FeishuLeadField
  required?: boolean | null
  targetField: string
}

export type FeishuNotificationRecipient = {
  enabled?: boolean | null
  label?: string | null
  receiveId: string
  receiveIdType: 'chat_id' | 'open_id'
}

export type FeishuMemberMapping = {
  enabled?: boolean | null
  openId: string
  userId: number | string
}

export type FeishuMappingConfig = {
  appToken: string
  connectionId?: number | string
  fieldMappings: FeishuFieldMapping[]
  id: number | string
  key: string
  memberMappings: FeishuMemberMapping[]
  notificationRecipients: FeishuNotificationRecipient[]
  revision: string
  tableId: string
}

export type FeishuAccessTokenPurpose = 'base' | 'im'
export type FeishuAccessTokenProvider = (
  purpose: FeishuAccessTokenPurpose,
  signal?: AbortSignal,
  forceRefresh?: boolean,
) => Promise<string>

export type LeadForFeishu = {
  assignedTo?: number | string | { email?: string | null; id: number | string } | null
  company?: string | null
  country: string
  email: string
  id: number | string
  intentLevel: 'a' | 'b' | 'c' | 'unscored'
  interest?: string | null
  message: string
  name: string
  phone?: string | null
  requestId: string
  source: number | string | { id: number | string; key?: string | null; label?: string | null }
  status: 'contacted' | 'disqualified' | 'new' | 'qualified'
  sourceURL?: string | null
}

export type HandoffForFeishu = {
  conversationPublicId: string
  domainEventId: string
  publicId: string
  reason: string
  requestedAt: string
  source: 'ai_policy' | 'operator' | 'visitor'
}

export type FeishuUpsertRecordInput = {
  appToken: string
  fields: Record<string, string>
  localLeadId: string
  localLeadIdField: string
  signal?: AbortSignal
  tableId: string
}

export type FeishuSendTextInput = {
  idempotencyKey: string
  receiveId: string
  receiveIdType: 'chat_id' | 'open_id'
  signal?: AbortSignal
  text: string
}

export interface FeishuClientPort {
  sendText: (input: FeishuSendTextInput) => Promise<{ messageId: string }>
  upsertRecord: (
    input: FeishuUpsertRecordInput,
  ) => Promise<{ recordId: string; state: 'created' | 'updated' }>
}

export class FeishuConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeishuConfigurationError'
  }
}

export class FeishuApiError extends Error {
  readonly code: number | string
  readonly retryable: boolean
  readonly status?: number

  constructor({
    code,
    message,
    retryable,
    status,
  }: {
    code: number | string
    message: string
    retryable: boolean
    status?: number
  }) {
    super(message)
    this.code = code
    this.retryable = retryable
    this.status = status
    this.name = 'FeishuApiError'
  }
}
