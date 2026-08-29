'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  IconDownload,
  IconEdit,
  IconFile,
  IconFileAlert,
  IconFileOff,
  IconLock,
  IconPaperclip,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUsers,
} from '@tabler/icons-react'

import { usePortalCommandKey } from '@/admin-portal/core/commands/usePortalCommandKey'
import type { PortalRole } from '@/admin-portal/core/modules/types'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, PortalState, StatusBadge, Surface } from '@/admin-portal/core/ui'

import { FeishuRegistrationPanel } from './FeishuRegistrationPanel'
import { formatByteSize, type LeadSummaryItem, type LeadsSummary } from './getLeadsPage'

type EditorMode = 'create' | 'edit'
type PageState = 'available' | 'forbidden' | 'module-disabled' | 'portal-disabled' | 'read-failed'

const copy = {
  zh: {
    add: '新增线索',
    allIntent: '全部意向',
    allStatus: '全部状态',
    assignment: '分配给',
    attachmentBadge: (count: number) => `${count} 个附件`,
    attachments: '图纸与附件',
    attachmentsForbidden: '当前角色无权查看或下载附件。',
    attachmentStatus: {
      associated: '已关联',
      expired: '已过期',
      missing: '文件缺失',
      pending: '待关联',
    },
    attachmentStatusDesc: {
      associated: '附件正常，可安全下载',
      expired: '附件已超过保留期限',
      missing: '文件在存储中缺失',
      pending: '附件正在等待关联',
    },
    blocked: '线索模块未启用。',
    cancel: '取消',
    company: '公司',
    country: '国家 / 地区',
    create: '创建线索',
    delete: '删除',
    deleteConfirm: '确认永久删除',
    deleted: '线索已删除。',
    description: '集中管理来自官网询盘、AI 对话及人工录入的客户线索，支持意向评估与线索分配。',
    download: '下载',
    edit: '编辑线索',
    email: '邮箱',
    empty: '没有匹配线索',
    emptyDescription: '调整筛选条件或新建一条本地线索。',
    error: '线索管理暂时不可用',
    filter: '筛选',
    forbidden: '当前账号无权管理线索。',
    formError: '无法保存线索，请检查输入后重试。',
    intent: '意向',
    intentState: { a: 'A 高意向', b: 'B 中意向', c: 'C 低意向', unscored: '未评分' },
    interest: '关注产品 / 需求',
    locale: '语言',
    message: '需求说明',
    messagingContact: '社媒联系身份',
    name: '联系人',
    next: '下一页',
    noAttachments: '暂无附件',
    noAttachmentsWithDrawings: '客户标记了已有图纸，但未上传附件。',
    noRelated: '没有关联会话',
    phone: '电话',
    previous: '上一页',
    related: '关联会话',
    save: '保存修改',
    saved: '线索已保存。',
    source: '来源',
    state: { contacted: '已联系', disqualified: '不合格', new: '新增', qualified: '已确认' },
    status: '状态',
    title: '线索管理',
    total: '条线索',
    unknown: '未分配',
    updated: '最后更新',
  },
  en: {
    add: 'Add lead',
    allIntent: 'All intent',
    allStatus: 'All status',
    assignment: 'Assigned to',
    attachmentBadge: (count: number) => `${count} ${count === 1 ? 'attachment' : 'attachments'}`,
    attachments: 'Drawings & Attachments',
    attachmentsForbidden: 'Your role does not have permission to view or download attachments.',
    attachmentStatus: {
      associated: 'Associated',
      expired: 'Expired',
      missing: 'Missing',
      pending: 'Pending',
    },
    attachmentStatusDesc: {
      associated: 'Attachment is ready and available for download',
      expired: 'Attachment has expired past retention period',
      missing: 'File missing from storage',
      pending: 'Attachment is pending association',
    },
    blocked: 'The leads module is disabled.',
    cancel: 'Cancel',
    company: 'Company',
    country: 'Country / region',
    create: 'Create lead',
    delete: 'Delete',
    deleteConfirm: 'Confirm permanent delete',
    deleted: 'Lead deleted.',
    description: 'Maintain website, AI conversation, and manual leads through server-authorized scopes.',
    download: 'Download',
    edit: 'Edit lead',
    email: 'Email',
    empty: 'No matching leads',
    emptyDescription: 'Adjust the filters or add a local lead.',
    error: 'Lead management unavailable',
    filter: 'Filter',
    forbidden: 'This account cannot manage leads.',
    formError: 'Unable to save the lead. Check the fields and retry.',
    intent: 'Intent',
    intentState: { a: 'A high intent', b: 'B medium intent', c: 'C low intent', unscored: 'Unscored' },
    interest: 'Interest / requirement',
    locale: 'Locale',
    message: 'Requirement notes',
    messagingContact: 'Social contact identity',
    name: 'Contact',
    next: 'Next',
    noAttachments: 'No attachments',
    noAttachmentsWithDrawings: 'Customer indicated drawings are available, but no files were attached.',
    noRelated: 'No related conversations',
    phone: 'Phone',
    previous: 'Previous',
    related: 'Related conversations',
    save: 'Save changes',
    saved: 'Lead saved.',
    source: 'Source',
    state: { contacted: 'Contacted', disqualified: 'Disqualified', new: 'New', qualified: 'Qualified' },
    status: 'Status',
    title: 'Lead management',
    total: 'leads',
    unknown: 'Unassigned',
    updated: 'Last updated',
  },
} as const

