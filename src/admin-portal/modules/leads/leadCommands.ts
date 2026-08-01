import type { Payload, PayloadRequest } from 'payload'

import type { UserRole } from '@/access/roles'

type RecordValue = Record<string, unknown>
type LeadStatus = 'contacted' | 'disqualified' | 'new' | 'qualified'
type IntentLevel = 'a' | 'b' | 'c' | 'unscored'
type Locale = 'ar' | 'en'

const statuses = new Set<LeadStatus>(['new', 'contacted', 'qualified', 'disqualified'])
const intentLevels = new Set<IntentLevel>(['unscored', 'a', 'b', 'c'])

export class LeadCommandError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message)
    this.name = 'LeadCommandError'
  }
}

const asRecord = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}

const string = (input: RecordValue, key: string, required = false, max = 5_000): string => {
  const raw = input[key]
  if (raw === undefined || raw === null) {
    if (required) throw new LeadCommandError('leads-invalid-input', `${key} is required`, 400)
    return ''
  }
  if (typeof raw !== 'string') throw new LeadCommandError('leads-invalid-input', `${key} must be a string`, 400)
  const value = raw.trim()
  if (required && !value) throw new LeadCommandError('leads-invalid-input', `${key} is required`, 400)
  if (value.length > max) throw new LeadCommandError('leads-invalid-input', `${key} is too long`, 400)
  return value
}

const optionalID = (input: RecordValue, key: string): number | null => {
  const raw = input[key]
  if (raw === undefined || raw === null || raw === '') return null
  const id = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10)
  if (!Number.isSafeInteger(id) || id <= 0) throw new LeadCommandError('leads-invalid-input', `${key} must be a positive id`, 400)
  return id
}

const relationID = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' && Number.isSafeInteger(id)) return id
  }
  return null
}

const result = (lead: RecordValue) => ({
  id: lead.id as number | string,
  updatedAt: String(lead.updatedAt),
})

const requireAdmin = (role: UserRole) => {
  if (role !== 'admin') throw new LeadCommandError('leads-admin-required', 'Administrator access required', 403)
}

const validateSource = async (payload: Payload, req: PayloadRequest, id: number) => {
  const source = await payload.findByID({ collection: 'lead-sources', depth: 0, id, overrideAccess: false, req })
  if (!source || !source.isActive) throw new LeadCommandError('leads-invalid-source', 'An active lead source is required', 400)
  return id
}

const validateAssignee = async (payload: Payload, req: PayloadRequest, id: number | null) => {
  if (id === null) return null
  const user = await payload.findByID({ collection: 'users', depth: 0, id, overrideAccess: false, req })
  if (!user) throw new LeadCommandError('leads-invalid-assignee', 'Assigned user was not found', 400)
  return id
}

const createData = async ({ input, payload, req }: { input: RecordValue; payload: Payload; req: PayloadRequest }) => {
  const locale = string(input, 'locale', true, 2) as Locale
  if (locale !== 'en' && locale !== 'ar') throw new LeadCommandError('leads-invalid-locale', 'locale must be en or ar', 400)
  const sourceID = optionalID(input, 'sourceId')
  if (!sourceID) throw new LeadCommandError('leads-invalid-source', 'sourceId is required', 400)
  const idempotencyKey = string(input, 'idempotencyKey', true, 200)
  const status = (string(input, 'status') || 'new') as LeadStatus
  const intentLevel = (string(input, 'intentLevel') || 'unscored') as IntentLevel
  if (!statuses.has(status)) throw new LeadCommandError('leads-invalid-status', 'Unsupported lead status', 400)
  if (!intentLevels.has(intentLevel)) throw new LeadCommandError('leads-invalid-intent', 'Unsupported intent level', 400)
  const assignedTo = await validateAssignee(payload, req, optionalID(input, 'assignedToId'))
  return {
    assignedTo,
    company: string(input, 'company', false, 160) || null,
    country: string(input, 'country', true, 120),
    email: string(input, 'email', true, 254),
    idempotencyKey,
    interest: string(input, 'interest', false, 160) || null,
    intentLevel,
    locale,
    message: string(input, 'message', true, 5_000),
    name: string(input, 'name', true, 120),
    phone: string(input, 'phone', false, 32) || null,
    requestId: `portal-lead:${idempotencyKey}`,
    source: await validateSource(payload, req, sourceID),
    status,
  }
}

export const createPortalLead = async ({ input, payload, req, role }: { input: RecordValue; payload: Payload; req: PayloadRequest; role: UserRole }) => {
  requireAdmin(role)
  const data = await createData({ input, payload, req })
  const existing = await payload.find({ collection: 'leads', depth: 0, limit: 1, overrideAccess: false, req, where: { idempotencyKey: { equals: data.idempotencyKey } } })
  if (existing.docs[0]) return result(existing.docs[0] as unknown as RecordValue)
  const created = await payload.create({ collection: 'leads', data, overrideAccess: false, req })
  return result(created as unknown as RecordValue)
}

