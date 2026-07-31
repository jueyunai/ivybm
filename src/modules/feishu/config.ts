import type { Payload } from 'payload'

import {
  FEISHU_LEAD_FIELDS,
  FeishuConfigurationError,
  type FeishuFieldMapping,
  type FeishuLeadField,
  type FeishuMappingConfig,
  type FeishuMemberMapping,
  type FeishuNotificationRecipient,
} from './contracts'
import { validateFeishuMapping } from './mapLead'

type UnknownRecord = Record<string, unknown>

const record = (value: unknown): UnknownRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : undefined

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new FeishuConfigurationError(`Feishu mapping ${field} is required`)
  }
  return value.trim()
}

const fieldMapping = (value: unknown): FeishuFieldMapping => {
  const item = record(value)
  const localField = item?.localField
  if (!FEISHU_LEAD_FIELDS.some((field) => field === localField)) {
    throw new FeishuConfigurationError('Feishu mapping contains an unknown local field')
  }
  return {
    localField: localField as FeishuLeadField,
    required: item?.required === true,
    targetField: requiredString(item?.targetField, 'targetField'),
  }
}

const recipient = (value: unknown): FeishuNotificationRecipient => {
  const item = record(value)
  const receiveIdType = item?.receiveIdType
  if (receiveIdType !== 'chat_id' && receiveIdType !== 'open_id') {
    throw new FeishuConfigurationError('Feishu notification recipient type is invalid')
  }
  return {
    enabled: item?.enabled !== false,
    label: typeof item?.label === 'string' ? item.label.trim() : undefined,
    receiveId: requiredString(item?.receiveId, 'notification receiveId'),
    receiveIdType,
  }
}

const relationshipID = (value: unknown): number | string | undefined => {
  if (typeof value === 'number' || typeof value === 'string') return value
  const item = record(value)
  return typeof item?.id === 'number' || typeof item?.id === 'string' ? item.id : undefined
}

const memberMapping = (value: unknown): FeishuMemberMapping => {
  const item = record(value)
  const userId = relationshipID(item?.user)
  if (userId === undefined) {
    throw new FeishuConfigurationError('Feishu member mapping user is required')
  }
  return {
    enabled: item?.enabled !== false,
    openId: requiredString(item?.openId, 'member openId'),
    userId,
  }
}

export const parseFeishuMappingConfig = (value: unknown): FeishuMappingConfig => {
  const document = record(value)
  if (!document) throw new FeishuConfigurationError('Feishu mapping document is invalid')
  const id = document.id
  if (typeof id !== 'number' && typeof id !== 'string') {
    throw new FeishuConfigurationError('Feishu mapping id is required')
  }
  const mapping: FeishuMappingConfig = {
    appToken: requiredString(document.appToken, 'appToken'),
    ...(relationshipID(document.connection) !== undefined
      ? { connectionId: relationshipID(document.connection) }
      : {}),
    fieldMappings: Array.isArray(document.fieldMappings)
      ? document.fieldMappings.map(fieldMapping)
      : [],
    id,
    key: requiredString(document.key, 'key'),
    memberMappings: Array.isArray(document.memberMappings)
      ? document.memberMappings.map(memberMapping)
      : [],
    notificationRecipients: Array.isArray(document.notificationRecipients)
      ? document.notificationRecipients.map(recipient)
      : [],
    revision: requiredString(document.updatedAt, 'updatedAt'),
    tableId: requiredString(document.tableId, 'tableId'),
  }
  validateFeishuMapping(mapping)
  const memberUsers = new Set<string>()
  const memberOpenIds = new Set<string>()
  for (const member of mapping.memberMappings.filter((item) => item.enabled !== false)) {
    const userId = String(member.userId)
    if (memberUsers.has(userId)) {
      throw new FeishuConfigurationError(`Duplicate Feishu member mapping user: ${userId}`)
    }
    if (memberOpenIds.has(member.openId)) {
      throw new FeishuConfigurationError(`Duplicate Feishu member open_id: ${member.openId}`)
    }
    memberUsers.add(userId)
    memberOpenIds.add(member.openId)
  }
  if (mapping.notificationRecipients.filter((item) => item.enabled !== false).length === 0) {
    throw new FeishuConfigurationError('An active Feishu mapping requires a notification recipient')
  }
  return mapping
}

export const findActiveFeishuMapping = async (
  payload: Payload,
): Promise<FeishuMappingConfig | null> => {
  const result = await payload.find({
    collection: 'feishu-mappings',
    depth: 0,
    limit: 2,
    overrideAccess: true,
    sort: 'id',
    where: { status: { equals: 'active' } },
  })
  if (result.totalDocs === 0) return null
  if (result.totalDocs > 1) {
    throw new FeishuConfigurationError('Only one Feishu mapping may be active')
  }
  return parseFeishuMappingConfig(result.docs[0])
}