const qualificationCopy = {
  en: { budget: 'Budget', details: 'Qualification details', drawings: 'Drawings available', no: 'No', procurementPlan: 'Procurement plan', projectStage: 'Project stage', quantity: 'Quantity (sqm)', timeline: 'Purchase timeline', unknown: 'Not provided', yes: 'Yes' },
  zh: { budget: '预算', details: '资格详情', drawings: '已有图纸', no: '否', procurementPlan: '采购计划', projectStage: '项目阶段', quantity: '数量（平方米）', timeline: '采购时间', unknown: '未提供', yes: '是' },
} as const

export type LeadForm = {
  assignedToId: string; company: string; country: string; email: string; id?: number | string; idempotencyKey: string; interest: string; intentLevel: string; locale: string; message: string; name: string; phone: string; sourceId: string; status: string; updatedAt: string
}

type LeadMutation = {
  deleted?: boolean
  id: number | string
  updatedAt?: string
  values?: Partial<LeadSummaryItem>
}

const blank = (sourceId = ""): LeadForm => ({ assignedToId: '', company: '', country: '', email: '', idempotencyKey: '', interest: '', intentLevel: 'unscored', locale: 'en', message: '', name: '', phone: '', sourceId, status: 'new', updatedAt: '' })

const leadForm = (lead: LeadSummaryItem): LeadForm => ({ assignedToId: lead.assignedTo ? String(lead.assignedTo) : '', company: lead.company ?? '', country: lead.country ?? '', email: lead.email ?? '', id: lead.id, idempotencyKey: '', interest: lead.interest ?? '', intentLevel: lead.intentLevel, locale: lead.locale, message: lead.message, name: lead.name, phone: lead.phone ?? '', sourceId: String(lead.source), status: lead.status, updatedAt: lead.updatedAt })

export const getLeadMutationPayload = (
  form: LeadForm,
  mode: EditorMode,
  role: PortalRole,
): Record<string, unknown> => {
  if (role !== 'sales' || mode !== 'edit') return form
  const { assignedToId: _assignedToId, sourceId: _sourceId, ...mutation } = form
  return mutation
}

const formatDate = (value: string, locale: 'en' | 'zh') => new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))