const updateData = async ({
  current,
  input,
  payload,
  req,
  role,
}: {
  current: RecordValue
  input: RecordValue
  payload: Payload
  req: PayloadRequest
  role: UserRole
}) => {
  const data: RecordValue = {}
  for (const [key, max] of [['name', 120], ['company', 160], ['country', 120], ['email', 254], ['phone', 32], ['interest', 160], ['message', 5_000]] as const) {
    if (key in input) data[key] = string(input, key, key === 'name' || key === 'country' || key === 'email' || key === 'message', max) || null
  }
  if ('status' in input) {
    const status = string(input, 'status') as LeadStatus
    if (!statuses.has(status)) throw new LeadCommandError('leads-invalid-status', 'Unsupported lead status', 400)
    data.status = status
  }
  if ('intentLevel' in input) {
    const intentLevel = string(input, 'intentLevel') as IntentLevel
    if (!intentLevels.has(intentLevel)) throw new LeadCommandError('leads-invalid-intent', 'Unsupported intent level', 400)
    data.intentLevel = intentLevel
  }
  if ('sourceId' in input) {
    const sourceID = optionalID(input, 'sourceId')
    if (!sourceID) throw new LeadCommandError('leads-invalid-source', 'sourceId is required', 400)
    if (role === 'sales') {
      if (sourceID !== relationID(current.source)) {
        throw new LeadCommandError('leads-source-forbidden', 'Sales cannot change lead sources', 403)
      }
    } else {
      data.source = await validateSource(payload, req, sourceID)
    }
  }
  if ('assignedToId' in input) {
    const assignedTo = optionalID(input, 'assignedToId')
    if (role === 'sales') {
      if (assignedTo !== relationID(current.assignedTo)) {
        throw new LeadCommandError('leads-assignment-forbidden', 'Sales cannot assign leads', 403)
      }
    } else {
      data.assignedTo = await validateAssignee(payload, req, assignedTo)
    }
  }
  return data
}

const requireFreshLead = async ({ id, payload, req, updatedAt }: { id: number; payload: Payload; req: PayloadRequest; updatedAt: string }) => {
  const lead = await payload.findByID({ collection: 'leads', depth: 0, id, overrideAccess: false, req })
  if (!lead) throw new LeadCommandError('leads-not-found', 'Lead was not found', 404)
  if (!updatedAt || lead.updatedAt !== updatedAt) throw new LeadCommandError('leads-stale-update', 'Lead changed. Refresh before saving.', 409)
  return lead
}

export const updatePortalLead = async ({ id, input, payload, req, role }: { id: number; input: RecordValue; payload: Payload; req: PayloadRequest; role: UserRole }) => {
  const current = await requireFreshLead({ id, payload, req, updatedAt: string(input, 'updatedAt', true, 80) })
  const data = await updateData({ current: current as unknown as RecordValue, input, payload, req, role })
  if (!Object.keys(data).length) throw new LeadCommandError('leads-no-changes', 'At least one mutable field is required', 400)
  const updated = await payload.update({ collection: 'leads', data, id, overrideAccess: false, req })
  return result(updated as unknown as RecordValue)
}

export const deletePortalLead = async ({ id, input, payload, req, role }: { id: number; input: RecordValue; payload: Payload; req: PayloadRequest; role: UserRole }) => {
  requireAdmin(role)
  await requireFreshLead({ id, payload, req, updatedAt: string(input, 'updatedAt', true, 80) })
  await payload.delete({ collection: 'leads', id, overrideAccess: false, req })
  return { id }
}

export const mapLeadEditor = (lead: RecordValue) => ({
  assignedToId: typeof lead.assignedTo === 'number' ? String(lead.assignedTo) : '',
  company: typeof lead.company === 'string' ? lead.company : '',
  country: typeof lead.country === 'string' ? lead.country : '',
  email: typeof lead.email === 'string' ? lead.email : '',
  id: lead.id as number | string,
  interest: typeof lead.interest === 'string' ? lead.interest : '',
  intentLevel: String(lead.intentLevel ?? 'unscored'),
  locale: String(lead.locale ?? 'en'),
  message: typeof lead.message === 'string' ? lead.message : '',
  name: typeof lead.name === 'string' ? lead.name : '',
  phone: typeof lead.phone === 'string' ? lead.phone : '',
  sourceId: typeof lead.source === 'number' ? String(lead.source) : '',
  status: String(lead.status ?? 'new'),
  updatedAt: String(lead.updatedAt ?? ''),
})

export const asLeadRecord = asRecord
