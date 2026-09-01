'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  IconCheck,
  IconChevronDown,
  IconDeviceFloppy,
  IconEdit,
  IconLanguage,
  IconPhoto,
  IconPlus,
  IconTrash,
  IconX,
} from '@tabler/icons-react'

import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, StatusBadge } from '@/admin-portal/core/ui'

import {
  parseWorkflow,
  type ContentCommandResult,
  type ContentEditorOption,
  type ContentEditorRecord,
} from './contentCommands'
import type { ContentLocale, ContentSummaryItem, ContentTypeId } from './getContentSummary'

type EditorOptions = { categories: ContentEditorOption[]; media: ContentEditorOption[] }
type EditorPayload = { options?: EditorOptions; record?: ContentEditorRecord }
type EditorMode = 'create' | 'edit'
export type ContentEditorNotice = null | { tone: 'danger' | 'success'; value: string }
export interface ContentEditorSaveResult {
  created: boolean
  result: ContentCommandResult
}
export interface ContentEditorHandle {
  isDirty: () => boolean
  saveCurrent: () => Promise<ContentEditorSaveResult | null>
}
export type ContentEditorTransitionRequest = (
  targetTitle: string,
  commit: () => void,
  options?: { locale?: ContentLocale },
) => void

const EMPTY_OPTIONS: EditorOptions = { categories: [], media: [] }
const VERSIONED = new Set<ContentTypeId>(['pages', 'posts', 'knowledge', 'products', 'projects'])
const commitTransitionImmediately: ContentEditorTransitionRequest = (_targetTitle, commit) =>
  commit()

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
    fields: {
      application: 'Application',
      body: 'Body',
      canonicalUrl: 'Canonical URL',
      capabilities: 'Capability Blocks (Title | Description | Badge | Metrics)',
      coverImage: 'Cover image',
      description: 'Description',
      disclaimer: 'Disclaimer / Ordering notes',
      downloadFile: 'Download file',
      engineeringWorkflow: '4-Step Engineering Workflow (Step | Title | Description)',
      downloadType: 'Download type',
      excerpt: 'Excerpt',
      faq: 'Frequently Asked Questions (Question | Answer)',
      featuredImage: 'Featured image',
      gallery: 'Gallery',
      heroImage: 'Hero image',
      internalNotes: 'Internal notes',
      keywords: 'Keywords',
      knowledgeCategory: 'Knowledge category',
      location: 'Location',
      noIndex: 'Exclude from search indexing',
      observedFocus: 'Design Challenge & Observed Focus',
      openGraphImage: 'Open Graph image',
      projectSnapshot: 'Project Snapshot (Scale, Timeline, Scope)',
      qualityVerification: 'Quality Verification & Delivery',
      postCategory: 'Post category',
      productCategory: 'Product category',
      publishedAt: 'Published at',
      resourceMatrix: 'Resource Matrix (Title | Category | Description)',
      roleCards: 'Professional Roles (RoleKey | Title | Description | Deliverables)',
      seoDescription: 'SEO description',
      seoTitle: 'SEO title',
      shortDescription: 'Short description',
      slug: 'Stable slug',
      solutionFramework: 'Solution Framework & Engineering Method',
      sortOrder: 'Sort order',
      specifications: 'Specifications (label | value)',
      summary: 'Summary',
      title: 'Title',
      workflow: '4-Step Engineering Workflow (Step | Title | Description)',
    },
    loading: 'Loading editor...',
    locale: 'Content language',
    mediaChoices: 'Available image previews',
    mediaPreview: 'Image preview',
    options: {
      catalog: 'Catalog',
      certificate: 'Certificate',
      company: 'Company',
      industry: 'Industry',
      materialComparison: 'Material Comparison',
      other: 'Other',
      procurement: 'Procurement Guide',
      products: 'Products',
      projects: 'Projects',
      qualityLogistics: 'Quality & Logistics',
      technicalData: 'Technical data',
      technicalGuide: 'Technical Guide',
    },
    publish: 'Publish',
    publishValidation: 'Complete the required fields before publishing.',
    republish: 'Republish',
    save: 'Save changes',
    saveDraft: 'Save draft',
    savePublished: 'Save and publish',
    saveUnpublished: 'Save',
    saveValidation: 'Complete the required fields before saving.',
    saved: 'Saved. The list has been refreshed.',
    unpublish: 'Unpublish',
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
    fields: {
      application: '应用场景',
      body: '正文',
      canonicalUrl: '规范链接',
      capabilities: '能力卡片 (标题 | 描述 | 徽标 | 核心指标)',
      coverImage: '封面图',
      description: '描述',
      disclaimer: '免责声明 / 订购须知',
      downloadFile: '下载文件',
      engineeringWorkflow: '4 步工程流程 (步骤序号 | 步骤标题 | 步骤说明)',
      downloadType: '资料类型',
      excerpt: '摘要',
      faq: '常见问答 FAQ (问题 | 答案)',
      featuredImage: '特色图',
      gallery: '图库',
      heroImage: '头图',
      internalNotes: '内部备注',
      keywords: '关键词',
      knowledgeCategory: '知识分类',
      location: '项目地点',
      noIndex: '不允许搜索引擎收录',
      observedFocus: '设计挑战与关注点',
      openGraphImage: '社交分享图',
      projectSnapshot: '项目概况（规模、周期、范围）',
      qualityVerification: '质量验证与交付',
      postCategory: '文章分类',
      productCategory: '产品分类',
      publishedAt: '发布时间',
      resourceMatrix: '资源矩阵 (标题 | 分类 | 说明)',
      roleCards: '角色专区 (角色key | 标题 | 说明 | 交付产物)',
      seoDescription: '搜索摘要',
      seoTitle: '搜索标题',
      shortDescription: '简短介绍',
      slug: '固定链接标识',
      solutionFramework: '工程解决方案',
      sortOrder: '排序',
      specifications: '规格参数（名称 | 数值）',
      summary: '摘要',
      title: '标题',
      workflow: '4 步工程流程 (步骤序号 | 步骤标题 | 步骤说明)',
    },
    loading: '正在加载编辑器…',
    locale: '内容语言',
    mediaChoices: '可选图片预览',
    mediaPreview: '图片预览',
    options: {
      catalog: '产品目录',
      certificate: '证书',
      company: '公司动态',
      industry: '行业资讯',
      materialComparison: '材料对比',
      other: '其他',
      procurement: '采购指南',
      products: '产品资讯',
      projects: '项目案例',
      qualityLogistics: '质检与物流',
      technicalData: '技术资料',
      technicalGuide: '技术指南',
    },
    publish: '发布',
    publishValidation: '请先补全必填项，再发布内容。',
    republish: '重新发布',
    save: '保存修改',
    saveDraft: '保存草稿',
    savePublished: '保存并发布',
    saveUnpublished: '保存',
    saveValidation: '请先补全必填项，再保存内容。',
    saved: '保存成功，列表已刷新。',
    unpublish: '下架',
  },
} as const