const relatedConversationStatus = (status: string, locale: 'en' | 'zh'): string =>
  ({
    ai_active: locale === 'zh' ? 'AI 服务中' : 'AI active',
    handoff_requested: locale === 'zh' ? '待接管' : 'Awaiting takeover',
    human_active: locale === 'zh' ? '人工处理中' : 'Human active',
    resolved: locale === 'zh' ? '已解决' : 'Resolved',
  } as Record<string, string>)[status] ?? (locale === 'zh' ? '状态未知' : 'Unknown status')

const relatedConversationLabel = (id: string, locale: 'en' | 'zh'): string => {
  const shortId = String(id).slice(-6)
  return locale === 'zh' ? `客户会话 #${shortId}` : `Customer conversation #${shortId}`
}

const messagingContactLabel = (lead: LeadSummaryItem): string | null => {
  if (!lead.messagingPlatform || !lead.messagingAccountExternalId || !lead.messagingSenderExternalId || !lead.messagingThreadExternalId) return null
  const platform = lead.messagingPlatform === 'facebook-messenger' ? 'Facebook Messenger' : lead.messagingPlatform === 'instagram' ? 'Instagram' : 'TikTok'
  return `${platform} · Account ${lead.messagingAccountExternalId} · Sender ${lead.messagingSenderExternalId} · Thread ${lead.messagingThreadExternalId}`
}

const leadSecondaryLabel = (lead: LeadSummaryItem): string => lead.company ?? lead.email ?? lead.phone ?? messagingContactLabel(lead) ?? '—'

