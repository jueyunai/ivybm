'use client'

import { useEffect, useMemo, useState } from 'react'

import { useRouter } from 'next/navigation'
import {
  IconArchive,
  IconCheck,
  IconDeviceFloppy,
  IconEdit,
  IconTrash,
  IconX,
} from '@tabler/icons-react'

import { usePortalCommandKey } from '@/admin-portal/core/commands/usePortalCommandKey'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, StatusBadge } from '@/admin-portal/core/ui'

import type { KnowledgeDocumentSummary, KnowledgeSourceType } from './getKnowledgePage'
import type { KnowledgeEditorOption, KnowledgeEditorRecord } from './knowledgeCommands'

type EditorMode = 'create' | 'edit'
type EditorOptions = { media: KnowledgeEditorOption[] }

const EMPTY_OPTIONS: EditorOptions = { media: [] }

const copy = {
  en: {
    archive: 'Archive',
    cancel: 'Cancel',
    confirmDelete: 'Delete permanently',
    content: 'Knowledge content',
    create: 'Add document',
    customerVisible: 'Customer visible after review and indexing',
    delete: 'Delete',
    deleteWarning: 'An actively indexing document cannot be deleted.',
    edit: 'Edit document',
    error: 'The document change could not be saved.',
    file: 'Source file',
    locale: 'Language',
    loading: 'Loading document editor...',
    review: 'Approve review',
    save: 'Save draft',
    saved: 'Document saved and returned to draft / pending.',
    sourceTitle: 'Source title',
    sourceType: 'Source type',
    sourceURL: 'Source URL',
    sourceVersion: 'Source version',
  },
  zh: {
    archive: '归档',
    cancel: '取消',
    confirmDelete: '确认永久删除',
    content: '知识正文',
    create: '新增文档',
    customerVisible: '审核且索引完成后允许客户使用',
    delete: '删除',
    deleteWarning: '正在索引的文档不能删除。',
    edit: '编辑文档',
    error: '本次文档变更未能保存。',
    file: '来源文件',
    locale: '语言',
    loading: '正在加载文档编辑器…',
    review: '审核通过',
    save: '保存草稿',
    saved: '文档已保存，并回到待审核 / 待索引。',
    sourceTitle: '来源标题',
    sourceType: '来源类型',
    sourceURL: '来源 URL',
    sourceVersion: '来源版本',
  },
} as const

const sourceLabels: Record<KnowledgeSourceType, string> = {
  faq: 'FAQ',
  'product-manual': 'Product manual',
  'technical-specification': 'Technical specification',
  'sales-script': 'Sales script',
  'project-case': 'Project case',
  other: 'Other',
}

const emptyForm = () => ({
  content: '',
  customerVisible: false,
  locale: 'en' as 'ar' | 'en',
  sourceFileId: '',
  sourceTitle: '',
  sourceType: 'faq' as KnowledgeSourceType,
  sourceURL: '',
  sourceVersion: '1.0',
  updatedAt: '',
})

type EditorForm = ReturnType<typeof emptyForm>

const normalizeForm = (record: KnowledgeEditorRecord): EditorForm => ({
  content: record.data.content,
  customerVisible: record.data.customerVisible,
  locale: record.data.locale,
  sourceFileId: record.data.sourceFileId === null ? '' : String(record.data.sourceFileId),
  sourceTitle: record.data.sourceTitle,
  sourceType: record.data.sourceType,
  sourceURL: record.data.sourceURL,
  sourceVersion: record.data.sourceVersion,
  updatedAt: record.updatedAt,
})

const errorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } }
    return typeof body.error?.message === 'string' ? body.error.message : fallback
  } catch {
    return fallback
  }
}

