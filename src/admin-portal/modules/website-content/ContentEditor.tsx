'use client'

import { useEffect, useMemo, useState } from 'react'

import { useRouter } from 'next/navigation'
import {
  IconCheck,
  IconChevronDown,
  IconDeviceFloppy,
  IconEdit,
  IconLanguage,
  IconPlus,
  IconTrash,
  IconX,
} from '@tabler/icons-react'

import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, StatusBadge } from '@/admin-portal/core/ui'

import type { ContentEditorOption, ContentEditorRecord } from './contentCommands'
import type { ContentSummaryItem, ContentTypeId } from './getContentSummary'

type EditorOptions = { categories: ContentEditorOption[]; media: ContentEditorOption[] }
type EditorPayload = { options?: EditorOptions; record?: ContentEditorRecord }
type EditorMode = 'create' | 'edit'

const EMPTY_OPTIONS: EditorOptions = { categories: [], media: [] }
const VERSIONED = new Set<ContentTypeId>(['pages', 'posts', 'products', 'projects'])

const toDateTimeLocalValue = (value: unknown): string => {
  if (typeof value !== 'string' || !value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

const toISOStringOrEmpty = (value: string): string => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

const copy = {
  en: {
    activate: 'Activate',
    add: 'New content',
    arabic: 'Arabic',
    cancel: 'Cancel',
    confirmDelete: 'Delete permanently',
    delete: 'Delete',
    deleteWarning: 'This removes the record after reference and revision checks.',
    deactivate: 'Deactivate',
    edit: 'Edit content',
    english: 'English',
    error: 'The change could not be saved.',
    loading: 'Loading editor...',
    publish: 'Publish',
    save: 'Save changes',
    saveDraft: 'Save draft',
    saved: 'Saved. The list has been refreshed.',
    unpublish: 'Move to draft',
  },
  zh: {
    activate: '启用',
    add: '新增内容',
    arabic: '阿语',
    cancel: '取消',
    confirmDelete: '确认永久删除',
    delete: '删除',
    deleteWarning: '系统会先检查引用和版本，确认后永久删除这条记录。',
    deactivate: '停用',
    edit: '编辑内容',
    english: '英文',
    error: '本次变更未能保存。',
    loading: '正在加载编辑器…',
    publish: '发布',
    save: '保存修改',
    saveDraft: '保存草稿',
    saved: '保存成功，列表已刷新。',
    unpublish: '转为草稿',
  },
} as const

const emptyForm = (locale: 'ar' | 'en') => ({
  action: 'save-draft',
  application: '',
  bodyText: '',
  category: 'industry',
  categoryId: '',
  coverImageId: '',
  description: '',
  downloadType: 'catalog',
  excerpt: '',
  featuredImageId: '',
  fileId: '',
  galleryIds: [] as string[],
  heroImageId: '',
  internalNotes: '',
  isActive: true,
  locale,
  location: '',
  publishedAt: '',
  seoCanonical: '',
  seoDescription: '',
  seoKeywords: '',
  seoNoIndex: false,
  seoOgImageId: '',
  seoTitle: '',
  shortDescription: '',
  slug: '',
  sortOrder: '0',
  specificationsText: '',
  summary: '',
  title: '',
  updatedAt: '',
})

type EditorForm = ReturnType<typeof emptyForm>

const normalizeForm = (record: ContentEditorRecord): EditorForm => {
  const form = emptyForm(record.locale)
  const data = record.data
  const scalar = (key: string) =>
    typeof data[key] === 'string' || typeof data[key] === 'number' ? String(data[key]) : ''
  return {
    ...form,
    application: scalar('application'),
    bodyText: scalar('bodyText'),
    category: scalar('category') || 'industry',
    categoryId: scalar('categoryId'),
    coverImageId: scalar('coverImageId'),
    description: scalar('description'),
    downloadType: scalar('downloadType') || 'catalog',
    excerpt: scalar('excerpt'),
    featuredImageId: scalar('featuredImageId'),
    fileId: scalar('fileId'),
    galleryIds: Array.isArray(data.galleryIds) ? data.galleryIds.map(String) : [],
    heroImageId: scalar('heroImageId'),
    internalNotes: scalar('internalNotes'),
    isActive: data.isActive !== false,
    locale: record.locale,
    location: scalar('location'),
    publishedAt: toDateTimeLocalValue(data.publishedAt),
    seoCanonical: scalar('seoCanonical'),
    seoDescription: scalar('seoDescription'),
    seoKeywords: scalar('seoKeywords'),
    seoNoIndex: data.seoNoIndex === true,
    seoOgImageId: scalar('seoOgImageId'),
    seoTitle: scalar('seoTitle'),
    shortDescription: scalar('shortDescription'),
    slug: scalar('slug'),
    sortOrder: scalar('sortOrder') || '0',
    specificationsText: Array.isArray(data.specifications)
      ? data.specifications
          .map((item) => {
            const value = item as { label?: unknown; value?: unknown }
            return `${typeof value.label === 'string' ? value.label : ''} | ${typeof value.value === 'string' ? value.value : ''}`
          })
          .join('\n')
      : '',
    summary: scalar('summary'),
    title: scalar('title'),
    updatedAt: record.updatedAt,
  }
}

const parseSpecifications = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, ...rest] = line.split('|')
      return { label: label.trim(), value: rest.join('|').trim() }
    })
    .filter((item) => item.label && item.value)

const errorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } }
    return typeof body.error?.message === 'string' ? body.error.message : fallback
  } catch {
    return fallback
  }
}

function Field({
  children,
  label,
  wide = false,
}: {
  children: React.ReactNode
  label: string
  wide?: boolean
}) {
  return (
    <label className={`portal-content-editor__field${wide ? ' is-wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function MediaSelect({
  label,
  onChange,
  options,
  required = false,
  value,
}: {
  label: string
  onChange: (value: string) => void
  options: ContentEditorOption[]
  required?: boolean
  value: string
}) {
  return (
    <Field label={label}>
      <select onChange={(event) => onChange(event.target.value)} required={required} value={value}>
        <option value="">—</option>
        {options.map((option) => (
          <option key={option.id} value={String(option.id)}>
            {option.label}
            {option.meta ? ` · ${option.meta}` : ''}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function ContentEditor({
  item,
  mode,
  onClose,
  type,
}: {
  item: ContentSummaryItem | null
  mode: EditorMode
  onClose: () => void
  type: ContentTypeId
}) {
  const router = useRouter()
  const { locale: portalLocale } = usePortalPreferences()
  const messages = getPortalMessages(portalLocale).websiteContent
  const text = copy[portalLocale]
  const [form, setForm] = useState<EditorForm>(() => emptyForm('en'))
  const [options, setOptions] = useState<EditorOptions>(EMPTY_OPTIONS)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<null | { tone: 'danger' | 'success'; value: string }>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const recordURL = useMemo(
    () =>
      mode === 'edit' && item
        ? `/api/portal/content/${type}/${item.id}?locale=${form.locale}`
        : `/api/portal/content/${type}`,
    [form.locale, item, mode, type],
  )

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timer = setTimeout(() => {
      if (!active) return
      setLoading(true)
      setNotice(null)
      void fetch(recordURL, { cache: 'no-store', signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(await errorMessage(response, text.error))
          return (await response.json()) as EditorPayload
        })
        .then((payload) => {
          if (!active) return
          setOptions(payload.options ?? EMPTY_OPTIONS)
          if (payload.record) setForm(normalizeForm(payload.record))
          else setForm((current) => emptyForm(current.locale))
        })
        .catch((error: unknown) => {
          if (active && (error as { name?: string }).name !== 'AbortError') {
            setNotice({ tone: 'danger', value: error instanceof Error ? error.message : text.error })
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
  }, [recordURL, text.error])

  const update = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const requestBody = (action: string) => ({
    ...form,
    action,
    publishedAt: toISOStringOrEmpty(form.publishedAt),
    specifications: parseSpecifications(form.specificationsText),
  })

  const save = async (action: string) => {
    setBusy(true)
    setNotice(null)
    try {
      const url =
        mode === 'edit' && item
          ? `/api/portal/content/${type}/${item.id}`
          : `/api/portal/content/${type}`
      const response = await fetch(url, {
        body: JSON.stringify(requestBody(action)),
        headers: { 'Content-Type': 'application/json' },
        method: mode === 'edit' ? 'PATCH' : 'POST',
      })
      if (!response.ok) throw new Error(await errorMessage(response, text.error))
      const body = (await response.json()) as { result?: { updatedAt?: string } }
      if (typeof body.result?.updatedAt === 'string') update('updatedAt', body.result.updatedAt)
      setNotice({ tone: 'success', value: text.saved })
      router.refresh()
      if (mode === 'create') onClose()
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
      const response = await fetch(`/api/portal/content/${type}/${item.id}`, {
        body: JSON.stringify({ locale: form.locale, updatedAt: form.updatedAt }),
        headers: { 'Content-Type': 'application/json' },
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

  if (loading) return <p className="portal-content-editor__loading">{text.loading}</p>

  const imageMediaOptions = options.media.filter((option) => option.meta?.startsWith('image/'))

  return (
    <section
      className="portal-content-editor"
      aria-label={mode === 'create' ? text.add : text.edit}
    >
      <header className="portal-content-editor__header">
        <div>
          <p>{messages.collections[type]}</p>
          <h3>{mode === 'create' ? text.add : text.edit}</h3>
        </div>
        <Button aria-label={text.cancel} onClick={onClose} size="icon" variant="ghost">
          <IconX aria-hidden="true" size={18} />
        </Button>
      </header>

      <div className="portal-content-editor__locale" role="group" aria-label="Locale">
        <IconLanguage aria-hidden="true" size={17} />
        <button
          aria-pressed={form.locale === 'en'}
          disabled={busy}
          onClick={() => update('locale', 'en')}
          type="button"
        >
          {text.english}
        </button>
        <button
          aria-pressed={form.locale === 'ar'}
          disabled={busy}
          onClick={() => update('locale', 'ar')}
          type="button"
        >
          {text.arabic}
        </button>
      </div>

      {notice ? <StatusBadge label={notice.value} tone={notice.tone} /> : null}

      <div className="portal-content-editor__fields" dir={form.locale === 'ar' ? 'rtl' : 'ltr'}>
        <Field label="Title / 标题">
          <input
            maxLength={200}
            onChange={(event) => update('title', event.target.value)}
            required
            value={form.title}
          />
        </Field>
        <Field label="Stable slug">
          <input
            dir="ltr"
            maxLength={120}
            onChange={(event) => update('slug', event.target.value)}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
            value={form.slug}
          />
        </Field>

        {type === 'pages' || type === 'projects' ? (
          <Field label="Summary / 摘要" wide>
            <textarea
              maxLength={1000}
              onChange={(event) => update('summary', event.target.value)}
              rows={3}
              value={form.summary}
            />
          </Field>
        ) : null}
        {type === 'products' ? (
          <Field label="Short description / 简介" wide>
            <textarea
              maxLength={1000}
              onChange={(event) => update('shortDescription', event.target.value)}
              rows={3}
              value={form.shortDescription}
            />
          </Field>
        ) : null}
        {type === 'posts' ? (
          <Field label="Excerpt / 摘要" wide>
            <textarea
              maxLength={1000}
              onChange={(event) => update('excerpt', event.target.value)}
              rows={3}
              value={form.excerpt}
            />
          </Field>
        ) : null}
        {type === 'product-categories' || type === 'downloads' ? (
          <Field label="Description / 描述" wide>
            <textarea
              maxLength={5000}
              onChange={(event) => update('description', event.target.value)}
              rows={4}
              value={form.description}
            />
          </Field>
        ) : null}
        {VERSIONED.has(type) ? (
          <Field label="Body / 正文" wide>
            <textarea
              maxLength={80_000}
              onChange={(event) => update('bodyText', event.target.value)}
              rows={10}
              value={form.bodyText}
            />
          </Field>
        ) : null}

        {type === 'products' ? (
          <Field label="Product category / 产品分类">
            <select
              onChange={(event) => update('categoryId', event.target.value)}
              required
              value={form.categoryId}
            >
              <option value="">—</option>
              {options.categories.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {type === 'posts' ? (
          <Field label="Post category / 文章分类">
            <select
              onChange={(event) => update('category', event.target.value)}
              value={form.category}
            >
              <option value="industry">Industry</option>
              <option value="products">Products</option>
              <option value="projects">Projects</option>
              <option value="company">Company</option>
            </select>
          </Field>
        ) : null}
        {type === 'downloads' ? (
          <Field label="Download type / 资料类型">
            <select
              onChange={(event) => update('downloadType', event.target.value)}
              value={form.downloadType}
            >
              <option value="catalog">Catalog</option>
              <option value="technical-data">Technical data</option>
              <option value="certificate">Certificate</option>
              <option value="other">Other</option>
            </select>
          </Field>
        ) : null}

        {type === 'pages' ? (
          <MediaSelect
            label="Hero image / 头图"
            onChange={(value) => update('heroImageId', value)}
            options={imageMediaOptions}
            value={form.heroImageId}
          />
        ) : null}
        {type === 'products' || type === 'projects' ? (
          <MediaSelect
            label="Cover image / 封面"
            onChange={(value) => update('coverImageId', value)}
            options={imageMediaOptions}
            required
            value={form.coverImageId}
          />
        ) : null}
        {type === 'posts' ? (
          <MediaSelect
            label="Featured image / 特色图"
            onChange={(value) => update('featuredImageId', value)}
            options={imageMediaOptions}
            value={form.featuredImageId}
          />
        ) : null}
        {type === 'downloads' ? (
          <MediaSelect
            label="Download file / 文件"
            onChange={(value) => update('fileId', value)}
            options={options.media}
            required
            value={form.fileId}
          />
        ) : null}
        {type === 'downloads' ? (
          <MediaSelect
            label="Cover image / 封面"
            onChange={(value) => update('coverImageId', value)}
            options={imageMediaOptions}
            value={form.coverImageId}
          />
        ) : null}

        {type === 'products' || type === 'projects' ? (
          <Field label="Gallery / 图库" wide>
            <select
              multiple
              onChange={(event) =>
                update(
                  'galleryIds',
                  Array.from(event.target.selectedOptions, (option) => option.value),
                )
              }
              size={Math.min(6, Math.max(3, imageMediaOptions.length))}
              value={form.galleryIds}
            >
              {imageMediaOptions.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {type === 'products' ? (
          <Field label="Specifications (label | value)" wide>
            <textarea
              onChange={(event) => update('specificationsText', event.target.value)}
              placeholder="Thickness | 2.0 mm"
              rows={5}
              value={form.specificationsText}
            />
          </Field>
        ) : null}
        {type === 'projects' ? (
          <>
            <Field label="Location / 地点">
              <input
                onChange={(event) => update('location', event.target.value)}
                value={form.location}
              />
            </Field>
            <Field label="Application / 应用">
              <input
                onChange={(event) => update('application', event.target.value)}
                value={form.application}
              />
            </Field>
          </>
        ) : null}
        {type === 'product-categories' ? (
          <Field label="Sort order / 排序">
            <input
              min={0}
              onChange={(event) => update('sortOrder', event.target.value)}
              type="number"
              value={form.sortOrder}
            />
          </Field>
        ) : null}
        {type === 'posts' ? (
          <Field label="Published at / 发布时间">
            <input
              onChange={(event) => update('publishedAt', event.target.value)}
              type="datetime-local"
              value={form.publishedAt}
            />
          </Field>
        ) : null}

        <details className="portal-content-editor__seo is-wide">
          <summary>
            <IconChevronDown aria-hidden="true" size={16} /> SEO
          </summary>
          <div className="portal-content-editor__fields">
            <Field label="SEO title">
              <input
                maxLength={70}
                onChange={(event) => update('seoTitle', event.target.value)}
                value={form.seoTitle}
              />
            </Field>
            <Field label="Canonical URL">
              <input
                dir="ltr"
                onChange={(event) => update('seoCanonical', event.target.value)}
                value={form.seoCanonical}
              />
            </Field>
            <Field label="SEO description" wide>
              <textarea
                maxLength={180}
                onChange={(event) => update('seoDescription', event.target.value)}
                rows={3}
                value={form.seoDescription}
              />
            </Field>
            <Field label="Keywords" wide>
              <textarea
                onChange={(event) => update('seoKeywords', event.target.value)}
                rows={2}
                value={form.seoKeywords}
              />
            </Field>
            <MediaSelect
              label="Open Graph image"
              onChange={(value) => update('seoOgImageId', value)}
              options={options.media}
              value={form.seoOgImageId}
            />
            <label className="portal-content-editor__checkbox">
              <input
                checked={form.seoNoIndex}
                onChange={(event) => update('seoNoIndex', event.target.checked)}
                type="checkbox"
              />{' '}
              noIndex
            </label>
          </div>
        </details>

        {['pages', 'products', 'projects', 'posts'].includes(type) ? (
          <Field label="Internal notes / 内部备注" wide>
            <textarea
              maxLength={5000}
              onChange={(event) => update('internalNotes', event.target.value)}
              rows={3}
              value={form.internalNotes}
            />
          </Field>
        ) : null}
      </div>

      <footer className="portal-content-editor__actions">
        <Button
          disabled={busy}
          onClick={() => void save(VERSIONED.has(type) ? 'save-draft' : 'save')}
          variant="secondary"
        >
          <IconDeviceFloppy aria-hidden="true" size={16} />
          {VERSIONED.has(type) ? text.saveDraft : text.save}
        </Button>
        {VERSIONED.has(type) ? (
          <Button disabled={busy} onClick={() => void save('publish')}>
            <IconCheck aria-hidden="true" size={16} />
            {text.publish}
          </Button>
        ) : null}
        {mode === 'edit' && item?.status === 'published' && VERSIONED.has(type) ? (
          <Button disabled={busy} onClick={() => void save('unpublish')} variant="ghost">
            {text.unpublish}
          </Button>
        ) : null}
        {type === 'downloads' ? (
          <Button
            disabled={busy}
            onClick={() => void save(form.isActive ? 'deactivate' : 'activate')}
            variant="ghost"
          >
            {form.isActive ? text.deactivate : text.activate}
          </Button>
        ) : null}
        {mode === 'edit' && item ? (
          confirmDelete ? (
            <>
              <span className="portal-content-editor__delete-warning">{text.deleteWarning}</span>
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
      </footer>
    </section>
  )
}

export function ContentEditorActions({
  onCreate,
  onEdit,
}: {
  onCreate: () => void
  onEdit?: () => void
}) {
  const { locale } = usePortalPreferences()
  const text = copy[locale]
  return (
    <div className="portal-content__editor-actions">
      <Button onClick={onCreate}>
        <IconPlus aria-hidden="true" size={16} />
        {text.add}
      </Button>
      {onEdit ? (
        <Button onClick={onEdit} variant="secondary">
          <IconEdit aria-hidden="true" size={16} />
          {text.edit}
        </Button>
      ) : null}
    </div>
  )
}
