'use client'

import {
  IconAlertCircle,
  IconCheck,
  IconFile,
  IconFileTypePdf,
  IconPaperclip,
  IconRefresh,
  IconSend,
  IconUpload,
  IconX,
} from '@tabler/icons-react'
import React, { useRef, useState } from 'react'

import { createIdempotencyKey } from '@/lib/inquiries/idempotency'
import { type Locale } from '@/lib/i18n'
import { getWebsiteV17Copy } from '@/lib/website-i18n'
import {
  type InquiryAttachmentReference,
  type InquiryField,
  type InquiryValidationCode,
  validateInquiry,
} from '@/lib/validation/inquiry'

const LEAD_ATTACHMENT_MAX_FILES = 5
const LEAD_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024 // 50 MB
const LEAD_ATTACHMENT_MAX_TOTAL_BYTES = 200 * 1024 * 1024 // 200 MB
const UPLOAD_TIMEOUT_MS = 120_000 // 120s timeout per requirement

const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.dwg',
  '.dxf',
  '.step',
  '.stp',
  '.3dm',
  '.iges',
  '.igs',
  '.xlsx',
  '.xls',
  '.csv',
  '.zip',
  '.rar',
  '.7z',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
] as const

const ALLOWED_EXTENSIONS_ACCEPT = ALLOWED_EXTENSIONS.join(',')

type FormField = 'country' | 'email' | 'message' | 'name' | 'phone'

export type AttachmentItem = {
  error?: string
  file: File
  id: string
  name: string
  progress: number
  serverAttachmentId?: number | string
  size: number
  status: 'error' | 'success' | 'uploading'
  ticket?: string
  xhr?: XMLHttpRequest
}

type InquiryAPIResponse =
  | { duplicate: boolean; ok: true; requestId: string }
  | {
      code: string
      errors?: Partial<Record<InquiryField, InquiryValidationCode>>
      ok: false
      requestId: string
      retryAfterSeconds?: number
    }

let attachmentCounter = 0
const generateAttachmentId = (file: File): string => {
  attachmentCounter += 1
  const sanitized = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
  return `att-${attachmentCounter}-${sanitized}`
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const getFileExtension = (filename: string): string => {
  const lastDot = filename.lastIndexOf('.')
  return lastDot !== -1 ? filename.slice(lastDot).toLowerCase() : ''
}

const isAllowedExtension = (filename: string): boolean => {
  const ext = getFileExtension(filename)
  return ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])
}

const formInput = (
  form: HTMLFormElement,
  idempotencyKey: string,
  locale: Locale,
  attachments?: InquiryAttachmentReference[],
): Record<string, unknown> => {
  const data = Object.fromEntries(new FormData(form).entries())
  const url = new URL(window.location.href)

  return {
    ...data,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    idempotencyKey,
    locale,
    sourceURL: url.toString(),
    utmCampaign: url.searchParams.get('utm_campaign') || '',
    utmContent: url.searchParams.get('utm_content') || '',
    utmMedium: url.searchParams.get('utm_medium') || '',
    utmSource: url.searchParams.get('utm_source') || '',
    utmTerm: url.searchParams.get('utm_term') || '',
  }
}