export function KnowledgeEditor({
  item,
  mode,
  onClose,
}: {
  item: KnowledgeDocumentSummary | null
  mode: EditorMode
  onClose: () => void
}) {
  const router = useRouter()
  const { locale: portalLocale } = usePortalPreferences()
  const text = copy[portalLocale]
  const [form, setForm] = useState<EditorForm>(emptyForm)
  const createCommand = usePortalCommandKey('portal-knowledge')
  const [options, setOptions] = useState<EditorOptions>(EMPTY_OPTIONS)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState<null | { tone: 'danger' | 'success'; value: string }>(null)

  const editorURL = useMemo(
    () =>
      mode === 'edit' && item
        ? `/api/portal/knowledge/documents/${item.id}`
        : '/api/portal/knowledge/documents',
    [item, mode],
  )

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timer = setTimeout(() => {
      if (!active) return
      setLoading(true)
      setNotice(null)
      setConfirmDelete(false)
      void fetch(editorURL, { cache: 'no-store', signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(await errorMessage(response, text.error))
          return (await response.json()) as {
            options?: EditorOptions
            record?: KnowledgeEditorRecord
          }
        })
        .then((payload) => {
          if (!active) return
          setOptions(payload.options ?? EMPTY_OPTIONS)
          setForm(payload.record ? normalizeForm(payload.record) : emptyForm())
        })
        .catch((error: unknown) => {
          if (active && (error as { name?: string }).name !== 'AbortError') {
            setNotice({
              tone: 'danger',
              value: error instanceof Error ? error.message : text.error,
            })
          }
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, 0)
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [editorURL, text.error])

  const update = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const save = async (action: 'archive' | 'review' | 'save') => {
    setBusy(true)
    setNotice(null)
    try {
      const url =
        mode === 'edit' && item
          ? `/api/portal/knowledge/documents/${item.id}`
          : '/api/portal/knowledge/documents'
      const body = action === 'save' ? { ...form, action } : { action, updatedAt: form.updatedAt }
      const createKey = mode === 'create' ? createCommand.key(JSON.stringify(body)) : null
      const response = await fetch(url, {
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key':
            mode === 'create' && createKey
              ? createKey
              : `portal-knowledge:${crypto.randomUUID()}`,
        },
        method: mode === 'edit' ? 'PATCH' : 'POST',
      })
      const payload = (await response.json()) as {
        error?: { message?: unknown }
        result?: { updatedAt?: string }
      }
      if (createKey) createCommand.receivedResponse(createKey)
      if (!response.ok) {
        throw new Error(
          typeof payload.error?.message === 'string' ? payload.error.message : text.error,
        )
      }
      if (typeof payload.result?.updatedAt === 'string')
        update('updatedAt', payload.result.updatedAt)
      router.refresh()
      if (mode === 'create') onClose()
      else {
        setNotice({
          tone: 'success',
          value:
            action === 'review'
              ? portalLocale === 'zh'
                ? '审核状态已更新，可以提交索引。'
                : 'Review approved. The document can now be indexed.'
              : action === 'archive'
                ? portalLocale === 'zh'
                  ? '文档已归档。'
                  : 'Document archived.'
                : text.saved,
        })
      }
    } catch (error) {
      setNotice({ tone: 'danger', value: error instanceof Error ? error.message : text.error })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!item) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch(`/api/portal/knowledge/documents/${item.id}`, {
        body: JSON.stringify({ updatedAt: form.updatedAt }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `portal-knowledge:${crypto.randomUUID()}`,
        },
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(await errorMessage(response, text.error))
      router.refresh()
      onClose()
    } catch (error) {
      setNotice({ tone: 'danger', value: error instanceof Error ? error.message : text.error })
      setConfirmDelete(false)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="portal-knowledge-editor__loading">{text.loading}</p>

  return (
    <section
      className="portal-knowledge-editor"
      aria-label={mode === 'create' ? text.create : text.edit}
    >
      <header className="portal-knowledge-editor__header">
        <div>
          <p>{item?.sourceTitle ?? 'KNOWLEDGE / DOCUMENT'}</p>
          <h3>{mode === 'create' ? text.create : text.edit}</h3>
        </div>
        <Button aria-label={text.cancel} onClick={onClose} size="icon" variant="ghost">
          <IconX aria-hidden="true" size={18} />
        </Button>
      </header>

      {notice ? <StatusBadge label={notice.value} tone={notice.tone} /> : null}

      <div className="portal-knowledge-editor__fields" dir={form.locale === 'ar' ? 'rtl' : 'ltr'}>
        <label className="portal-knowledge-editor__field">
          <span>{text.sourceTitle}</span>
          <input
            maxLength={500}
            onChange={(event) => update('sourceTitle', event.target.value)}
            required
            value={form.sourceTitle}
          />
        </label>
        <label className="portal-knowledge-editor__field">
          <span>{text.sourceType}</span>
          <select
            onChange={(event) => update('sourceType', event.target.value as KnowledgeSourceType)}
            value={form.sourceType}
          >
            {Object.entries(sourceLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="portal-knowledge-editor__field">
          <span>{text.locale}</span>
          <select
            onChange={(event) => update('locale', event.target.value as 'ar' | 'en')}
            value={form.locale}
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
        </label>
        <label className="portal-knowledge-editor__field">
          <span>{text.sourceVersion}</span>
          <input
            maxLength={100}
            onChange={(event) => update('sourceVersion', event.target.value)}
            required
            value={form.sourceVersion}
          />
        </label>
        <label className="portal-knowledge-editor__field is-wide">
          <span>{text.sourceURL}</span>
          <input
            dir="ltr"
            maxLength={2000}
            onChange={(event) => update('sourceURL', event.target.value)}
            type="url"
            value={form.sourceURL}
          />
        </label>
        <label className="portal-knowledge-editor__field is-wide">
          <span>{text.file}</span>
          <select
            onChange={(event) => update('sourceFileId', event.target.value)}
            value={form.sourceFileId}
          >
            <option value="">—</option>
            {options.media.map((option) => (
              <option key={option.id} value={String(option.id)}>
                {option.label}
                {option.meta ? ` · ${option.meta}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="portal-knowledge-editor__field is-wide">
          <span>{text.content}</span>
          <textarea
            maxLength={200_000}
            onChange={(event) => update('content', event.target.value)}
            required
            rows={12}
            value={form.content}
          />
        </label>
        <label className="portal-knowledge-editor__checkbox">
          <input
            checked={form.customerVisible}
            onChange={(event) => update('customerVisible', event.target.checked)}
            type="checkbox"
          />
          <span>{text.customerVisible}</span>
        </label>
      </div>

      <footer className="portal-knowledge-editor__actions">
        <Button disabled={busy} onClick={() => void save('save')}>
          <IconDeviceFloppy aria-hidden="true" size={16} />
          {text.save}
        </Button>
        {mode === 'edit' && item ? (
          <>
            {item.reviewStatus === 'draft' ? (
              <Button disabled={busy} onClick={() => void save('review')} variant="secondary">
                <IconCheck aria-hidden="true" size={16} />
                {text.review}
              </Button>
            ) : null}
            {item.reviewStatus === 'reviewed' ? (
              <Button disabled={busy} onClick={() => void save('archive')} variant="ghost">
                <IconArchive aria-hidden="true" size={16} />
                {text.archive}
              </Button>
            ) : null}
            {item.reviewStatus === 'draft' &&
            (item.indexStatus === 'pending' || item.indexStatus === 'failed') ? (
              confirmDelete ? (
                <>
                  <span className="portal-knowledge-editor__delete-warning">
                    {text.deleteWarning}
                  </span>
                  <Button disabled={busy} onClick={() => void remove()} variant="danger">
                    <IconTrash aria-hidden="true" size={16} />
                    {text.confirmDelete}
                  </Button>
                  <Button disabled={busy} onClick={() => setConfirmDelete(false)} variant="ghost">
                    {text.cancel}
                  </Button>
                </>
              ) : (
                <Button disabled={busy} onClick={() => setConfirmDelete(true)} variant="ghost">
                  <IconTrash aria-hidden="true" size={16} />
                  {text.delete}
                </Button>
              )
            ) : null}
          </>
        ) : null}
      </footer>
    </section>
  )
}

export function KnowledgeEditButton({ onClick }: { onClick: () => void }) {
  const { locale } = usePortalPreferences()
  return (
    <Button onClick={onClick} variant="secondary">
      <IconEdit aria-hidden="true" size={16} />
      {copy[locale].edit}
    </Button>
  )
}