const errorMessages = {
  en: {
    'content-forbidden': 'You do not have permission to change website content.',
    'content-in-use': 'This content is still referenced and cannot be deleted.',
    'content-invalid-action': 'This operation is not available for the selected content.',
    'content-invalid-id': 'The selected content is no longer available.',
    'content-invalid-input': 'Review the form fields and try again.',
    'content-invalid-json': 'The form data could not be read. Refresh and try again.',
    'content-invalid-locale': 'Select a supported content language.',
    'content-invalid-slug':
      'Use lowercase Latin letters, numbers, and single hyphens for the slug.',
    'content-media-image-required': 'Select an image for this field.',
    'content-media-not-found': 'The selected media is no longer available.',
    'content-module-disabled': 'Website content management is currently disabled.',
    'content-request-too-large': 'The submitted content is too large.',
    'content-slug-conflict': 'This slug is already used by another record.',
    'content-stale': 'This content changed elsewhere. Refresh before saving again.',
    'content-unauthenticated': 'Your session expired. Sign in and try again.',
    'portal-command-conflict': 'This content is being changed. Wait a moment and try again.',
  },
  zh: {
    'content-forbidden': '你没有修改官网内容的权限。',
    'content-in-use': '该内容仍被其他位置引用，暂时无法删除。',
    'content-invalid-action': '当前内容不支持此操作。',
    'content-invalid-id': '所选内容已不存在。',
    'content-invalid-input': '请检查表单内容后重试。',
    'content-invalid-json': '表单数据读取失败，请刷新后重试。',
    'content-invalid-locale': '请选择受支持的内容语言。',
    'content-invalid-slug': '固定链接标识只能使用小写英文字母、数字和单个连字符。',
    'content-media-image-required': '该字段必须选择图片素材。',
    'content-media-not-found': '所选素材已不存在，请重新选择。',
    'content-module-disabled': '官网内容管理当前未启用。',
    'content-request-too-large': '提交的内容体积过大。',
    'content-slug-conflict': '该固定链接标识已被其他内容使用。',
    'content-stale': '内容已被其他人更新，请刷新后再保存。',
    'content-unauthenticated': '登录状态已失效，请重新登录。',
    'portal-command-conflict': '内容正在处理中，请稍后重试。',
  },
} as const

