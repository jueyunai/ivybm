import type { Where } from 'payload'

export const HIGH_INTENT_LEAD_WHERE: Where = {
  and: [{ status: { in: ['new', 'qualified'] } }, { intentLevel: { equals: 'a' } }],
}

export const isHighIntentLead = (lead: { intentLevel?: unknown; status?: unknown }): boolean =>
  lead.intentLevel === 'a' && (lead.status === 'new' || lead.status === 'qualified')
