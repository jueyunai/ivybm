'use client'

import { useState, type FormEvent } from 'react'

import { IconKey } from '@tabler/icons-react'

import { usePortalCommandKey } from '@/admin-portal/core/commands/usePortalCommandKey'
import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, StatusBadge } from '@/admin-portal/core/ui'

export function ChangePasswordPanel() {
  const { locale } = usePortalPreferences()
  const messages = getPortalMessages(locale).settings
  const command = usePortalCommandKey('portal-change-password')

  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [feedback, setFeedback] = useState<{ message: string; tone: 'error' | 'success' } | null>(
    null,
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFeedback(null)

    if (newPassword.length < 12 || newPassword.length > 128) {
      setFeedback({ message: messages.passwordLengthHint, tone: 'error' })
      return
    }

    if (newPassword !== confirmNewPassword) {
      setFeedback({ message: messages.passwordMismatch, tone: 'error' })
      return
    }

    setBusy(true)
    const idempotencyKey = command.key(
      JSON.stringify({
        action: 'change_personal_password',
        newLen: newPassword.length,
      }),
    )

    try {
      const response = await fetch('/api/portal/settings/change-password', {
        body: JSON.stringify({
          confirmNewPassword,
          currentPassword,
          newPassword,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        method: 'POST',
      })

      const body = (await response.json()) as { error?: { message?: string } }
      command.receivedResponse(idempotencyKey)

      if (!response.ok) {
        throw new Error(body.error?.message || messages.changePasswordError)
      }

      setFeedback({ message: messages.changePasswordSaved, tone: 'success' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmNewPassword('')

      setTimeout(() => {
        if (typeof window !== 'undefined') {
          window.location.href = '/dashboard/login'
        }
      }, 1200)
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : messages.changePasswordError,
        tone: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleCancel = () => {
    setEditing(false)
    setFeedback(null)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmNewPassword('')
  }

  return (
    <div className="portal-change-password">
      {feedback && !editing ? (
        <StatusBadge
          label={feedback.message}
          tone={feedback.tone === 'success' ? 'success' : 'danger'}
        />
      ) : null}

      {!editing ? (
        <Button
          className="portal-change-password__trigger"
          onClick={() => {
            setFeedback(null)
            setEditing(true)
          }}
          size="compact"
          type="button"
          variant="secondary"
        >
          <IconKey size={16} stroke={1.8} />
          {messages.changePassword}
        </Button>
      ) : (
        <form className="portal-settings__editor portal-change-password__form" onSubmit={handleSubmit}>
          <div className="portal-change-password__header">
            <h4>{messages.changePasswordTitle}</h4>
            <p>{messages.changePasswordDescription}</p>
          </div>

          {feedback ? (
            <StatusBadge
              label={feedback.message}
              tone={feedback.tone === 'success' ? 'success' : 'danger'}
            />
          ) : null}

          <label className="portal-field">
            <span className="portal-field__label">{messages.currentPassword}</span>
            <span className="portal-field__control">
              <input
                aria-label={messages.currentPassword}
                autoComplete="current-password"
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                type="password"
                value={currentPassword}
              />
            </span>
          </label>

          <label className="portal-field">
            <span className="portal-field__label">{messages.newPassword}</span>
            <span className="portal-field__control">
              <input
                aria-label={messages.newPassword}
                autoComplete="new-password"
                maxLength={128}
                minLength={12}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
              />
            </span>
          </label>

          <label className="portal-field">
            <span className="portal-field__label">{messages.confirmNewPassword}</span>
            <span className="portal-field__control">
              <input
                aria-label={messages.confirmNewPassword}
                autoComplete="new-password"
                maxLength={128}
                minLength={12}
                onChange={(event) => setConfirmNewPassword(event.target.value)}
                required
                type="password"
                value={confirmNewPassword}
              />
            </span>
          </label>

          <div className="portal-settings__editor-actions">
            <Button disabled={busy} onClick={handleCancel} size="compact" type="button" variant="ghost">
              {messages.changePasswordCancel}
            </Button>
            <Button disabled={busy} size="compact" type="submit" variant="primary">
              {busy ? messages.savingPassword : messages.changePasswordConfirm}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
