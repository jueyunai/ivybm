'use client'

import { IconSend } from '@tabler/icons-react'
import React, { useState } from 'react'

import { createIdempotencyKey } from '@/lib/inquiries/idempotency'
import { getWebsiteCopy, type Locale } from '@/lib/i18n'
import {
  type InquiryField,
  type InquiryValidationCode,
  validateInquiry,
} from '@/lib/validation/inquiry'

type FormField = 'country' | 'email' | 'message' | 'name' | 'phone'

type InquiryAPIResponse =
  | { duplicate: boolean; ok: true; requestId: string }
  | {
      code: string
      errors?: Partial<Record<InquiryField, InquiryValidationCode>>
      ok: false
      requestId: string
      retryAfterSeconds?: number
    }

const formInput = (
  form: HTMLFormElement,
  idempotencyKey: string,
  locale: Locale,
): Record<string, unknown> => {
  const data = Object.fromEntries(new FormData(form).entries())
  const url = new URL(window.location.href)

  return {
    ...data,
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
  locale,
}: {
  initialIdempotencyKey: string
  locale: Locale
}) {
  const copy = getWebsiteCopy(locale)
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({})
  const [idempotencyKey, setIdempotencyKey] = useState(initialIdempotencyKey)
  const [requestId, setRequestId] = useState('')
  const [status, setStatus] = useState<'error' | 'idle' | 'submitting' | 'success'>('idle')
  const [statusMessage, setStatusMessage] = useState('')

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

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const input = formInput(form, idempotencyKey, locale)
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
      <div className="form-grid">
        <Field error={errors.name} label={copy.contact.name} name="name" />
        <Field error={errors.email} label={copy.contact.email} name="email" type="email" />
        <Field label={copy.contact.company} name="company" required={false} />
        <Field error={errors.phone} label={copy.contact.phone} name="phone" required={false} type="tel" />
        <SelectField
          error={errors.country}
          label={copy.contact.country}
          name="country"
          options={[...copy.contact.countryOptions]}
        />
        <SelectField
          label={copy.contact.interest}
          name="interest"
          options={copy.contact.productOptions.map((option) => [option, option])}
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
      </div>
      <button className="button" disabled={status === 'submitting'} type="submit">
        <IconSend aria-hidden size={19} />
        {status === 'submitting' ? copy.contact.sending : copy.contact.send}
      </button>
      <div
        aria-live="polite"
        className="form-status"
        data-error={status === 'error'}
        role="status"
      >
        {statusMessage}
        {requestId ? (
          <>
            {' '}
            {copy.contact.reference}:{' '}
            <span data-testid="inquiry-request-id">{requestId}</span>
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
      <div className="error-text" id={errorID}>{error}</div>
    </div>
  )
}

function SelectField({
  error,
  label,
  name,
  options,
  required = true,
}: {
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
        defaultValue=""
        id={name}
        name={name}
        required={required}
      >
        <option disabled value="">
          —
        </option>
        {options.map(([value, optionLabel]) => (
          <option key={value} value={value}>{optionLabel}</option>
        ))}
      </select>
      <div className="error-text" id={errorID}>{error}</div>
    </div>
  )
}
