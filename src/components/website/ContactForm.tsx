'use client'

import { IconSend } from '@tabler/icons-react'
import React, { useState } from 'react'

import { getWebsiteCopy, type Locale } from '@/lib/i18n'

type FieldName = 'country' | 'email' | 'message' | 'name'

export function ContactForm({ locale }: { locale: Locale }) {
  const copy = getWebsiteCopy(locale)
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [status, setStatus] = useState('')

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const nextErrors: Partial<Record<FieldName, string>> = {}

    for (const field of ['name', 'email', 'country', 'message'] as const) {
      if (!String(data.get(field) || '').trim()) nextErrors[field] = copy.contact.required
    }

    const email = String(data.get('email') || '')
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = copy.contact.invalidEmail

    setErrors(nextErrors)
    setStatus(Object.keys(nextErrors).length ? '' : copy.contact.formFallback)
  }

  return (
    <form className="inquiry-form" noValidate onSubmit={submit}>
      <h2>{copy.contact.title}</h2>
      <p className="muted">{copy.contact.subtitle}</p>
      <div className="form-grid">
        <Field error={errors.name} label={copy.contact.name} name="name" />
        <Field error={errors.email} label={copy.contact.email} name="email" type="email" />
        <Field label={copy.contact.company} name="company" required={false} />
        <SelectField error={errors.country} label={copy.contact.country} name="country" />
        <SelectField
          label={copy.contact.interest}
          name="interest"
          options={[...copy.contact.productOptions]}
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
      <button className="button" type="submit">
        <IconSend aria-hidden size={19} />
        {copy.contact.send}
      </button>
      <div aria-live="polite" className="form-status">
        {status}
      </div>
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
  options = ['United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Oman', 'Kuwait', 'United States', 'Australia', 'Other'],
  required = true,
}: {
  error?: string
  label: string
  name: string
  options?: string[]
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
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
      <div className="error-text" id={errorID}>{error}</div>
    </div>
  )
}
