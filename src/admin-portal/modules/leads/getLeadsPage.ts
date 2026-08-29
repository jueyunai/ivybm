import type { Payload, PayloadRequest, Where } from "payload"

import type { PortalEnvironment, PortalRole } from "@/admin-portal/core/modules/types"

import { LEADS_MODULE } from "./manifest"

export const LEAD_STATUS_FILTERS = ["all", "contacted", "disqualified", "new", "qualified"] as const
export const LEAD_INTENT_FILTERS = ["all", "a", "b", "c", "unscored"] as const

export type LeadStatusFilter = (typeof LEAD_STATUS_FILTERS)[number]
export type LeadIntentFilter = (typeof LEAD_INTENT_FILTERS)[number]

export type LeadQuery = { intent: LeadIntentFilter; lead?: null | number | string; page: number; q: string; status: LeadStatusFilter }

export type LeadAttachmentSummaryItem = {
  byteSize: number
  createdAt: string
  downloadUrl: string
  filename: string
  id: number
  mimeType: string
  status: "associated" | "expired" | "missing" | "pending"
}

export type LeadSummaryItem = {
  assignedTo: null | number
  attachmentCount?: number
  attachments?: LeadAttachmentSummaryItem[]
  attachmentsAccess?: "authorized" | "unauthorized"
  budget: null | string
  company: null | string
  country: null | string
  email: null | string
  hasDrawings: boolean | null
  id: number | string
  interest: null | string
  intentLevel: "a" | "b" | "c" | "unscored"
  locale: "ar" | "en"
  message: string
  messagingAccountExternalId: null | string
  messagingPlatform: "facebook-messenger" | "instagram" | "tiktok" | null
  messagingSenderExternalId: null | string
  messagingThreadExternalId: null | string
  name: string
  phone: null | string
  procurementPlan: null | string
  projectStage: null | string
  quantitySquareMeters: null | number
  relatedConversations: Array<{ handoffStatus: string; id: string }>
  source: number
  status: "contacted" | "disqualified" | "new" | "qualified"
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
  state: "available" | "forbidden" | "module-disabled" | "portal-disabled"
  summary: LeadsSummary | null
}

export const formatByteSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, index)
  return `${value < 10 && index > 0 ? value.toFixed(1) : Math.round(value)} ${units[index]}`
}

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value

export const parseLeadQuery = (input: Record<string, string | string[] | undefined>): LeadQuery => {
  const page = Number.parseInt(first(input.page) ?? "1", 10)
  const status = first(input.status)
  const intent = first(input.intent)
  const leadParam = first(input.lead)?.trim()
  return {
    intent: LEAD_INTENT_FILTERS.includes(intent as LeadIntentFilter) ? intent as LeadIntentFilter : "all",
    ...(leadParam ? { lead: leadParam } : {}),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    q: (first(input.q) ?? "").trim().slice(0, 80),
    status: LEAD_STATUS_FILTERS.includes(status as LeadStatusFilter) ? status as LeadStatusFilter : "all",
  }
}

const asID = (value: unknown): null | number => {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "number") return (value as { id: number }).id
  return null
}

const stringOrNull = (value: unknown): null | string => typeof value === "string" && value ? value : null
const numberOrNull = (value: unknown): null | number => typeof value === "number" && Number.isFinite(value) ? value : null
const booleanOrNull = (value: unknown): boolean | null => typeof value === "boolean" ? value : null

const buildWhere = (query: LeadQuery): Where => {
  const clauses: Where[] = []
  if (query.q) clauses.push({ or: [{ name: { contains: query.q } }, { company: { contains: query.q } }, { email: { contains: query.q } }, { country: { contains: query.q } }, { messagingSenderExternalId: { contains: query.q } }] })
  if (query.status !== "all") clauses.push({ status: { equals: query.status } })
  if (query.intent !== "all") clauses.push({ intentLevel: { equals: query.intent } })
  return clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0] : { and: clauses }
}

export class LeadsPageReadError extends Error {
  readonly code = "portal-leads-read-failed"
  constructor(cause?: unknown) {
    super("Unable to load leads", cause === undefined ? undefined : { cause })
    this.name = "LeadsPageReadError"
  }
}

