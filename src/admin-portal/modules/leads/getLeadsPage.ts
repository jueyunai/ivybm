import type { Payload, PayloadRequest, Where } from 'payload'

import type { PortalEnvironment, PortalRole } from '@/admin-portal/core/modules/types'

import { LEADS_MODULE } from './manifest'

export const LEAD_STATUS_FILTERS = ['all', 'contacted', 'disqualified', 'new', 'qualified'] as const
export const LEAD_INTENT_FILTERS = ['all', 'a', 'b', 'c', 'unscored'] as const

export type LeadStatusFilter = (typeof LEAD_STATUS_FILTERS)[number]
export type LeadIntentFilter = (typeof LEAD_INTENT_FILTERS)[number]

export type LeadQuery = { intent: LeadIntentFilter; page: number; q: string; status: LeadStatusFilter }

export type LeadSummaryItem = {
  assignedTo: null | number
  budget: null | string
  company: null | string
  country: null | string
  email: string
  hasDrawings: boolean | null
  id: number | string
  interest: null | string
  intentLevel: 'a' | 'b' | 'c' | 'unscored'
  locale: 'ar' | 'en'
  message: string
  name: string
  phone: null | string
  procurementPlan: null | string
  projectStage: null | string
  quantitySquareMeters: null | number
  relatedConversations: Array<{ handoffStatus: string; id: string }>
  source: number
  status: 'contacted' | 'disqualified' | 'new' | 'qualified'
  timeline: null | string
  updatedAt: string
}

export type LeadOption = { id: number | string; label: string }

export type LeadsSummary = {
  items: LeadSummaryItem[]
  options: { sources: LeadOption[]; users: LeadOption[] }
  pagination: { page: number; totalDocs: number; totalPages: number }
  query: LeadQuery
}

export type LeadsPageData = {
  state: 'available' | 'forbidden' | 'module-disabled' | 'portal-disabled'
  summary: LeadsSummary | null
}

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value

export const parseLeadQuery = (input: Record<string, string | string[] | undefined>): LeadQuery => {
  const page = Number.parseInt(first(input.page) ?? '1', 10)
  const status = first(input.status)
  const intent = first(input.intent)
  return {
    intent: LEAD_INTENT_FILTERS.includes(intent as LeadIntentFilter) ? intent as LeadIntentFilter : 'all',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    q: (first(input.q) ?? '').trim().slice(0, 80),
    status: LEAD_STATUS_FILTERS.includes(status as LeadStatusFilter) ? status as LeadStatusFilter : 'all',
  }
}

const asID = (value: unknown): null | number => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'number') return (value as { id: number }).id
  return null
}

const stringOrNull = (value: unknown): null | string => typeof value === 'string' && value ? value : null
const numberOrNull = (value: unknown): null | number => typeof value === 'number' && Number.isFinite(value) ? value : null
const booleanOrNull = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null

const buildWhere = (query: LeadQuery): Where => {
  const clauses: Where[] = []
  if (query.q) clauses.push({ or: [{ name: { contains: query.q } }, { company: { contains: query.q } }, { email: { contains: query.q } }, { country: { contains: query.q } }] })
  if (query.status !== 'all') clauses.push({ status: { equals: query.status } })
  if (query.intent !== 'all') clauses.push({ intentLevel: { equals: query.intent } })
  return clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0] : { and: clauses }
}

export class LeadsPageReadError extends Error {
  readonly code = 'portal-leads-read-failed'
  constructor(cause?: unknown) {
    super('Unable to load leads', cause === undefined ? undefined : { cause })
    this.name = 'LeadsPageReadError'
  }
}

export const loadLeadsPageData = async ({ env, payload, query, req, role }: {
  env: PortalEnvironment
  payload: Payload
  query: LeadQuery
  req: PayloadRequest
  role: PortalRole
}): Promise<LeadsPageData> => {
  if (env.ADMIN_PORTAL_ENABLED !== 'true') return { state: 'portal-disabled', summary: null }
  if (env.ADMIN_PORTAL_LEADS_ENABLED !== 'true') return { state: 'module-disabled', summary: null }
  if (!LEADS_MODULE.allowedRoles.includes(role)) return { state: 'forbidden', summary: null }
  try {
    const leads = await payload.find({
      collection: 'leads', depth: 0, limit: 20, overrideAccess: false, page: query.page, req,
      select: { assignedTo: true, budget: true, company: true, country: true, email: true, hasDrawings: true, interest: true, intentLevel: true, locale: true, message: true, name: true, phone: true, procurementPlan: true, projectStage: true, quantitySquareMeters: true, source: true, status: true, timeline: true, updatedAt: true },
      sort: '-updatedAt', where: buildWhere(query),
    })
    const ids = leads.docs.map(({ id }) => id)
    const [sources, users, conversations] = await Promise.all([
      payload.find({ collection: 'lead-sources', depth: 0, limit: 100, overrideAccess: false, pagination: false, req, select: { isActive: true, name: true }, sort: 'name', where: { isActive: { equals: true } } }),
      role === 'admin'
        ? payload.find({ collection: 'users', depth: 0, limit: 100, overrideAccess: false, pagination: false, req, select: { email: true }, sort: 'email' })
        : Promise.resolve({ docs: [] }),
      ids.length
        ? payload.find({ collection: 'conversations', depth: 0, limit: 100, overrideAccess: false, pagination: false, req, select: { handoffStatus: true, lead: true, publicId: true }, where: { lead: { in: ids } } })
        : Promise.resolve({ docs: [] }),
    ])
    const byLead = new Map<string, Array<{ handoffStatus: string; id: string }>>()
    for (const conversation of conversations.docs) {
      const leadID = asID(conversation.lead)
      if (leadID === null) continue
      const existing = byLead.get(String(leadID)) ?? []
      existing.push({ handoffStatus: String(conversation.handoffStatus), id: String(conversation.publicId) })
      byLead.set(String(leadID), existing)
    }
    return {
      state: 'available',
      summary: {
        items: leads.docs.map((lead) => ({
          assignedTo: asID(lead.assignedTo), budget: stringOrNull(lead.budget), company: stringOrNull(lead.company), country: stringOrNull(lead.country), email: String(lead.email), hasDrawings: booleanOrNull(lead.hasDrawings), id: lead.id,
          interest: stringOrNull(lead.interest), intentLevel: lead.intentLevel as LeadSummaryItem['intentLevel'], locale: lead.locale as LeadSummaryItem['locale'],
          message: String(lead.message), name: String(lead.name), phone: stringOrNull(lead.phone), procurementPlan: stringOrNull(lead.procurementPlan), projectStage: stringOrNull(lead.projectStage), quantitySquareMeters: numberOrNull(lead.quantitySquareMeters), relatedConversations: byLead.get(String(lead.id)) ?? [],
          source: asID(lead.source) ?? 0, status: lead.status as LeadSummaryItem['status'], timeline: stringOrNull(lead.timeline), updatedAt: lead.updatedAt,
        })),
        options: { sources: sources.docs.map((source) => ({ id: source.id, label: source.name })), users: users.docs.map((user) => ({ id: user.id, label: user.email })) },
        pagination: { page: leads.page ?? query.page, totalDocs: leads.totalDocs, totalPages: leads.totalPages ?? 1 }, query,
      },
    }
  } catch (error) {
    throw new LeadsPageReadError(error)
  }
}