const emptyForm = (locale: 'ar' | 'en') => ({
  action: 'save-draft',
  application: '',
  bodyText: '',
  capabilitiesText: '',
  category: 'industry',
  categoryId: '',
  coverImageId: '',
  description: '',
  disclaimer: '',
  engineeringWorkflowText: '',
  downloadType: 'catalog',
  excerpt: '',
  faqText: '',
  featuredImageId: '',
  fileId: '',
  galleryIds: [] as string[],
  heroImageId: '',
  internalNotes: '',
  isActive: true,
  locale,
  location: '',
  observedFocus: '',
  projectSnapshot: '',
  publishedAt: '',
  qualityVerification: '',
  solutionFramework: '',
  resourceMatrixText: '',
  roleCardsText: '',
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
  workflowText: '',
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
    capabilitiesText: scalar('capabilitiesText'),
    category: scalar('category') || (record.type === 'knowledge' ? 'technical-guide' : 'industry'),
    categoryId: scalar('categoryId'),
    coverImageId: scalar('coverImageId'),
    description: scalar('description'),
    disclaimer: scalar('disclaimer'),
    engineeringWorkflowText: scalar('engineeringWorkflowText'),
    downloadType: scalar('downloadType') || 'catalog',
    excerpt: scalar('excerpt'),
    faqText: scalar('faqText'),
    featuredImageId: scalar('featuredImageId'),
    fileId: scalar('fileId'),
    galleryIds: Array.isArray(data.galleryIds) ? data.galleryIds.map(String) : [],
    heroImageId: scalar('heroImageId'),
    internalNotes: scalar('internalNotes'),
    isActive: data.isActive !== false,
    locale: record.locale,
    location: scalar('location'),
    observedFocus: scalar('observedFocus'),
    projectSnapshot: scalar('projectSnapshot'),
    publishedAt: toDateTimeLocalValue(data.publishedAt),
    qualityVerification: scalar('qualityVerification'),
    solutionFramework: scalar('solutionFramework'),
    resourceMatrixText: scalar('resourceMatrixText'),
    roleCardsText: scalar('roleCardsText'),
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
    workflowText: scalar('workflowText'),
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

class ContentEditorError extends Error {}

const errorMessage = async (
  response: Response,
  locale: 'en' | 'zh',
  fallback: string,
): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } }
    const code = typeof body.error?.code === 'string' ? body.error.code : ''
    return errorMessages[locale][code as keyof (typeof errorMessages)[typeof locale]] ?? fallback
  } catch {
    return fallback
  }
}

const safeErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof ContentEditorError ? error.message : fallback

export function ContentEditorNotice({
  notice,
  onDismiss,
}: {
  notice: Exclude<ContentEditorNotice, null>
  onDismiss?: () => void
}) {
  return (
    <div
      aria-atomic="true"
      aria-live={notice.tone === 'danger' ? 'assertive' : 'polite'}
      className={`portal-content-editor__notice is-${notice.tone}`}
      role={notice.tone === 'danger' ? 'alert' : 'status'}
    >
      <StatusBadge label={notice.value} tone={notice.tone} />
      {onDismiss ? (
        <button aria-label="关闭提示" onClick={onDismiss} title="关闭提示" type="button">
          <IconX aria-hidden="true" size={16} />
        </button>
      ) : null}
    </div>
  )
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

function ImageOption({
  checked,
  disabled = false,
  inputType,
  name,
  onChange,
  option,
  required = false,
}: {
  checked: boolean
  disabled?: boolean
  inputType: 'checkbox' | 'radio'
  name: string
  onChange: () => void
  option: ContentEditorOption
  required?: boolean
}) {
  return (
    <label>
      <input
        checked={checked}
        disabled={disabled}
        name={name}
        onChange={onChange}
        required={required}
        type={inputType}
        value={String(option.id)}
      />
      <span className="portal-content-editor__image-tile">
        <span className="portal-content-editor__image-preview">
          {option.previewUrl ? (
            <Image alt="" fill sizes="160px" src={option.previewUrl} unoptimized />
          ) : (
            <IconPhoto aria-hidden="true" size={22} stroke={1.6} />
          )}
        </span>
        <span title={option.label}>{option.label}</span>
        <span aria-hidden="true" className="portal-content-editor__image-check">
          <IconCheck size={14} stroke={2.2} />
        </span>
      </span>
    </label>
  )
}

function ImageSelect({
  label,
  name,
  onChange,
  options,
  required = false,
  value,
}: {
  label: string
  name: string
  onChange: (value: string) => void
  options: ContentEditorOption[]
  required?: boolean
  value: string
}) {
  return (
    <fieldset className="portal-content-editor__media-field">
      <legend>{label}</legend>
      {!required && value ? (
        <button
          aria-label={`清除${label}`}
          className="portal-content-editor__media-clear"
          onClick={() => onChange('')}
          title={`清除${label}`}
          type="button"
        >
          <IconX aria-hidden="true" size={15} />
        </button>
      ) : null}
      <div className="portal-content-editor__image-grid">
        {options.map((option) => (
          <ImageOption
            checked={String(option.id) === value}
            inputType="radio"
            key={option.id}
            name={name}
            onChange={() => onChange(String(option.id))}
            option={option}
            required={required}
          />
        ))}
      </div>
    </fieldset>
  )
}

function GallerySelect({
  label,
  name,
  onChange,
  options,
  value,
}: {
  label: string
  name: string
  onChange: (value: string[]) => void
  options: ContentEditorOption[]
  value: string[]
}) {
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((current) => current !== id) : [...value, id])

  return (
    <fieldset className="portal-content-editor__media-field is-wide">
      <legend>{label}</legend>
      <div className="portal-content-editor__image-grid">
        {options.map((option) => {
          const optionId = String(option.id)
          const checked = value.includes(optionId)
          return (
            <ImageOption
              checked={checked}
              disabled={!checked && value.length >= 12}
              inputType="checkbox"
              key={option.id}
              name={name}
              onChange={() => toggle(optionId)}
              option={option}
            />
          )
        })}
      </div>
    </fieldset>
  )
}