export const loadLeadsPageData = async ({ env, payload, query, req, role }: {
  env: PortalEnvironment
  payload: Payload
  query: LeadQuery
  req: PayloadRequest
  role: PortalRole
}): Promise<LeadsPageData> => {
  if (env.ADMIN_PORTAL_ENABLED !== "true") return { state: "portal-disabled", summary: null }
  if (env.ADMIN_PORTAL_LEADS_ENABLED !== "true") return { state: "module-disabled", summary: null }
  if (!LEADS_MODULE.allowedRoles.includes(role)) return { state: "forbidden", summary: null }
  try {
    const leads = await payload.find({
      collection: "leads", depth: 0, limit: 20, overrideAccess: false, page: query.page, req,
      select: { assignedTo: true, budget: true, company: true, country: true, email: true, hasDrawings: true, interest: true, intentLevel: true, locale: true, message: true, messagingAccountExternalId: true, messagingPlatform: true, messagingSenderExternalId: true, messagingThreadExternalId: true, name: true, phone: true, procurementPlan: true, projectStage: true, quantitySquareMeters: true, source: true, status: true, timeline: true, updatedAt: true },
      sort: "-updatedAt", where: buildWhere(query),
    })
    let docs = leads.docs
    if (query.lead && !docs.some((d) => String(d.id) === String(query.lead))) {
      const targetId = Number.parseInt(String(query.lead), 10)
      if (Number.isSafeInteger(targetId) && targetId > 0) {
        const specificLead = await payload.findByID({
          collection: "leads",
          depth: 0,
          id: targetId,
          overrideAccess: false,
          req,
          select: { assignedTo: true, budget: true, company: true, country: true, email: true, hasDrawings: true, interest: true, intentLevel: true, locale: true, message: true, messagingAccountExternalId: true, messagingPlatform: true, messagingSenderExternalId: true, messagingThreadExternalId: true, name: true, phone: true, procurementPlan: true, projectStage: true, quantitySquareMeters: true, source: true, status: true, timeline: true, updatedAt: true },
        }).catch(() => null)
        if (specificLead) {
          docs = [specificLead, ...docs]
        }
      }
    }
    const ids = docs.map(({ id }) => id)
    const canAccessAttachments = role === "admin" || role === "operator"

    const [sources, users, conversations, attachments] = await Promise.all([
      payload.find({ collection: "lead-sources", depth: 0, limit: 100, overrideAccess: false, pagination: false, req, select: { isActive: true, name: true }, sort: "name", where: { isActive: { equals: true } } }),
      role === "admin"
        ? payload.find({ collection: "users", depth: 0, limit: 100, overrideAccess: false, pagination: false, req, select: { email: true }, sort: "email" })
        : Promise.resolve({ docs: [] }),
      ids.length
        ? payload.find({ collection: "conversations", depth: 0, limit: 100, overrideAccess: false, pagination: false, req, select: { handoffStatus: true, lead: true, publicId: true }, where: { lead: { in: ids } } })
        : Promise.resolve({ docs: [] }),
      canAccessAttachments && ids.length
        ? payload.find({ collection: "lead-attachments", depth: 0, limit: 200, overrideAccess: false, pagination: false, req, select: { byteSize: true, createdAt: true, filename: true, lead: true, mimeType: true, status: true }, sort: "createdAt", where: { lead: { in: ids } } })
        : Promise.resolve({ docs: [] }),
    ])
    const byLead = new Map<string, Array<{ handoffStatus: string; id: string }>>()
    for (const conversation of conversations?.docs ?? []) {
      const leadID = asID(conversation.lead)
      if (leadID === null) continue
      const existing = byLead.get(String(leadID)) ?? []
      existing.push({ handoffStatus: String(conversation.handoffStatus), id: String(conversation.publicId) })
      byLead.set(String(leadID), existing)
    }

    const attachmentsByLead = new Map<string, LeadAttachmentSummaryItem[]>()
    for (const doc of attachments?.docs ?? []) {
      const leadID = asID(doc.lead)
      if (leadID === null) continue
      const existing = attachmentsByLead.get(String(leadID)) ?? []
      existing.push({
        byteSize: typeof doc.byteSize === "number" ? doc.byteSize : 0,
        createdAt: String(doc.createdAt || ""),
        downloadUrl: `/api/portal/leads/${leadID}/attachments/${doc.id}`,
        filename: String(doc.filename || `attachment-${doc.id}`),
        id: Number(doc.id),
        mimeType: String(doc.mimeType || "application/octet-stream"),
        status: (doc.status as LeadAttachmentSummaryItem["status"]) || "pending",
      })
      attachmentsByLead.set(String(leadID), existing)
    }

    return {
      state: "available",
      summary: {
        items: docs.map((lead) => {
          const leadAttachments = attachmentsByLead.get(String(lead.id)) ?? []
          return {
            assignedTo: asID(lead.assignedTo),
            attachmentCount: canAccessAttachments ? leadAttachments.length : 0,
            attachments: canAccessAttachments ? leadAttachments : [],
            attachmentsAccess: canAccessAttachments ? "authorized" : "unauthorized",
            budget: stringOrNull(lead.budget), company: stringOrNull(lead.company), country: stringOrNull(lead.country), email: stringOrNull(lead.email), hasDrawings: booleanOrNull(lead.hasDrawings), id: lead.id,
            interest: stringOrNull(lead.interest), intentLevel: lead.intentLevel as LeadSummaryItem["intentLevel"], locale: lead.locale as LeadSummaryItem["locale"],
            message: String(lead.message), messagingAccountExternalId: stringOrNull(lead.messagingAccountExternalId), messagingPlatform: stringOrNull(lead.messagingPlatform) as LeadSummaryItem["messagingPlatform"], messagingSenderExternalId: stringOrNull(lead.messagingSenderExternalId), messagingThreadExternalId: stringOrNull(lead.messagingThreadExternalId), name: String(lead.name), phone: stringOrNull(lead.phone), procurementPlan: stringOrNull(lead.procurementPlan), projectStage: stringOrNull(lead.projectStage), quantitySquareMeters: numberOrNull(lead.quantitySquareMeters), relatedConversations: byLead.get(String(lead.id)) ?? [],
            source: asID(lead.source) ?? 0, status: lead.status as LeadSummaryItem["status"], timeline: stringOrNull(lead.timeline), updatedAt: lead.updatedAt,
          }
        }),
        options: { sources: sources.docs.map((source) => ({ id: source.id, label: source.name })), users: users.docs.map((user) => ({ id: user.id, label: user.email })) },
        pagination: { page: leads.page ?? query.page, totalDocs: leads.totalDocs, totalPages: leads.totalPages ?? 1 }, query,
      },
    }
  } catch (error) {
    throw new LeadsPageReadError(error)
  }
}
