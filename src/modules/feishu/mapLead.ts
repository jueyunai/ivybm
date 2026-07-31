import {
  FEISHU_LEAD_FIELDS,
  FeishuConfigurationError,
  type FeishuLeadField,
  type FeishuMappingConfig,
  type LeadForFeishu,
} from './contracts'

const REQUIRED_FIELDS = [
  'localLeadId',
  'customerName',
  'country',
  'source',
  'intentLevel',
] as const satisfies readonly FeishuLeadField[]

const relationshipLabel = (
  value: LeadForFeishu['assignedTo'] | LeadForFeishu['source'],
): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'string') return String(value)
  if ('email' in value && value.email) return value.email
  if ('label' in value && value.label) return value.label
  if ('key' in value && value.key) return value.key
  return String(value.id)
}

const leadValues = (lead: LeadForFeishu): Record<FeishuLeadField, string> => ({
  country: lead.country.trim(),
  customerName: (lead.company || lead.name).trim(),
  email: lead.email.trim(),
  intentLevel: lead.intentLevel.toUpperCase(),
  localLeadId: String(lead.id),
  owner: relationshipLabel(lead.assignedTo),
  originalInquiry: lead.message.trim(),
  phone: lead.phone?.trim() ?? '',
  productNeed: lead.interest?.trim() ?? '',
  projectStage: lead.status,
  source: relationshipLabel(lead.source),
  sourceURL: lead.sourceURL?.trim() ?? '',
})

export const validateFeishuMapping = (mapping: FeishuMappingConfig): void => {
  if (!mapping.appToken.trim() || !mapping.tableId.trim()) {
    throw new FeishuConfigurationError('An active Feishu mapping requires appToken and tableId')
  }

  const configured = new Set<FeishuLeadField>()
  const targetFields = new Set<string>()
  for (const item of mapping.fieldMappings) {
    if (!FEISHU_LEAD_FIELDS.some((field) => field === item.localField)) {
      throw new FeishuConfigurationError(`Unknown local lead field: ${item.localField}`)
    }
    const target = item.targetField.trim()
    if (!target) {
      throw new FeishuConfigurationError(`Target field is required for ${item.localField}`)
    }
    if (configured.has(item.localField)) {
      throw new FeishuConfigurationError(`Duplicate local lead field: ${item.localField}`)
    }
    if (targetFields.has(target)) {
      throw new FeishuConfigurationError(`Duplicate Feishu target field: ${target}`)
    }
    configured.add(item.localField)
    targetFields.add(target)
  }

  const missing = REQUIRED_FIELDS.filter((field) => !configured.has(field))
  if (missing.length > 0) {
    throw new FeishuConfigurationError(
      `Missing required Feishu field mappings: ${missing.join(', ')}`,
    )
  }
}

export const mapLead = ({
  lead,
  mapping,
}: {
  lead: LeadForFeishu
  mapping: FeishuMappingConfig
}): { fields: Record<string, string>; localLeadIdField: string } => {
  validateFeishuMapping(mapping)
  const values = leadValues(lead)
  const fields: Record<string, string> = {}
  let localLeadIdField = ''

  for (const item of mapping.fieldMappings) {
    const target = item.targetField.trim()
    const value = values[item.localField]
    if (item.required && !value) {
      throw new FeishuConfigurationError(`Lead field ${item.localField} is required by the mapping`)
    }
    if (value) fields[target] = value
    if (item.localField === 'localLeadId') localLeadIdField = target
  }

  return { fields, localLeadIdField }
}
