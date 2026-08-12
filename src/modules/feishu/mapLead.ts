import {
  FEISHU_LEAD_FIELDS,
  FeishuConfigurationError,
  type FeishuLeadField,
  type FeishuFieldValue,
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

const followUpTimestamp = (value: string | null | undefined): number | string => {
  if (!value) return ''
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new FeishuConfigurationError('Lead nextFollowUpAt is invalid')
  }
  return timestamp
}

const originalInquiry = (lead: LeadForFeishu): string => {
  const qualification = [
    ['Project stage', lead.projectStage],
    ['Quantity (sqm)', lead.quantitySquareMeters],
    [
      'Drawings available',
      lead.hasDrawings === null || lead.hasDrawings === undefined
        ? null
        : lead.hasDrawings
          ? 'Yes'
          : 'No',
    ],
    ['Budget', lead.budget],
    ['Procurement plan', lead.procurementPlan],
    ['Purchase timeline', lead.timeline],
  ]
    .filter(
      (entry): entry is [string, number | string] =>
        entry[1] !== null && entry[1] !== undefined && entry[1] !== '',
    )
    .map(([label, value]) => `${label}: ${String(value)}`)

  return qualification.length > 0
    ? `${lead.message.trim()}\n\nQualification:\n${qualification.join('\n')}`
    : lead.message.trim()
}

const leadValues = (lead: LeadForFeishu): Record<FeishuLeadField, FeishuFieldValue> => ({
  country: lead.country.trim(),
  customerName: (lead.company || lead.name).trim(),
  email: lead.email.trim(),
  intentLevel: lead.intentLevel.toUpperCase(),
  localLeadId: String(lead.id),
  nextFollowUpAt: followUpTimestamp(lead.nextFollowUpAt),
  owner: relationshipLabel(lead.assignedTo),
  originalInquiry: originalInquiry(lead),
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
}): { fields: Record<string, FeishuFieldValue>; localLeadIdField: string } => {
  validateFeishuMapping(mapping)
  const values = leadValues(lead)
  const fields: Record<string, FeishuFieldValue> = {}
  let localLeadIdField = ''

  for (const item of mapping.fieldMappings) {
    const target = item.targetField.trim()
    const value = values[item.localField]
    if (item.required && value === '') {
      throw new FeishuConfigurationError(`Lead field ${item.localField} is required by the mapping`)
    }
    if (value !== '') fields[target] = value
    if (item.localField === 'localLeadId') localLeadIdField = target
  }

  return { fields, localLeadIdField }
}
