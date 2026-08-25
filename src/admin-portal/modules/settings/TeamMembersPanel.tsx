'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

import {
  IconLock,
  IconLockOpen,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsers,
} from '@tabler/icons-react'

import { usePortalCommandKey } from '@/admin-portal/core/commands/usePortalCommandKey'
import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, StatusBadge, Surface } from '@/admin-portal/core/ui'

import type {
  PortalTeamMemberDTO,
  PortalTeamMemberRole,
} from './userSettingsContracts'

export interface TeamMembersPanelProps {
  currentUserId: number | string
  initialMembers?: PortalTeamMemberDTO[]
}

type ModalMode = 'add' | 'delete' | 'edit' | 'reset-password' | null

export function TeamMembersPanel({
  currentUserId,
  initialMembers = [],
}: TeamMembersPanelProps) {
  const { locale } = usePortalPreferences()
  const messages = getPortalMessages(locale).settings
  const command = usePortalCommandKey('portal-team-members')

  const [members, setMembers] = useState<PortalTeamMemberDTO[]>(initialMembers)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; tone: 'error' | 'success' } | null>(
    null,
  )

  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [selectedMember, setSelectedMember] = useState<PortalTeamMemberDTO | null>(null)

  // Form states
  const [formEmail, setFormEmail] = useState('')
  const [formRole, setFormRole] = useState<PortalTeamMemberRole>('sales')
  const [formPassword, setFormPassword] = useState('')
  const [formConfirmPassword, setFormConfirmPassword] = useState('')
  const [formConfirmEmail, setFormConfirmEmail] = useState('')

  const refresh = async () => {
    try {
      const response = await fetch('/api/portal/settings/users', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const data = (await response.json()) as {
        error?: { message?: string }
        members?: PortalTeamMemberDTO[]
      }
      if (!response.ok) throw new Error(data.error?.message || messages.teamOperationError)
      if (Array.isArray(data.members)) {
        setMembers(data.members)
      }
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : messages.teamOperationError,
        tone: 'error',
      })
    }
  }

  const openAddModal = () => {
    setSelectedMember(null)
    setFormEmail('')
    setFormRole('sales')
    setFormPassword('')
    setFormConfirmPassword('')
    setFeedback(null)
    setModalMode('add')
  }

  const openEditModal = (member: PortalTeamMemberDTO) => {
    setSelectedMember(member)
    setFormEmail(member.email)
    setFormRole(member.role)
    setFeedback(null)
    setModalMode('edit')
  }

  const openResetPasswordModal = (member: PortalTeamMemberDTO) => {
    setSelectedMember(member)
    setFormPassword('')
    setFormConfirmPassword('')
    setFeedback(null)
    setModalMode('reset-password')
  }

  const openDeleteModal = (member: PortalTeamMemberDTO) => {
    setSelectedMember(member)
    setFormConfirmEmail('')
    setFeedback(null)
    setModalMode('delete')
  }

  const closeModal = useCallback(() => {
    setModalMode(null)
    setSelectedMember(null)
    setFormEmail('')
    setFormPassword('')
    setFormConfirmPassword('')
    setFormConfirmEmail('')
  }, [
    setFormConfirmEmail,
    setFormConfirmPassword,
    setFormEmail,
    setFormPassword,
    setModalMode,
    setSelectedMember,
  ])

  useEffect(() => {
    if (!modalMode) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) closeModal()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, closeModal, modalMode])

  const handleAddSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (formPassword !== formConfirmPassword) {
      setFeedback({ message: messages.passwordMismatch, tone: 'error' })
      return
    }

    setBusy(true)
    setFeedback(null)
    const idempotencyKey = command.key(
      JSON.stringify({
        action: 'create_team_member',
        email: formEmail.trim().toLowerCase(),
        role: formRole,
      }),
    )

    try {
      const response = await fetch('/api/portal/settings/users', {
        body: JSON.stringify({
          confirmPassword: formConfirmPassword,
          email: formEmail,
          password: formPassword,
          role: formRole,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        method: 'POST',
      })

      const result = (await response.json()) as { error?: { message?: string } }
      command.receivedResponse(idempotencyKey)

      if (!response.ok) {
        throw new Error(result.error?.message || messages.teamOperationError)
      }

      await refresh()
      closeModal()
      setFeedback({ message: messages.memberSaved, tone: 'success' })
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : messages.teamOperationError,
        tone: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedMember) return

    setBusy(true)
    setFeedback(null)
    const idempotencyKey = command.key(
      JSON.stringify({
        action: 'update_team_member',
        email: formEmail.trim().toLowerCase(),
        id: selectedMember.id,
        role: formRole,
        updatedAt: selectedMember.updatedAt,
      }),
    )

    try {
      const response = await fetch(`/api/portal/settings/users/${selectedMember.id}`, {
        body: JSON.stringify({
          email: formEmail,
          role: formRole,
          updatedAt: selectedMember.updatedAt,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        method: 'PATCH',
      })

      const result = (await response.json()) as { error?: { message?: string } }
      command.receivedResponse(idempotencyKey)

      if (!response.ok) {
        throw new Error(result.error?.message || messages.teamOperationError)
      }

      await refresh()
      closeModal()
      setFeedback({ message: messages.memberSaved, tone: 'success' })
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : messages.teamOperationError,
        tone: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleResetPasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedMember) return

    if (formPassword !== formConfirmPassword) {
      setFeedback({ message: messages.passwordMismatch, tone: 'error' })
      return
    }

    setBusy(true)
    setFeedback(null)
    const idempotencyKey = command.key(
      JSON.stringify({
        action: 'reset_member_password',
        id: selectedMember.id,
        updatedAt: selectedMember.updatedAt,
      }),
    )

    try {
      const response = await fetch(`/api/portal/settings/users/${selectedMember.id}/reset-password`, {
        body: JSON.stringify({
          confirmPassword: formConfirmPassword,
          password: formPassword,
          updatedAt: selectedMember.updatedAt,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        method: 'POST',
      })

      const result = (await response.json()) as { error?: { message?: string } }
      command.receivedResponse(idempotencyKey)

      if (!response.ok) {
        throw new Error(result.error?.message || messages.teamOperationError)
      }

      await refresh()
      closeModal()
      setFeedback({ message: messages.resetPasswordSuccess, tone: 'success' })
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : messages.teamOperationError,
        tone: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleLockToggle = async (member: PortalTeamMemberDTO) => {
    const isLocked = member.status === 'manually_locked' || member.status === 'security_locked'
    const confirmPrompt = isLocked ? messages.unlockMemberConfirm : messages.lockMemberConfirm

    if (!window.confirm(confirmPrompt)) return

    setBusy(true)
    setFeedback(null)
    const action = isLocked ? 'unlock_team_member' : 'lock_team_member'
    const idempotencyKey = command.key(
      JSON.stringify({
        action,
        id: member.id,
        updatedAt: member.updatedAt,
      }),
    )

    try {
      const endpoint = isLocked ? 'unlock' : 'lock'
      const response = await fetch(`/api/portal/settings/users/${member.id}/${endpoint}`, {
        body: JSON.stringify({ updatedAt: member.updatedAt }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        method: 'POST',
      })

      const result = (await response.json()) as { error?: { message?: string } }
      command.receivedResponse(idempotencyKey)

      if (!response.ok) {
        throw new Error(result.error?.message || messages.teamOperationError)
      }

      await refresh()
      setFeedback({
        message: isLocked ? messages.unlockMemberSuccess : messages.lockMemberSuccess,
        tone: 'success',
      })
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : messages.teamOperationError,
        tone: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedMember) return

    setBusy(true)
    setFeedback(null)
    const idempotencyKey = command.key(
      JSON.stringify({
        action: 'delete_team_member',
        confirmEmail: formConfirmEmail.trim().toLowerCase(),
        id: selectedMember.id,
        updatedAt: selectedMember.updatedAt,
      }),
    )

    try {
      const response = await fetch(`/api/portal/settings/users/${selectedMember.id}`, {
        body: JSON.stringify({
          confirmEmail: formConfirmEmail,
          updatedAt: selectedMember.updatedAt,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        method: 'DELETE',
      })

      const result = (await response.json()) as { error?: { message?: string } }
      command.receivedResponse(idempotencyKey)

      if (!response.ok) {
        throw new Error(result.error?.message || messages.deleteMemberError)
      }

      setMembers((currentMembers) =>
        currentMembers.filter((member) => String(member.id) !== String(selectedMember.id)),
      )
      closeModal()
      setFeedback({ message: messages.deleteMemberSuccess, tone: 'success' })
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : messages.deleteMemberError,
        tone: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const roleLabel = (role: PortalTeamMemberRole) => {
    switch (role) {
      case 'admin':
        return messages.roleAdminOption
      case 'operator':
        return messages.roleOperatorOption
      case 'sales':
        return messages.roleSalesOption
      default:
        return role
    }
  }

  const statusLabel = (status: PortalTeamMemberDTO['status'], lockedUntil: string | null) => {
    switch (status) {
      case 'security_locked':
        return {
          label: messages.statusSecurityLocked,
          sub: lockedUntil ? `${messages.memberLockedUntil}: ${new Date(lockedUntil).toLocaleTimeString()}` : null,
          tone: 'warning' as const,
        }
      case 'manually_locked':
        return {
          label: messages.statusManuallyLocked,
          sub: null,
          tone: 'danger' as const,
        }
      case 'normal':
      default:
        return {
          label: messages.statusNormal,
          sub: null,
          tone: 'success' as const,
        }
    }
  }

  const modalFeedback = feedback ? (
    <StatusBadge
      label={feedback.message}
      tone={feedback.tone === 'success' ? 'success' : 'danger'}
    />
  ) : null

  return (
    <Surface as="section" className="portal-settings__section portal-settings__section--wide portal-team-members">
      <div className="portal-settings__section-heading">
        <span aria-hidden="true" className="portal-settings__section-icon">
          <IconUsers size={20} stroke={1.8} />
        </span>
        <div>
          <h3>{messages.teamMembersTitle}</h3>
          <p>{messages.teamDescription}</p>
        </div>
        <Button onClick={openAddModal} size="compact" variant="primary">
          <IconPlus size={16} stroke={1.8} />
          {messages.addMember}
        </Button>
      </div>

      {feedback ? (
        <StatusBadge
          label={feedback.message}
          tone={feedback.tone === 'success' ? 'success' : 'danger'}
        />
      ) : null}

      <div className="portal-team-members__list">
        {members.length === 0 ? (
          <div className="portal-team-members__empty">{messages.noTeamMembers}</div>
        ) : (
          members.map((member) => {
            const isSelf = String(member.id) === String(currentUserId)
            const statusInfo = statusLabel(member.status, member.lockedUntil)
            const isLocked = member.status === 'manually_locked' || member.status === 'security_locked'

            return (
              <article className="portal-team-members__item" key={member.id}>
                <div className="portal-team-members__info">
                  <div className="portal-team-members__email-row">
                    <strong>{member.email}</strong>
                    {isSelf ? <span className="portal-team-members__self-tag">({messages.selfLabel})</span> : null}
                  </div>
                  <div className="portal-team-members__meta">
                    <span>{messages.memberRole}: {roleLabel(member.role)}</span>
                    <span>·</span>
                    <span>{messages.memberCreatedAt}: {new Date(member.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="portal-team-members__status">
                  <StatusBadge label={statusInfo.label} tone={statusInfo.tone} />
                  {statusInfo.sub ? <small>{statusInfo.sub}</small> : null}
                </div>

                <div className="portal-team-members__actions">
                  {!isSelf ? (
                    <>
                      <Button
                        disabled={busy}
                        onClick={() => openEditModal(member)}
                        size="compact"
                        title={messages.editMember}
                        variant="ghost"
                      >
                        <IconPencil size={15} stroke={1.8} />
                        {messages.editMember}
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => openResetPasswordModal(member)}
                        size="compact"
                        title={messages.resetPassword}
                        variant="ghost"
                      >
                        {messages.resetPassword}
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => handleLockToggle(member)}
                        size="compact"
                        title={isLocked ? messages.unlockMember : messages.lockMember}
                        variant="ghost"
                      >
                        {isLocked ? (
                          <>
                            <IconLockOpen size={15} stroke={1.8} />
                            {messages.unlockMember}
                          </>
                        ) : (
                          <>
                            <IconLock size={15} stroke={1.8} />
                            {messages.lockMember}
                          </>
                        )}
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => openDeleteModal(member)}
                        size="compact"
                        title={messages.deleteMember}
                        variant="danger"
                      >
                        <IconTrash size={15} stroke={1.8} />
                        {messages.deleteMember}
                      </Button>
                    </>
                  ) : (
                    <span className="portal-team-members__self-label">{messages.selfLabel}</span>
                  )}
                </div>
              </article>
            )
          })
        )}
      </div>

      {/* Modal / Dialog for Add */}
      {modalMode === 'add' ? (
        <div className="portal-modal-backdrop">
          <Surface
            aria-labelledby="portal-team-member-dialog-title"
            aria-modal="true"
            as="div"
            className="portal-modal"
            role="dialog"
          >
            <header className="portal-modal__header">
              <h4 id="portal-team-member-dialog-title">{messages.newMemberTitle}</h4>
            </header>
            {modalFeedback}
            <form className="portal-modal__form" onSubmit={handleAddSubmit}>
              <label className="portal-field">
                <span className="portal-field__label">{messages.memberEmail}</span>
                <span className="portal-field__control">
                  <input
                    aria-label={messages.memberEmail}
                    autoComplete="off"
                    onChange={(event) => setFormEmail(event.target.value)}
                    required
                    type="email"
                    value={formEmail}
                  />
                </span>
              </label>

              <label className="portal-field">
                <span className="portal-field__label">{messages.memberRole}</span>
                <span className="portal-field__control">
                  <select
                    aria-label={messages.memberRole}
                    onChange={(event) => setFormRole(event.target.value as PortalTeamMemberRole)}
                    value={formRole}
                  >
                    <option value="sales">{messages.roleSalesOption}</option>
                    <option value="operator">{messages.roleOperatorOption}</option>
                    <option value="admin">{messages.roleAdminOption}</option>
                  </select>
                </span>
              </label>

              <label className="portal-field">
                <span className="portal-field__label">{messages.initialPassword}</span>
                <span className="portal-field__control">
                  <input
                    aria-label={messages.initialPassword}
                    maxLength={128}
                    minLength={12}
                    onChange={(event) => setFormPassword(event.target.value)}
                    required
                    type="password"
                    value={formPassword}
                  />
                </span>
              </label>

              <label className="portal-field">
                <span className="portal-field__label">{messages.confirmInitialPassword}</span>
                <span className="portal-field__control">
                  <input
                    aria-label={messages.confirmInitialPassword}
                    maxLength={128}
                    minLength={12}
                    onChange={(event) => setFormConfirmPassword(event.target.value)}
                    required
                    type="password"
                    value={formConfirmPassword}
                  />
                </span>
              </label>

              <div className="portal-modal__actions">
                <Button disabled={busy} onClick={closeModal} size="compact" type="button" variant="ghost">
                  {messages.cancelMember}
                </Button>
                <Button disabled={busy} size="compact" type="submit" variant="primary">
                  {busy ? messages.savingMember : messages.saveMember}
                </Button>
              </div>
            </form>
          </Surface>
        </div>
      ) : null}

      {/* Modal / Dialog for Edit */}
      {modalMode === 'edit' && selectedMember ? (
        <div className="portal-modal-backdrop">
          <Surface
            aria-labelledby="portal-team-member-dialog-title"
            aria-modal="true"
            as="div"
            className="portal-modal"
            role="dialog"
          >
            <header className="portal-modal__header">
              <h4 id="portal-team-member-dialog-title">{messages.editMemberTitle}</h4>
            </header>
            {modalFeedback}
            <form className="portal-modal__form" onSubmit={handleEditSubmit}>
              <label className="portal-field">
                <span className="portal-field__label">{messages.memberEmail}</span>
                <span className="portal-field__control">
                  <input
                    aria-label={messages.memberEmail}
                    onChange={(event) => setFormEmail(event.target.value)}
                    required
                    type="email"
                    value={formEmail}
                  />
                </span>
              </label>

              <label className="portal-field">
                <span className="portal-field__label">{messages.memberRole}</span>
                <span className="portal-field__control">
                  <select
                    aria-label={messages.memberRole}
                    onChange={(event) => setFormRole(event.target.value as PortalTeamMemberRole)}
                    value={formRole}
                  >
                    <option value="sales">{messages.roleSalesOption}</option>
                    <option value="operator">{messages.roleOperatorOption}</option>
                    <option value="admin">{messages.roleAdminOption}</option>
                  </select>
                </span>
              </label>

              <div className="portal-modal__actions">
                <Button disabled={busy} onClick={closeModal} size="compact" type="button" variant="ghost">
                  {messages.cancelMember}
                </Button>
                <Button disabled={busy} size="compact" type="submit" variant="primary">
                  {busy ? messages.savingMember : messages.saveMember}
                </Button>
              </div>
            </form>
          </Surface>
        </div>
      ) : null}

      {/* Modal / Dialog for Reset Password */}
      {modalMode === 'reset-password' && selectedMember ? (
        <div className="portal-modal-backdrop">
          <Surface
            aria-labelledby="portal-team-member-dialog-title"
            aria-modal="true"
            as="div"
            className="portal-modal"
            role="dialog"
          >
            <header className="portal-modal__header">
              <h4 id="portal-team-member-dialog-title">{messages.resetPasswordTitle}</h4>
              <p>{messages.resetPasswordDescription}</p>
            </header>
            {modalFeedback}
            <form className="portal-modal__form" onSubmit={handleResetPasswordSubmit}>
              <label className="portal-field">
                <span className="portal-field__label">{messages.newPassword}</span>
                <span className="portal-field__control">
                  <input
                    aria-label={messages.newPassword}
                    maxLength={128}
                    minLength={12}
                    onChange={(event) => setFormPassword(event.target.value)}
                    required
                    type="password"
                    value={formPassword}
                  />
                </span>
              </label>

              <label className="portal-field">
                <span className="portal-field__label">{messages.confirmResetPassword}</span>
                <span className="portal-field__control">
                  <input
                    aria-label={messages.confirmResetPassword}
                    maxLength={128}
                    minLength={12}
                    onChange={(event) => setFormConfirmPassword(event.target.value)}
                    required
                    type="password"
                    value={formConfirmPassword}
                  />
                </span>
              </label>

              <div className="portal-modal__actions">
                <Button disabled={busy} onClick={closeModal} size="compact" type="button" variant="ghost">
                  {messages.cancelMember}
                </Button>
                <Button disabled={busy} size="compact" type="submit" variant="primary">
                  {busy ? messages.savingPassword : messages.resetPassword}
                </Button>
              </div>
            </form>
          </Surface>
        </div>
      ) : null}

      {/* Modal / Dialog for Delete */}
      {modalMode === 'delete' && selectedMember ? (
        <div className="portal-modal-backdrop">
          <Surface
            aria-labelledby="portal-team-member-dialog-title"
            aria-modal="true"
            as="div"
            className="portal-modal"
            role="dialog"
          >
            <header className="portal-modal__header">
              <h4 id="portal-team-member-dialog-title">{messages.deleteMemberTitle}</h4>
              <p>{messages.deleteMemberDescription}</p>
            </header>
            {modalFeedback}
            <form className="portal-modal__form" onSubmit={handleDeleteSubmit}>
              <div className="portal-modal__prompt">
                <p>
                  {messages.confirmEmailPrompt} <strong>{selectedMember.email}</strong>
                </p>
              </div>
              <label className="portal-field">
                <span className="portal-field__label">{messages.memberEmail}</span>
                <span className="portal-field__control">
                  <input
                    aria-label={messages.memberEmail}
                    autoComplete="off"
                    onChange={(event) => setFormConfirmEmail(event.target.value)}
                    placeholder={selectedMember.email}
                    required
                    type="email"
                    value={formConfirmEmail}
                  />
                </span>
              </label>

              <div className="portal-modal__actions">
                <Button disabled={busy} onClick={closeModal} size="compact" type="button" variant="ghost">
                  {messages.cancelMember}
                </Button>
                <Button
                  disabled={busy || formConfirmEmail.trim().toLowerCase() !== selectedMember.email.toLowerCase()}
                  size="compact"
                  type="submit"
                  variant="danger"
                >
                  {busy ? messages.deletingMember : messages.confirmDeleteMember}
                </Button>
              </div>
            </form>
          </Surface>
        </div>
      ) : null}
    </Surface>
  )
}