export const ContentEditor = forwardRef<
  ContentEditorHandle,
  {
    initialLocale?: ContentLocale
    item: ContentSummaryItem | null
    mode: EditorMode
    onClose: (force?: boolean) => void
    onNotice?: (notice: ContentEditorNotice) => void
    onRequestTransition?: ContentEditorTransitionRequest
    type: ContentTypeId
  }
>(function ContentEditor(
  {
    initialLocale = 'en',
    item,
    mode,
    onClose,
    onNotice,
    onRequestTransition = commitTransitionImmediately,
    type,
  },
  ref,
) {
  const router = useRouter()
  const { locale: portalLocale } = usePortalPreferences()
  const messages = getPortalMessages(portalLocale).websiteContent
  const text = copy[portalLocale]
  const editorRef = useRef<HTMLElement>(null)
  const [form, setForm] = useState<EditorForm>(() => emptyForm(initialLocale))
  const [loadTarget, setLoadTarget] = useState(() => ({ locale: initialLocale, revision: 0 }))
  const [options, setOptions] = useState<EditorOptions>(EMPTY_OPTIONS)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<ContentEditorNotice>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const baselineRef = useRef(JSON.stringify(emptyForm(initialLocale)))
  const showNotice = useCallback(
    (nextNotice: ContentEditorNotice) => {
      setNotice(nextNotice)
      onNotice?.(nextNotice)
    },
    [onNotice],
  )

  const recordURL = useMemo(
    () =>
      mode === 'edit' && item
        ? `/api/portal/content/${type}/${item.id}?locale=${loadTarget.locale}`
        : `/api/portal/content/${type}`,
    [item, loadTarget.locale, mode, type],
  )

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timer = setTimeout(() => {
      if (!active) return
      setLoading(true)
      showNotice(null)
      void fetch(recordURL, { cache: 'no-store', signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            throw new ContentEditorError(await errorMessage(response, portalLocale, text.error))
          }
          return (await response.json()) as EditorPayload
        })
        .then((payload) => {
          if (!active) return
          setOptions(payload.options ?? EMPTY_OPTIONS)
          const nextForm = payload.record
            ? normalizeForm(payload.record)
            : emptyForm(loadTarget.locale)
          baselineRef.current = JSON.stringify(nextForm)
          setForm(nextForm)
        })
        .catch((error: unknown) => {
          if (active && (error as { name?: string }).name !== 'AbortError') {
            showNotice({
              tone: 'danger',
              value: safeErrorMessage(error, text.error),
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
  }, [loadTarget, portalLocale, recordURL, showNotice, text.error])

  const update = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const requestLocaleChange = (nextLocale: 'ar' | 'en') => {
    if (nextLocale === form.locale && nextLocale === loadTarget.locale) return
    onRequestTransition(
      nextLocale === 'en' ? text.english : text.arabic,
      () => {
        setLoading(true)
        setLoadTarget((current) => ({ locale: nextLocale, revision: current.revision + 1 }))
      },
      { locale: nextLocale },
    )
  }

  const requestBody = (action: string) => ({
    ...form,
    action,
    engineeringWorkflow: parseWorkflow(form.engineeringWorkflowText),
    publishedAt: toISOStringOrEmpty(form.publishedAt),
    specifications: parseSpecifications(form.specificationsText),
  })

  const save = async (
    action: string,
    { closeAfterCreate = true }: { closeAfterCreate?: boolean } = {},
  ): Promise<ContentEditorSaveResult | null> => {
    const invalid =
      action === 'publish' || action === 'unpublish'
        ? editorRef.current?.querySelector<
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          >(':invalid')
        : null
    if (invalid) {
      const validationMessage =
        invalid instanceof HTMLInputElement && invalid.validity.patternMismatch
          ? errorMessages[portalLocale]['content-invalid-slug']
          : action === 'publish'
            ? text.publishValidation
            : text.saveValidation
      showNotice({ tone: 'danger', value: validationMessage })
      invalid.setCustomValidity(validationMessage)
      invalid.reportValidity()
      invalid.focus({ preventScroll: true })
      if (typeof invalid.scrollIntoView === 'function') {
        invalid.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      const clearCustomValidity = () => invalid.setCustomValidity('')
      invalid.addEventListener('input', clearCustomValidity, { once: true })
      invalid.addEventListener('change', clearCustomValidity, { once: true })
      return null
    }

    setBusy(true)
    showNotice(null)
    try {
      const url =
        mode === 'edit' && item
          ? `/api/portal/content/${type}/${item.id}`
          : `/api/portal/content/${type}`
      const response = await fetch(url, {
        body: JSON.stringify(requestBody(action)),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `portal-content:${crypto.randomUUID()}`,
        },
        method: mode === 'edit' ? 'PATCH' : 'POST',
      })
      if (!response.ok) {
        throw new ContentEditorError(await errorMessage(response, portalLocale, text.error))
      }
      const body = (await response.json()) as { result?: ContentCommandResult }
      if (!body.result) {
        throw new ContentEditorError(text.error)
      }
      const nextForm = {
        ...form,
        updatedAt: body.result.updatedAt,
      }
      baselineRef.current = JSON.stringify(nextForm)
      setForm(nextForm)
      showNotice({ tone: 'success', value: text.saved })
      router.refresh()
      if (mode === 'create' && closeAfterCreate) onClose(true)
      return { created: mode === 'create', result: body.result }
    } catch (error) {
      showNotice({ tone: 'danger', value: safeErrorMessage(error, text.error) })
      return null
    } finally {
      setBusy(false)
    }
  }

  const defaultSaveAction = VERSIONED.has(type)
    ? item?.status === 'published'
      ? 'publish'
      : item?.status === 'unpublished'
        ? 'unpublish'
        : 'save-draft'
    : 'save'

  useImperativeHandle(ref, () => ({
    isDirty: () => JSON.stringify(form) !== baselineRef.current,
    saveCurrent: () => save(defaultSaveAction, { closeAfterCreate: false }),
  }))

  const remove = async () => {
    if (!item) return
    setBusy(true)
    showNotice(null)
    try {
      const response = await fetch(`/api/portal/content/${type}/${item.id}`, {
        body: JSON.stringify({ locale: form.locale, updatedAt: form.updatedAt }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `portal-content:${crypto.randomUUID()}`,
        },
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new ContentEditorError(await errorMessage(response, portalLocale, text.error))
      }
      router.refresh()
      onClose(true)
    } catch (error) {
      showNotice({ tone: 'danger', value: safeErrorMessage(error, text.error) })
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
      ref={editorRef}
    >
      <header className="portal-content-editor__header">
        <div>
          <p>{messages.collections[type]}</p>
          <h3>{mode === 'create' ? text.add : text.edit}</h3>
        </div>
        <Button aria-label={text.cancel} onClick={() => onClose()} size="icon" variant="ghost">
          <IconX aria-hidden="true" size={18} />
        </Button>
      </header>

      <div className="portal-content-editor__locale" role="group" aria-label={text.locale}>
        <IconLanguage aria-hidden="true" size={17} />
        <button
          aria-pressed={form.locale === 'en'}
          disabled={busy}
          onClick={() => requestLocaleChange('en')}
          type="button"
        >
          {text.english}
        </button>
        <button
          aria-pressed={form.locale === 'ar'}
          disabled={busy}
          onClick={() => requestLocaleChange('ar')}
          type="button"
        >
          {text.arabic}
        </button>
      </div>

      {notice && !onNotice ? <ContentEditorNotice notice={notice} /> : null}

      <div className="portal-content-editor__fields" dir={form.locale === 'ar' ? 'rtl' : 'ltr'}>
        <Field label={text.fields.title}>
          <input
            maxLength={200}
            onChange={(event) => update('title', event.target.value)}
            required
            value={form.title}
          />
        </Field>
        <Field label={text.fields.slug}>
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
          <Field label={text.fields.summary} wide>
            <textarea
              maxLength={1000}
              onChange={(event) => update('summary', event.target.value)}
              rows={3}
              required
              value={form.summary}
            />
          </Field>
        ) : null}
        {type === 'products' ? (
          <Field label={text.fields.shortDescription} wide>
            <textarea
              maxLength={1000}
              onChange={(event) => update('shortDescription', event.target.value)}
              rows={3}
              required
              value={form.shortDescription}
            />
          </Field>
        ) : null}
        {type === 'posts' || type === 'knowledge' ? (
          <Field label={text.fields.excerpt} wide>
            <textarea
              maxLength={1000}
              onChange={(event) => update('excerpt', event.target.value)}
              rows={3}
              required
              value={form.excerpt}
            />
          </Field>
        ) : null}
        {type === 'product-categories' || type === 'downloads' ? (
          <Field label={text.fields.description} wide>
            <textarea
              maxLength={5000}
              onChange={(event) => update('description', event.target.value)}
              rows={4}
              value={form.description}
            />
          </Field>
        ) : null}
        {VERSIONED.has(type) ? (
          <Field label={text.fields.body} wide>
            <textarea
              maxLength={80_000}
              onChange={(event) => update('bodyText', event.target.value)}
              rows={10}
              required
              value={form.bodyText}
            />
          </Field>
        ) : null}

        {type === 'products' ? (
          <Field label={text.fields.productCategory}>
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
          <Field label={text.fields.postCategory}>
            <select
              onChange={(event) => update('category', event.target.value)}
              value={form.category}
            >
              <option value="industry">{text.options.industry}</option>
              <option value="products">{text.options.products}</option>
              <option value="projects">{text.options.projects}</option>
              <option value="company">{text.options.company}</option>
            </select>
          </Field>
        ) : null}
        {type === 'knowledge' ? (
          <Field label={text.fields.knowledgeCategory}>
            <select
              onChange={(event) => update('category', event.target.value)}
              value={form.category}
            >
              <option value="technical-guide">{text.options.technicalGuide}</option>
              <option value="material-comparison">{text.options.materialComparison}</option>
              <option value="procurement">{text.options.procurement}</option>
              <option value="quality-logistics">{text.options.qualityLogistics}</option>
            </select>
          </Field>
        ) : null}
        {type === 'downloads' ? (
          <Field label={text.fields.downloadType}>
            <select
              onChange={(event) => update('downloadType', event.target.value)}
              value={form.downloadType}
            >
              <option value="catalog">{text.options.catalog}</option>
              <option value="technical-data">{text.options.technicalData}</option>
              <option value="certificate">{text.options.certificate}</option>
              <option value="other">{text.options.other}</option>
            </select>
          </Field>
        ) : null}

        {type === 'pages' ? (
          <ImageSelect
            label={text.fields.heroImage}
            name="heroImageId"
            onChange={(value) => update('heroImageId', value)}
            options={imageMediaOptions}
            required
            value={form.heroImageId}
          />
        ) : null}
        {type === 'products' || type === 'projects' ? (
          <ImageSelect
            label={text.fields.coverImage}
            name="coverImageId"
            onChange={(value) => update('coverImageId', value)}
            options={imageMediaOptions}
            required
            value={form.coverImageId}
          />
        ) : null}
        {type === 'posts' || type === 'knowledge' ? (
          <ImageSelect
            label={text.fields.featuredImage}
            name="featuredImageId"
            onChange={(value) => update('featuredImageId', value)}
            options={imageMediaOptions}
            required
            value={form.featuredImageId}
          />
        ) : null}
        {type === 'downloads' ? (
          <Field label={text.fields.downloadFile}>
            <select
              onChange={(event) => update('fileId', event.target.value)}
              required
              value={form.fileId}
            >
              <option value="">—</option>
              {options.media.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.label}
                  {option.meta ? ` · ${option.meta}` : ''}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {type === 'downloads' ? (
          <ImageSelect
            label={text.fields.coverImage}
            name="downloadCoverImageId"
            onChange={(value) => update('coverImageId', value)}
            options={imageMediaOptions}
            value={form.coverImageId}
          />
        ) : null}

        {type === 'products' || type === 'projects' ? (
          <GallerySelect
            label={text.fields.gallery}
            name="galleryIds"
            onChange={(value) => update('galleryIds', value)}
            options={imageMediaOptions}
            value={form.galleryIds}
          />
        ) : null}

        {type === 'pages' ? (
          <>
            <details className="portal-content-editor__section is-wide">
              <summary>
                <IconChevronDown aria-hidden="true" size={16} />{" "}
                {portalLocale === 'zh'
                  ? '能力与工程流程（Capabilities & Workflow）'
                  : 'Capabilities & Workflow Blocks'}
              </summary>
              <div className="portal-content-editor__fields">
                <Field label={text.fields.capabilities} wide>
                  <textarea
                    maxLength={10000}
                    onChange={(event) => update('capabilitiesText', event.target.value)}
                    placeholder={
                      portalLocale === 'zh'
                        ? '复杂曲面加工 | 具备高精度双曲弯弧与无痕焊接能力 | 核心工艺 | 精度 ±0.5mm'
                        : 'Complex Fabrication | High-precision curved forming and seamless welding | Core Process | Tolerance ±0.5mm'
                    }
                    rows={4}
                    value={form.capabilitiesText}
                  />
                </Field>
                <Field label={text.fields.workflow} wide>
                  <textarea
                    maxLength={10000}
                    onChange={(event) => update('workflowText', event.target.value)}
                    placeholder={
                      portalLocale === 'zh'
                        ? '1 | 设计深化 | 3D建模与节点深化设计\n2 | 复杂成型 | 高精度数控弯圆成型\n3 | 打样质检 | 1:1实物样板与严苛质检\n4 | 全球交付 | 专用木箱与全球海运跟踪'
                        : '1 | Design & Engineering | 3D parametric modeling\n2 | Complex Fabrication | High-precision CNC forming\n3 | Mock-up & QC | 1:1 physical sample and QA\n4 | Global Delivery | Protected crate packaging'
                    }
                    rows={4}
                    value={form.workflowText}
                  />
                </Field>
              </div>
            </details>

            <details className="portal-content-editor__section is-wide">
              <summary>
                <IconChevronDown aria-hidden="true" size={16} />{" "}
                {portalLocale === 'zh'
                  ? '专业角色与问答专区（For Professionals & FAQ）'
                  : 'For Professionals & FAQ Blocks'}
              </summary>
              <div className="portal-content-editor__fields">
                <Field label={text.fields.roleCards} wide>
                  <textarea
                    maxLength={10000}
                    onChange={(event) => update('roleCardsText', event.target.value)}
                    placeholder={
                      portalLocale === 'zh'
                        ? 'architects | 建筑师与方案深化 | 完美还原设计曲线与自由曲面 | 3D参数化模型与节点构造图'
                        : 'architects | Architects & Designers | Realize complex freeform designs | 3D parametric models and shop drawings'
                    }
                    rows={4}
                    value={form.roleCardsText}
                  />
                </Field>
                <Field label={text.fields.resourceMatrix} wide>
                  <textarea
                    maxLength={10000}
                    onChange={(event) => update('resourceMatrixText', event.target.value)}
                    placeholder={
                      portalLocale === 'zh'
                        ? '双曲铝板深化节点图集 | CAD图纸 | 包含常规幕墙收口与防漏设计节点'
                        : 'Double-Curved Panel Detail Library | CAD Drawings | Standard curtain wall junction and flashing details'
                    }
                    rows={3}
                    value={form.resourceMatrixText}
                  />
                </Field>
                <Field label={text.fields.faq} wide>
                  <textarea
                    maxLength={10000}
                    onChange={(event) => update('faqText', event.target.value)}
                    placeholder={
                      portalLocale === 'zh'
                        ? '双曲铝板如何保证施工现场拼缝精度？ | 我们提供出厂前 1:1 预拼装与三维激光扫描检测。'
                        : 'How is on-site joint precision guaranteed? | We provide factory 1:1 trial assembly and laser 3D scanning verification.'
                    }
                    rows={4}
                    value={form.faqText}
                  />
                </Field>
              </div>
            </details>
          </>
        ) : null}

        {type === 'products' ? (
          <>
            <Field label={text.fields.engineeringWorkflow} wide>
              <textarea
                maxLength={10000}
                onChange={(event) => update('engineeringWorkflowText', event.target.value)}
                placeholder={
                  portalLocale === 'zh'
                    ? '1 | 设计深化 | 3D建模与节点深化设计\n2 | 复杂成型 | 高精度数控弯圆成型\n3 | 打样质检 | 1:1实物样板与严苛质检\n4 | 全球交付 | 专用木箱与全球海运跟踪'
                    : '1 | Design & Engineering | 3D parametric modeling\n2 | Complex Fabrication | High-precision CNC forming\n3 | Mock-up & QC | 1:1 physical sample and QA\n4 | Global Delivery | Protected crate packaging'
                }
                rows={4}
                value={form.engineeringWorkflowText}
              />
            </Field>
            <Field label={text.fields.disclaimer} wide>
              <textarea
                maxLength={5000}
                onChange={(event) => update('disclaimer', event.target.value)}
                placeholder={
                  portalLocale === 'zh'
                    ? '参考参数以最终工程图纸、确认样品与合同技术协议为准。'
                    : 'Parameters are reference values. Final specifications are governed by approved shop drawings and contract.'
                }
                rows={3}
                value={form.disclaimer}
              />
            </Field>
          </>
        ) : null}
        {type === 'products' ? (
          <Field label={text.fields.specifications} wide>
            <textarea
              onChange={(event) => update('specificationsText', event.target.value)}
              placeholder={portalLocale === 'zh' ? '厚度 | 2.0 毫米' : 'Thickness | 2.0 mm'}
              rows={5}
              value={form.specificationsText}
            />
          </Field>
        ) : null}
        {type === 'projects' ? (
          <details className="portal-content-editor__section is-wide">
            <summary>
              <IconChevronDown aria-hidden="true" size={16} />{" "}
              {portalLocale === 'zh'
                ? '工程案例四维结构（Case Study 4D Structure）'
                : 'Four-Dimensional Case Study Structure'}
            </summary>
            <div className="portal-content-editor__fields">
              <Field label={text.fields.projectSnapshot} wide>
                <textarea
                  maxLength={5000}
                  onChange={(event) => update('projectSnapshot', event.target.value)}
                  placeholder={
                    portalLocale === 'zh'
                      ? '项目规模、工期要求与幕墙覆盖范围概况。'
                      : 'Project scale, timeline, and envelope scope snapshot.'
                  }
                  rows={3}
                  value={form.projectSnapshot}
                />
              </Field>
              <Field label={text.fields.observedFocus} wide>
                <textarea
                  maxLength={5000}
                  onChange={(event) => update('observedFocus', event.target.value)}
                  placeholder={
                    portalLocale === 'zh'
                      ? '建筑曲面造型难点、节点连接要求与结构公差挑战。'
                      : 'Freeform curvature, joint interface requirements, and structural tolerance challenges.'
                  }
                  rows={3}
                  value={form.observedFocus}
                />
              </Field>
              <Field label={text.fields.solutionFramework} wide>
                <textarea
                  maxLength={5000}
                  onChange={(event) => update('solutionFramework', event.target.value)}
                  placeholder={
                    portalLocale === 'zh'
                      ? '3D参数化分格拆件、数控滚弯与装配深化工程方案。'
                      : 'Parametric panelization, CNC roll-bending, and fabrication engineering framework.'
                  }
                  rows={3}
                  value={form.solutionFramework}
                />
              </Field>
              <Field label={text.fields.qualityVerification} wide>
                <textarea
                  maxLength={5000}
                  onChange={(event) => update('qualityVerification', event.target.value)}
                  placeholder={
                    portalLocale === 'zh'
                      ? '1:1样板试拼装、三维激光扫描检测与现场平整度质量结果。'
                      : '1:1 trial assembly, 3D laser scan inspection, and installed flatness verification.'
                  }
                  rows={3}
                  value={form.qualityVerification}
                />
              </Field>
            </div>
          </details>
        ) : null}
        {type === 'projects' ? (
          <>
            <Field label={text.fields.location}>
              <input
                onChange={(event) => update('location', event.target.value)}
                required
                value={form.location}
              />
            </Field>
            <Field label={text.fields.application}>
              <input
                onChange={(event) => update('application', event.target.value)}
                required
                value={form.application}
              />
            </Field>
          </>
        ) : null}
        {type === 'product-categories' ? (
          <Field label={text.fields.sortOrder}>
            <input
              min={0}
              onChange={(event) => update('sortOrder', event.target.value)}
              type="number"
              value={form.sortOrder}
            />
          </Field>
        ) : null}
        {type === 'posts' || type === 'knowledge' ? (
          <Field label={text.fields.publishedAt}>
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
            <Field label={text.fields.seoTitle}>
              <input
                maxLength={70}
                onChange={(event) => update('seoTitle', event.target.value)}
                required
                value={form.seoTitle}
              />
            </Field>
            <Field label={text.fields.canonicalUrl}>
              <input
                dir="ltr"
                onChange={(event) => update('seoCanonical', event.target.value)}
                value={form.seoCanonical}
              />
            </Field>
            <Field label={text.fields.seoDescription} wide>
              <textarea
                maxLength={180}
                onChange={(event) => update('seoDescription', event.target.value)}
                required
                rows={3}
                value={form.seoDescription}
              />
            </Field>
            <Field label={text.fields.keywords} wide>
              <textarea
                onChange={(event) => update('seoKeywords', event.target.value)}
                rows={2}
                value={form.seoKeywords}
              />
            </Field>
            <ImageSelect
              label={text.fields.openGraphImage}
              name="seoOgImageId"
              onChange={(value) => update('seoOgImageId', value)}
              options={imageMediaOptions}
              value={form.seoOgImageId}
            />
            <label className="portal-content-editor__checkbox">
              <input
                checked={form.seoNoIndex}
                onChange={(event) => update('seoNoIndex', event.target.checked)}
                type="checkbox"
              />{' '}
              {text.fields.noIndex}
            </label>
          </div>
        </details>

        {['pages', 'products', 'projects', 'posts', 'knowledge'].includes(type) ? (
          <Field label={text.fields.internalNotes} wide>
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
        <Button disabled={busy} onClick={() => void save(defaultSaveAction)} variant="secondary">
          <IconDeviceFloppy aria-hidden="true" size={16} />
          {defaultSaveAction === 'publish'
            ? text.savePublished
            : defaultSaveAction === 'unpublish'
              ? text.saveUnpublished
              : VERSIONED.has(type)
                ? text.saveDraft
                : text.save}
        </Button>
        {VERSIONED.has(type) && item?.status !== 'published' ? (
          <Button disabled={busy} onClick={() => void save('publish')}>
            <IconCheck aria-hidden="true" size={16} />
            {item?.status === 'unpublished' ? text.republish : text.publish}
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
})

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