export function InquiryForm({
  initialIdempotencyKey,
  initialInterest = '',
  locale,
}: {
  initialIdempotencyKey: string
  initialInterest?: string
  locale: Locale
}) {
  const copy = getWebsiteV17Copy(locale)
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [attachmentError, setAttachmentError] = useState<string>('')
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({})
  const [idempotencyKey, setIdempotencyKey] = useState(initialIdempotencyKey)
  const [isDragging, setIsDragging] = useState(false)
  const [requestId, setRequestId] = useState('')
  const [, setSessionTicket] = useState<string | null>(null)
  const [status, setStatus] = useState<'error' | 'idle' | 'submitting' | 'success'>('idle')
  const [statusMessage, setStatusMessage] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const sessionTicketRef = useRef<string | null>(null)

  const validationMessage = (code: InquiryValidationCode): string => {
    if (code === 'required') return copy.contact.required
    if (code === 'invalid_email') return copy.contact.invalidEmail
    if (code === 'invalid_phone') return copy.contact.invalidPhone
    if (code === 'too_long') return copy.contact.tooLong
    return copy.contact.invalidField
  }

  const mapErrors = (
    fieldErrors: Partial<Record<InquiryField, InquiryValidationCode>> | undefined,
  ): Partial<Record<FormField, string>> => {
    const result: Partial<Record<FormField, string>> = {}
    for (const field of ['name', 'email', 'phone', 'country', 'message'] as const) {
      const code = fieldErrors?.[field]
      if (code) result[field] = validationMessage(code)
    }
    return result
  }

  const mapUploadError = (code?: string): string => {
    if (code === 'file_too_large') return copy.contact.attachmentsFileTooLarge
    if (code === 'too_many_attachments') return copy.contact.attachmentsMaxFilesReached
    if (code === 'total_size_exceeded') return copy.contact.attachmentsTotalSizeExceeded
    if (
      code === 'invalid_filename' ||
      code === 'invalid_mime_type' ||
      code === 'invalid_file_bytes'
    ) {
      return copy.contact.attachmentsInvalidFileType
    }
    if (code === 'rate_limited') return copy.contact.rateLimited
    return copy.contact.attachmentsUploadFailed
  }

  const startUpload = (item: AttachmentItem, ticketOverride?: string) => {
    const xhr = new XMLHttpRequest()
    item.xhr = xhr
    xhr.timeout = UPLOAD_TIMEOUT_MS

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100)
        setAttachments((prev) =>
          prev.map((a) => (a.id === item.id ? { ...a, progress } : a)),
        )
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText)
          if (data.ok && data.attachment) {
            const ticket = data.ticket || ticketOverride || sessionTicketRef.current
            if (data.ticket) {
              sessionTicketRef.current = data.ticket
              setSessionTicket(data.ticket)
            }
            setAttachments((prev) =>
              prev.map((a) =>
                a.id === item.id
                  ? {
                      ...a,
                      progress: 100,
                      serverAttachmentId: data.attachment.id,
                      status: 'success',
                      ticket,
                      xhr: undefined,
                    }
                  : a,
              ),
            )
            return
          }
        } catch {
          // fallthrough to error
        }
      }

      let errorCode: string | undefined
      try {
        const data = JSON.parse(xhr.responseText)
        errorCode = data.code
      } catch {
        // ignore
      }

      setAttachments((prev) =>
        prev.map((a) =>
          a.id === item.id
            ? {
                ...a,
                error: mapUploadError(errorCode),
                status: 'error',
                xhr: undefined,
              }
            : a,
        ),
      )
    }

    xhr.ontimeout = () => {
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === item.id
            ? {
                ...a,
                error: copy.contact.attachmentsUploadFailed,
                status: 'error',
                xhr: undefined,
              }
            : a,
        ),
      )
    }

    xhr.onerror = () => {
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === item.id
            ? {
                ...a,
                error: copy.contact.attachmentsUploadFailed,
                status: 'error',
                xhr: undefined,
              }
            : a,
        ),
      )
    }

    const formData = new FormData()
    formData.append('file', item.file)
    const ticketToUse = ticketOverride || sessionTicketRef.current
    if (ticketToUse) {
      formData.append('ticket', ticketToUse)
    }

    xhr.open('POST', '/api/inquiries/attachments/upload')
    xhr.setRequestHeader('accept', 'application/json')
    xhr.send(formData)
  }

  const handleFiles = async (fileList: FileList | File[]) => {
    setAttachmentError('')
    const incoming = Array.from(fileList)
    if (incoming.length === 0) return

    const currentValid = attachments.filter((a) => a.status !== 'error')
    const availableSlots = LEAD_ATTACHMENT_MAX_FILES - currentValid.length

    if (availableSlots <= 0) {
      setAttachmentError(copy.contact.attachmentsMaxFilesReached)
      return
    }

    const toProcess = incoming.slice(0, availableSlots)
    if (incoming.length > availableSlots) {
      setAttachmentError(copy.contact.attachmentsMaxFilesReached)
    }

    let ticketToUse = sessionTicketRef.current
    if (!ticketToUse) {
      try {
        const res = await fetch('/api/inquiries/attachments/ticket', {
          headers: { accept: 'application/json' },
          method: 'POST',
        })
        if (res.ok) {
          const data = await res.json()
          if (data.ok && data.ticket) {
            ticketToUse = data.ticket
            sessionTicketRef.current = data.ticket
            setSessionTicket(data.ticket)
          }
        }
      } catch {
        // Ignore, uploads will request or issue on the fly
      }
    }

    let currentTotalBytes = currentValid.reduce((sum, a) => sum + a.size, 0)
    const newItems: AttachmentItem[] = []

    for (const file of toProcess) {
      const id = generateAttachmentId(file)
      const filename = file.name
      const size = file.size

      if (!isAllowedExtension(filename)) {
        newItems.push({
          error: copy.contact.attachmentsInvalidFileType,
          file,
          id,
          name: filename,
          progress: 0,
          size,
          status: 'error',
        })
        continue
      }

      if (size > LEAD_ATTACHMENT_MAX_BYTES) {
        newItems.push({
          error: copy.contact.attachmentsFileTooLarge,
          file,
          id,
          name: filename,
          progress: 0,
          size,
          status: 'error',
        })
        continue
      }

      if (currentTotalBytes + size > LEAD_ATTACHMENT_MAX_TOTAL_BYTES) {
        newItems.push({
          error: copy.contact.attachmentsTotalSizeExceeded,
          file,
          id,
          name: filename,
          progress: 0,
          size,
          status: 'error',
        })
        continue
      }

      currentTotalBytes += size
      newItems.push({
        file,
        id,
        name: filename,
        progress: 0,
        size,
        status: 'uploading',
      })
    }

    setAttachments((prev) => [...prev, ...newItems])

    for (const item of newItems) {
      if (item.status === 'uploading') {
        startUpload(item, ticketToUse || undefined)
      }
    }
  }

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      void handleFiles(event.target.files)
      event.target.value = ''
    }
  }

  const handleCancelUpload = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target?.xhr) {
        target.xhr.abort()
      }
      return prev.filter((a) => a.id !== id)
    })
  }

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target?.xhr) {
        target.xhr.abort()
      }
      return prev.filter((a) => a.id !== id)
    })
  }

  const handleRetryUpload = (id: string) => {
    const item = attachments.find((a) => a.id === id)
    if (!item) return

    const currentValid = attachments.filter((a) => a.status !== 'error' && a.id !== id)
    if (currentValid.length >= LEAD_ATTACHMENT_MAX_FILES) {
      setAttachmentError(copy.contact.attachmentsMaxFilesReached)
      return
    }

    const retriedItem: AttachmentItem = {
      ...item,
      error: undefined,
      progress: 0,
      status: 'uploading',
    }

    setAttachments((prev) =>
      prev.map((a) => (a.id === id ? retriedItem : a)),
    )

    startUpload(retriedItem)
  }

  const validAttachments = attachments.filter((a) => a.status !== 'error')
  const totalAttachmentBytes = validAttachments.reduce((sum, a) => sum + a.size, 0)
  const isDropzoneDisabled = validAttachments.length >= LEAD_ATTACHMENT_MAX_FILES

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault()
    if (!isDropzoneDisabled) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(false)
    if (!isDropzoneDisabled && event.dataTransfer.files) {
      void handleFiles(event.dataTransfer.files)
    }
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget

    const isUploading = attachments.some((a) => a.status === 'uploading')
    if (isUploading) {
      setStatus('error')
      setStatusMessage(copy.contact.attachmentsPendingWait)
      return
    }

    const successfulAttachments: InquiryAttachmentReference[] = attachments
      .filter((a) => a.status === 'success' && a.serverAttachmentId && a.ticket)
      .map((a) => ({
        id: a.serverAttachmentId!,
        ticket: a.ticket!,
      }))

    const input = formInput(form, idempotencyKey, locale, successfulAttachments)
    const validation = validateInquiry(input)

    if (!validation.ok) {
      setErrors(mapErrors(validation.errors))
      setRequestId('')
      setStatus('error')
      setStatusMessage(copy.contact.reviewFields)
      return
    }

    setErrors({})
    setRequestId('')
    setStatus('submitting')
    setStatusMessage(copy.contact.sending)

    try {
      const response = await fetch('/api/inquiries', {
        body: JSON.stringify(input),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        method: 'POST',
      })
      const body = (await response.json()) as InquiryAPIResponse

      if (!body.ok) {
        setErrors(mapErrors(body.errors))
        setRequestId(body.requestId)
        setStatus('error')
        setStatusMessage(
          body.code === 'rate_limited' ? copy.contact.rateLimited : copy.contact.unavailable,
        )
        return
      }

      setStatus('success')
      setStatusMessage(copy.contact.received)
      setRequestId(body.requestId)
      setIdempotencyKey(createIdempotencyKey())
      setAttachments([])
      setSessionTicket(null)
      sessionTicketRef.current = null
      form.reset()
    } catch {
      setStatus('error')
      setStatusMessage(copy.contact.unavailable)
    }
  }

  return (
    <form
      action="/api/inquiries"
      aria-busy={status === 'submitting'}
      className="inquiry-form"
      method="post"
      noValidate
      onSubmit={submit}
    >
      <input name="idempotencyKey" readOnly type="hidden" value={idempotencyKey} />
      <input name="locale" readOnly type="hidden" value={locale} />
      <div aria-hidden className="honeypot-field">
        <label htmlFor="website">Website</label>
        <input autoComplete="off" id="website" name="website" tabIndex={-1} type="text" />
      </div>
      <h2>{copy.contact.title}</h2>
      <p className="muted">{copy.contact.subtitle}</p>
      <div className="inquiry-banner">
        <p>{copy.contact.submitWithoutDrawings}</p>
      </div>
      <div className="form-grid">
        <Field error={errors.name} label={copy.contact.name} name="name" />
        <Field error={errors.email} label={copy.contact.email} name="email" type="email" />
        <Field label={copy.contact.company} name="company" required={false} />
        <Field
          error={errors.phone}
          label={copy.contact.phone}
          name="phone"
          required={false}
          type="tel"
        />
        <SelectField
          error={errors.country}
          label={copy.contact.country}
          name="country"
          options={[...copy.contact.countryOptions]}
        />
        <SelectField
          defaultValue={initialInterest}
          label={copy.contact.interest}
          name="interest"
          options={copy.contact.productOptions}
          required={false}
        />
        <SelectField
          label={copy.contact.projectStage}
          name="projectStage"
          options={copy.contact.projectStageOptions}
          required={false}
        />
        <SelectField
          label={copy.contact.drawingStatus}
          name="drawingStatus"
          options={copy.contact.drawingStatusOptions}
          required={false}
        />
        <Field
          label={copy.contact.estimatedQuantity}
          name="quantitySquareMeters"
          placeholder="e.g. 5000"
          required={false}
        />
        <SelectField
          label={copy.contact.inquiryIntent}
          name="inquiryIntent"
          options={copy.contact.inquiryIntentOptions}
          required={false}
        />
        <Field
          className="full"
          error={errors.message}
          label={copy.contact.message}
          name="message"
          placeholder={copy.contact.messagePlaceholder}
          textarea
        />

        {/* Drawings & Documents Attachment Field */}
        <div className="attachment-field">
          <div className="attachment-field-header">
            <label htmlFor="inquiry-attachments-input">
              <IconPaperclip aria-hidden size={18} stroke={2} />
              <span>{copy.contact.attachments}</span>
              <span className="attachment-optional-badge">({copy.contact.optionalNote})</span>
            </label>
            <span className="attachment-limit-hint">{copy.contact.attachmentsLimit}</span>
          </div>

          <div
            aria-disabled={isDropzoneDisabled}
            aria-label={copy.contact.attachments}
            className={`attachment-dropzone ${isDragging ? 'is-dragging' : ''} ${
              isDropzoneDisabled ? 'is-disabled' : ''
            }`}
            onClick={() => {
              if (!isDropzoneDisabled) {
                fileInputRef.current?.click()
              }
            }}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onKeyDown={(e) => {
              if (!isDropzoneDisabled && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            role="button"
            tabIndex={isDropzoneDisabled ? -1 : 0}
          >
            <input
              accept={ALLOWED_EXTENSIONS_ACCEPT}
              aria-hidden="true"
              disabled={isDropzoneDisabled}
              id="inquiry-attachments-input"
              multiple
              onChange={handleFileInputChange}
              ref={fileInputRef}
              style={{ display: 'none' }}
              tabIndex={-1}
              type="file"
            />
            <IconUpload aria-hidden className="attachment-dropzone-icon" size={28} stroke={1.6} />
            <div className="attachment-dropzone-prompt">
              <span>{copy.contact.attachmentsDrop}</span>
              <button
                className="browse-link"
                disabled={isDropzoneDisabled}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!isDropzoneDisabled) {
                    fileInputRef.current?.click()
                  }
                }}
                type="button"
              >
                {copy.contact.attachmentsBrowse}
              </button>
            </div>
            <div className="attachment-dropzone-help">{copy.contact.attachmentsHelp}</div>
          </div>

          {attachmentError ? (
            <div className="error-text" role="alert">
              {attachmentError}
            </div>
          ) : null}

          {attachments.length > 0 ? (
            <div className="attachment-meta-bar">
              <span>
                {copy.contact.attachmentsCounter.replace('{count}', String(validAttachments.length))}
              </span>
              <span>{formatBytes(totalAttachmentBytes)} / 200 MB</span>
            </div>
          ) : null}

          {attachments.length > 0 ? (
            <div className="attachment-list" role="list">
              {attachments.map((item) => {
                const isPdf = item.name.toLowerCase().endsWith('.pdf')
                return (
                  <div
                    className="attachment-item"
                    data-status={item.status}
                    data-testid={`attachment-item-${item.id}`}
                    key={item.id}
                    role="listitem"
                  >
                    <div className="attachment-file-icon">
                      {isPdf ? (
                        <IconFileTypePdf aria-hidden size={22} stroke={1.6} />
                      ) : (
                        <IconFile aria-hidden size={22} stroke={1.6} />
                      )}
                    </div>

                    <div className="attachment-file-details">
                      <div className="attachment-file-name" title={item.name}>
                        {item.name}
                      </div>

                      <div className="attachment-file-subtext">
                        <span>{formatBytes(item.size)}</span>
                        {item.status === 'success' ? (
                          <span className="attachment-file-success">
                            <IconCheck aria-hidden size={14} stroke={2.4} />
                            {copy.contact.attachmentsUploaded}
                          </span>
                        ) : null}
                        {item.status === 'error' ? (
                          <span className="attachment-file-error" role="alert">
                            <IconAlertCircle aria-hidden size={14} stroke={2} />
                            {item.error || copy.contact.attachmentsUploadFailed}
                          </span>
                        ) : null}
                      </div>

                      {item.status === 'uploading' ? (
                        <div className="attachment-progress-wrap">
                          <div className="attachment-progress-bar">
                            <div
                              className="attachment-progress-fill"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                          <span className="attachment-progress-text">{item.progress}%</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="attachment-actions">
                      {item.status === 'uploading' ? (
                        <button
                          aria-label={`${copy.contact.attachmentsCancel} ${item.name}`}
                          className="attachment-action-btn cancel-btn"
                          onClick={() => handleCancelUpload(item.id)}
                          title={copy.contact.attachmentsCancel}
                          type="button"
                        >
                          <IconX aria-hidden size={16} stroke={2} />
                        </button>
                      ) : null}

                      {item.status === 'error' ? (
                        <button
                          aria-label={`${copy.contact.attachmentsRetry} ${item.name}`}
                          className="attachment-action-btn retry-btn"
                          onClick={() => handleRetryUpload(item.id)}
                          title={copy.contact.attachmentsRetry}
                          type="button"
                        >
                          <IconRefresh aria-hidden size={16} stroke={2} />
                        </button>
                      ) : null}

                      {item.status !== 'uploading' ? (
                        <button
                          aria-label={`${copy.contact.attachmentsRemove} ${item.name}`}
                          className="attachment-action-btn remove-btn"
                          onClick={() => handleRemoveAttachment(item.id)}
                          title={copy.contact.attachmentsRemove}
                          type="button"
                        >
                          <IconX aria-hidden size={16} stroke={2} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>
      <button
        className="button"
        disabled={status === 'submitting' || attachments.some((a) => a.status === 'uploading')}
        type="submit"
      >
        <IconSend aria-hidden size={19} />
        {status === 'submitting' ? copy.contact.sending : copy.contact.send}
      </button>
      <div aria-live="polite" className="form-status" data-error={status === 'error'} role="status">
        {statusMessage}
        {requestId ? (
          <>
            {' '}
            {copy.contact.reference}: <span data-testid="inquiry-request-id">{requestId}</span>
          </>
        ) : null}
      </div>
      <noscript>
        <p className="muted">{copy.contact.noScript}</p>
      </noscript>
    </form>
  )
}

function Field({
  className,
  error,
  label,
  name,
  placeholder,
  required = true,
  textarea = false,
  type = 'text',
}: {
  className?: string
  error?: string
  label: string
  name: string
  placeholder?: string
  required?: boolean
  textarea?: boolean
  type?: string
}) {
  const errorID = `${name}-error`

  return (
    <div className={`field ${className || ''}`} data-error={Boolean(error)}>
      <label htmlFor={name}>{label}</label>
      {textarea ? (
        <textarea
          aria-describedby={error ? errorID : undefined}
          aria-invalid={Boolean(error)}
          id={name}
          name={name}
          placeholder={placeholder}
          required={required}
        />
      ) : (
        <input
          aria-describedby={error ? errorID : undefined}
          aria-invalid={Boolean(error)}
          id={name}
          name={name}
          placeholder={placeholder}
          required={required}
          type={type}
        />
      )}
      <div className="error-text" id={errorID}>
        {error}
      </div>
    </div>
  )
}

function SelectField({
  defaultValue = '',
  error,
  label,
  name,
  options,
  required = false,
}: {
  defaultValue?: string
  error?: string
  label: string
  name: string
  options: ReadonlyArray<readonly [string, string]>
  required?: boolean
}) {
  const errorID = `${name}-error`

  return (
    <div className="field" data-error={Boolean(error)}>
      <label htmlFor={name}>{label}</label>
      <select
        aria-describedby={error ? errorID : undefined}
        aria-invalid={Boolean(error)}
        defaultValue={defaultValue}
        id={name}
        name={name}
        required={required}
      >
        <option disabled={required} value="">
          —
        </option>
        {options.map(([value, optionLabel]) => (
          <option key={value} value={value}>
            {optionLabel}
          </option>
        ))}
      </select>
      <div className="error-text" id={errorID}>
        {error}
      </div>
    </div>
  )
}