export function LeadsHub({ feishuRegistrationEnabled = false, pageState, role, summary }: { feishuRegistrationEnabled?: boolean; pageState: PageState; role: PortalRole; summary: LeadsSummary | null }) {
  const router = useRouter()
  const { locale } = usePortalPreferences()
  const text = copy[locale]
  const qualificationText = qualificationCopy[locale]
  const [selectedID, setSelectedID] = useState<number | string | null>(summary?.items[0]?.id ?? null)
  const [items, setItems] = useState<LeadSummaryItem[]>(summary?.items ?? [])
  const [editor, setEditor] = useState<EditorMode | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setItems(summary?.items ?? [])
      setSelectedID((current) => summary?.items.some((item) => String(item.id) === String(current)) ? current : summary?.items[0]?.id ?? null)
    }, 0)
    return () => clearTimeout(timer)
  }, [summary])

  const selected = useMemo(() => items.find((item) => String(item.id) === String(selectedID)) ?? null, [items, selectedID])
  if (pageState !== 'available' || !summary) {
    const isForbidden = pageState === 'forbidden'
    return <main className="portal-page portal-leads"><PortalState description={isForbidden ? text.forbidden : pageState === 'read-failed' ? text.error : text.blocked} title={isForbidden ? text.forbidden : pageState === 'read-failed' ? text.error : text.blocked} type={isForbidden ? 'forbidden' : pageState === 'read-failed' ? 'error' : 'blocked'} /></main>
  }

  const updateFilters = (name: string, value: string) => {
    const params = new URLSearchParams()
    if (summary.query.q) params.set('q', summary.query.q)
    if (summary.query.status !== 'all') params.set('status', summary.query.status)
    if (summary.query.intent !== 'all') params.set('intent', summary.query.intent)
    if (value !== 'all') params.set(name, value)
    router.push(`/dashboard/leads?${params}`)
  }

  return <main className="portal-page portal-leads">
    <header className="portal-page__intro portal-leads__intro"><div><h2>{text.title}</h2><p>{text.description}</p></div>{role === 'admin' ? <Button onClick={() => { setEditor('create'); setFeedback(null) }}><IconPlus aria-hidden="true" size={16} />{text.add}</Button> : null}</header>
    {role === 'admin' ? <FeishuRegistrationPanel enabled={feishuRegistrationEnabled} /> : null}
    {feedback ? <p className="portal-leads__feedback" role="status">{feedback}</p> : null}
    {editor ? <Surface as="section" className="portal-leads__editor"><LeadEditor key={`${editor}:${editor === 'edit' ? String(selected?.id ?? 'none') : 'new'}`} mode={editor} onClose={() => setEditor(null)} onDone={(message, mutation) => { setEditor(null); setFeedback(message); if (mutation.deleted) { setItems((current) => current.filter((item) => String(item.id) !== String(mutation.id))); setSelectedID(null) } else if (mutation.values) { setItems((current) => current.map((item) => String(item.id) === String(mutation.id) ? { ...item, ...mutation.values, updatedAt: mutation.updatedAt ?? item.updatedAt } : item)) } else { setSelectedID(mutation.id) }; router.refresh() }} options={summary.options} role={role} selected={editor === 'edit' ? selected : null} text={text} /></Surface> : null}
    <Surface as="section" className="portal-leads__filters"><form action="/dashboard/leads" method="get"><label><span>{text.filter}</span><span className="portal-field__control"><IconSearch aria-hidden="true" size={16} /><input defaultValue={summary.query.q} name="q" placeholder={`${text.name} / ${text.company} / ${text.email}`} type="search" /></span></label><label><span>{text.status}</span><select name="status" value={summary.query.status} onChange={(event) => updateFilters('status', event.target.value)}><option value="all">{text.allStatus}</option>{Object.entries(text.state).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>{text.intent}</span><select name="intent" value={summary.query.intent} onChange={(event) => updateFilters('intent', event.target.value)}><option value="all">{text.allIntent}</option>{Object.entries(text.intentState).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><Button type="submit"><IconSearch aria-hidden="true" size={16} />{text.filter}</Button></form><span>{summary.pagination.totalDocs} {text.total}</span></Surface>
    <div className="portal-leads__workspace"><Surface as="section" className="portal-leads__list"><header><div><IconUsers aria-hidden="true" size={18} /><h3>{text.title}</h3></div><span>{summary.pagination.page} / {Math.max(1, summary.pagination.totalPages)}</span></header>{items.length ? <ul>{items.map((lead) => {
      const count = lead.attachmentCount ?? lead.attachments?.length ?? 0
      return <li key={String(lead.id)}><button aria-pressed={String(selectedID) === String(lead.id)} className={String(selectedID) === String(lead.id) ? 'is-selected' : undefined} onClick={() => { setSelectedID(lead.id); setFeedback(null) }} type="button"><strong>{lead.name}</strong><span>{leadSecondaryLabel(lead)}</span><div><StatusBadge label={text.state[lead.status]} tone={lead.status === 'qualified' ? 'success' : lead.status === 'disqualified' ? 'neutral' : lead.status === 'contacted' ? 'info' : 'warning'} /><StatusBadge label={text.intentState[lead.intentLevel]} tone={lead.intentLevel === 'a' ? 'success' : lead.intentLevel === 'unscored' ? 'neutral' : 'info'} />{count > 0 ? <span className="portal-leads__attachment-badge" title={text.attachmentBadge(count)}><IconPaperclip aria-hidden="true" size={12} /><span>{count}</span></span> : null}</div></button></li>
    })}</ul> : <PortalState description={text.emptyDescription} title={text.empty} type="empty" />}{summary.pagination.totalPages > 1 ? <nav><Button asChild disabled={summary.pagination.page <= 1} size="compact" variant="secondary"><Link href={href(summary.query, summary.pagination.page - 1)}>{text.previous}</Link></Button><span>{summary.pagination.page} / {summary.pagination.totalPages}</span><Button asChild disabled={summary.pagination.page >= summary.pagination.totalPages} size="compact" variant="secondary"><Link href={href(summary.query, summary.pagination.page + 1)}>{text.next}</Link></Button></nav> : null}</Surface>
      <Surface as="section" className="portal-leads__detail">{selected ? <><header><div><h3>{selected.name}</h3><p>{leadSecondaryLabel(selected)}</p></div><div><StatusBadge label={text.state[selected.status]} tone={selected.status === 'qualified' ? 'success' : selected.status === 'disqualified' ? 'neutral' : selected.status === 'contacted' ? 'info' : 'warning'} /><Button aria-label={text.edit} onClick={() => { setEditor('edit'); setFeedback(null) }} size="icon" variant="ghost"><IconEdit aria-hidden="true" size={16} /></Button></div></header><dl><div><dt>{text.email}</dt><dd>{selected.email || '—'}</dd></div><div><dt>{text.phone}</dt><dd>{selected.phone || '—'}</dd></div><div><dt>{text.messagingContact}</dt><dd>{messagingContactLabel(selected) || '—'}</dd></div><div><dt>{text.country}</dt><dd>{selected.country || '—'}</dd></div><div><dt>{text.interest}</dt><dd>{selected.interest || '—'}</dd></div><div><dt>{text.source}</dt><dd>{summary.options.sources.find((option) => String(option.id) === String(selected.source))?.label ?? text.unknown}</dd></div><div><dt>{text.assignment}</dt><dd>{selected.assignedTo ? summary.options.users.find((option) => String(option.id) === String(selected.assignedTo))?.label ?? text.unknown : text.unknown}</dd></div><div><dt>{text.updated}</dt><dd>{formatDate(selected.updatedAt, locale)}</dd></div><div><dt>{text.locale}</dt><dd>{selected.locale.toUpperCase()}</dd></div></dl><section className="portal-leads__message"><h4>{qualificationText.details}</h4><dl><div><dt>{qualificationText.projectStage}</dt><dd>{selected.projectStage || qualificationText.unknown}</dd></div><div><dt>{qualificationText.quantity}</dt><dd>{selected.quantitySquareMeters ?? qualificationText.unknown}</dd></div><div><dt>{qualificationText.drawings}</dt><dd>{selected.hasDrawings === null ? qualificationText.unknown : selected.hasDrawings ? qualificationText.yes : qualificationText.no}</dd></div><div><dt>{qualificationText.budget}</dt><dd>{selected.budget || qualificationText.unknown}</dd></div><div><dt>{qualificationText.procurementPlan}</dt><dd>{selected.procurementPlan || qualificationText.unknown}</dd></div><div><dt>{qualificationText.timeline}</dt><dd>{selected.timeline || qualificationText.unknown}</dd></div></dl></section><section className="portal-leads__message"><h4>{text.message}</h4><p>{selected.message}</p></section><section className="portal-leads__attachments"><h4>{text.attachments}</h4>{(selected.attachmentsAccess ?? (role === 'sales' ? 'unauthorized' : 'authorized')) === 'unauthorized' ? <div className="portal-leads__attachments-empty is-unauthorized"><IconLock aria-hidden="true" size={16} /><p>{text.attachmentsForbidden}</p></div> : (selected.attachments ?? []).length > 0 ? <ul className="portal-leads__attachment-list">{(selected.attachments ?? []).map((attachment) => {
        const isAssociated = attachment.status === 'associated'
        const isMissing = attachment.status === 'missing'
        const isExpired = attachment.status === 'expired'
        const tone = isAssociated ? 'success' : isMissing ? 'danger' : isExpired ? 'neutral' : 'warning'
        return <li key={attachment.id} className="portal-leads__attachment-item"><div className="portal-leads__attachment-info">{isMissing ? <IconFileOff aria-hidden="true" className="portal-leads__attachment-icon is-missing" size={20} /> : isExpired ? <IconFileAlert aria-hidden="true" className="portal-leads__attachment-icon is-expired" size={20} /> : <IconFile aria-hidden="true" className="portal-leads__attachment-icon" size={20} />}<div className="portal-leads__attachment-meta"><strong title={attachment.filename}>{attachment.filename}</strong><span>{formatByteSize(attachment.byteSize)}{attachment.createdAt ? ` · ${formatDate(attachment.createdAt, locale)}` : ''}</span></div></div><div className="portal-leads__attachment-actions"><StatusBadge label={text.attachmentStatus[attachment.status] ?? attachment.status} tone={tone} />{isAssociated ? <Button asChild size="compact" variant="secondary"><a download={attachment.filename} href={attachment.downloadUrl} rel="noopener noreferrer" target="_blank"><IconDownload aria-hidden="true" size={14} /><span>{text.download}</span></a></Button> : <span className="portal-leads__attachment-unavailable" title={text.attachmentStatusDesc[attachment.status]}>{text.attachmentStatusDesc[attachment.status]}</span>}</div></li>
      })}</ul> : <div className="portal-leads__attachments-empty"><p>{selected.hasDrawings ? text.noAttachmentsWithDrawings : text.noAttachments}</p></div>}</section><section className="portal-leads__related"><h4>{text.related}</h4>{selected.relatedConversations.length ? <ul>{selected.relatedConversations.map((conversation) => <li key={conversation.id}><Link href={`/dashboard/conversations?conversation=${encodeURIComponent(conversation.id)}`}>{relatedConversationLabel(conversation.id, locale)}</Link><StatusBadge label={relatedConversationStatus(conversation.handoffStatus, locale)} tone={conversation.handoffStatus === 'human_active' ? 'success' : conversation.handoffStatus === 'handoff_requested' ? 'warning' : 'neutral'} /></li>)}</ul> : <p>{text.noRelated}</p>}</section></> : <PortalState description={text.emptyDescription} title={text.empty} type="empty" />}</Surface>
    </div>
  </main>
}

function href(query: LeadsSummary['query'], page: number) { const params = new URLSearchParams(); if (query.q) params.set('q', query.q); if (query.status !== 'all') params.set('status', query.status); if (query.intent !== 'all') params.set('intent', query.intent); if (page > 1) params.set('page', String(page)); return `/dashboard/leads?${params}` }

function LeadEditor({ mode, onClose, onDone, options, role, selected, text }: { mode: EditorMode; onClose: () => void; onDone: (message: string, mutation: LeadMutation) => void; options: LeadsSummary['options']; role: PortalRole; selected: LeadSummaryItem | null; text: typeof copy['zh'] | typeof copy['en'] }) {
  const [form, setForm] = useState<LeadForm>(() => selected ? leadForm(selected) : blank(String(options.sources[0]?.id ?? '')))
  const createCommand = usePortalCommandKey('portal-lead')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const update = (key: keyof LeadForm, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const save = async () => {
    setBusy(true); setError(null)
    try {
      const mutation = getLeadMutationPayload(form, mode, role)
      const { idempotencyKey: _formKey, ...commandInput } = mutation
      const createKey = mode === 'create' ? createCommand.key(JSON.stringify(commandInput)) : null
      const requestBody = createKey ? { ...commandInput, idempotencyKey: createKey } : mutation
      const response = await fetch(mode === 'create' ? '/api/portal/leads' : `/api/portal/leads/${form.id}`, { body: JSON.stringify(requestBody), credentials: 'same-origin', headers: { 'content-type': 'application/json', 'Idempotency-Key': createKey ?? `portal-leads:${crypto.randomUUID()}` }, method: mode === 'create' ? 'POST' : 'PATCH' })
      const body = await response.json() as { error?: { message?: string }; result?: { id?: number | string; updatedAt?: string } }
      if (createKey) createCommand.receivedResponse(createKey)
      if (!response.ok) throw new Error(body.error?.message || text.formError)
      const id = body.result?.id ?? form.id
      if (id === undefined) throw new Error(text.formError)
      onDone(text.saved, {
        id,
        updatedAt: body.result?.updatedAt,
        ...(mode === 'edit' ? { values: { assignedTo: form.assignedToId ? Number(form.assignedToId) : null, company: form.company || null, country: form.country || null, email: form.email || null, interest: form.interest || null, intentLevel: form.intentLevel as LeadSummaryItem['intentLevel'], message: form.message, name: form.name, phone: form.phone || null, source: Number(form.sourceId), status: form.status as LeadSummaryItem['status'] } } : {}),
      })
    } catch (caught) { setError(caught instanceof Error ? caught.message : text.formError) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!form.id) return
    setBusy(true); setError(null)
    try { const response = await fetch(`/api/portal/leads/${form.id}`, { body: JSON.stringify({ updatedAt: form.updatedAt }), credentials: 'same-origin', headers: { 'content-type': 'application/json', 'Idempotency-Key': `portal-leads:${crypto.randomUUID()}` }, method: 'DELETE' }); const body = await response.json() as { error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message || text.formError); onDone(text.deleted, { deleted: true, id: form.id }) } catch (caught) { setError(caught instanceof Error ? caught.message : text.formError) } finally { setBusy(false) }
  }
  return <div className="portal-leads-editor"><header><h3>{mode === 'create' ? text.add : text.edit}</h3><Button onClick={onClose} size="compact" variant="ghost">{text.cancel}</Button></header>{error ? <p role="alert">{error}</p> : null}<div className="portal-leads-editor__fields"><Field label={text.name}><input maxLength={120} onChange={(event) => update('name', event.target.value)} required value={form.name} /></Field><Field label={text.company}><input maxLength={160} onChange={(event) => update('company', event.target.value)} value={form.company} /></Field><Field label={text.email}><input maxLength={254} onChange={(event) => update('email', event.target.value)} type="email" value={form.email} /></Field><Field label={text.phone}><input maxLength={32} onChange={(event) => update('phone', event.target.value)} value={form.phone} /></Field><Field label={text.country}><input maxLength={120} onChange={(event) => update('country', event.target.value)} value={form.country} /></Field><Field label={text.interest}><input maxLength={160} onChange={(event) => update('interest', event.target.value)} value={form.interest} /></Field><Field label={text.status}><select onChange={(event) => update('status', event.target.value)} value={form.status}>{Object.entries(text.state).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label={text.intent}><select onChange={(event) => update('intentLevel', event.target.value)} value={form.intentLevel}>{Object.entries(text.intentState).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></Field>{role !== 'sales' ? <Field label={text.source}><select onChange={(event) => update('sourceId', event.target.value)} value={form.sourceId}>{options.sources.map((source) => <option key={source.id} value={String(source.id)}>{source.label}</option>)}</select></Field> : null}{mode === 'create' ? <Field label={text.locale}><select onChange={(event) => update('locale', event.target.value)} value={form.locale}><option value="en">EN</option><option value="ar">AR</option></select></Field> : null}{role === 'admin' ? <Field label={text.assignment}><select onChange={(event) => update('assignedToId', event.target.value)} value={form.assignedToId}><option value="">{text.unknown}</option>{options.users.map((user) => <option key={user.id} value={String(user.id)}>{user.label}</option>)}</select></Field> : null}<Field label={text.message} wide><textarea maxLength={5000} onChange={(event) => update('message', event.target.value)} required rows={6} value={form.message} /></Field></div><footer><Button disabled={busy} onClick={() => void save()}>{mode === 'create' ? text.create : text.save}</Button>{mode === 'edit' && role === 'admin' ? confirmDelete ? <><Button disabled={busy} onClick={() => void remove()} variant="danger">{text.deleteConfirm}</Button><Button disabled={busy} onClick={() => setConfirmDelete(false)} variant="ghost">{text.cancel}</Button></> : <Button disabled={busy} onClick={() => setConfirmDelete(true)} variant="ghost"><IconTrash aria-hidden="true" size={16} />{text.delete}</Button> : null}</footer></div>
}

function Field({ children, label, wide = false }: { children: ReactNode; label: string; wide?: boolean }) { return <label className={wide ? 'is-wide' : undefined}><span>{label}</span>{children}</label> }
