'use client'

import * as Dialog from '@radix-ui/react-dialog'
import {
  useCallback,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react'

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

import type { PortalTeamMemberDTO, PortalTeamMemberRole } from './userSettingsContracts'

export interface TeamMembersPanelProps {
  currentUserId: number | string
  initialMembers?: PortalTeamMemberDTO[]
  initialReadError?: boolean
}

type ModalMode = 'add' | 'delete' | 'edit' | 'reset-password' | null

type TeamMembersAPIResult = {
  deletedId?: number | string
  error?: { code?: string; details?: unknown; message?: string }
  member?: PortalTeamMemberDTO
  members?: PortalTeamMemberDTO[]
  success?: boolean
}

type TeamMembersFeedback = {
  message: string
  tone: 'error' | 'success'
  details?: Array<{ label: string; value: number }>
}

class TeamMembersRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'TeamMembersRequestError'
  }
}

const readTeamMembersResponse = async (
  response: Response,
  fallbackMessage: string,
): Promise<TeamMembersAPIResult> => {
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw new TeamMembersRequestError('invalid-response', fallbackMessage)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TeamMembersRequestError('invalid-response', fallbackMessage)
  }

  const result = parsed as TeamMembersAPIResult
  if (!response.ok) {
    if (!result.error || typeof result.error.code !== 'string') {
      throw new TeamMembersRequestError('invalid-response', fallbackMessage)
    }
    throw new TeamMembersRequestError(
      result.error.code,
      result.error?.message ?? fallbackMessage,
      result.error?.details,
    )
  }
  return result
}

const assignmentDetailKeys = [
  'conversations',
  'contentReviews',
  'feishuActiveRegistrations',
  'feishuMemberMappings',
  'generatedContents',
  'handoffs',
  'leads',
  'pendingPublishJobs',
  'activePortalCommands',
  'publishJobs',
] as const

const resolveTeamMembersError = (
  error: unknown,
  messages: ReturnType<typeof getPortalMessages>['settings'],
  fallbackMessage: string,
): Omit<TeamMembersFeedback, 'tone'> => {
  if (!(error instanceof TeamMembersRequestError)) {
    return { message: fallbackMessage }
  }

  const message = messages.teamErrorMessages[error.code] ?? fallbackMessage
  const details =
    error.code === 'user-has-assignments' && error.details && typeof error.details === 'object'
      ? assignmentDetailKeys.flatMap((key) => {
          const value = (error.details as Record<string, unknown>)[key]
          return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
            ? [{ label: messages.teamAssignmentDetailLabels[key] ?? key, value }]
            : []
        })
      : undefined

  return details?.length ? { message, details } : { message }
}

function TeamMemberDialog({
  busy,
  children,
  description,
  onClose,
  open,
  returnFocusRef,
  title,
}: {
  busy: boolean
  children: ReactNode
  description?: string
  onClose: () => void
  open: boolean
  returnFocusRef: RefObject<HTMLElement | null>
  title: string
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const descriptionId = useId()

  return (
    <Dialog.Root
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose()
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="portal-modal-backdrop" />
        <Dialog.Content
          aria-describedby={description ? descriptionId : undefined}
          className="portal-surface portal-modal"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocusRef.current?.focus()
            setTimeout(() => returnFocusRef.current?.focus(), 0)
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault()
          }}
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const firstField = contentRef.current?.querySelector<HTMLElement>(
              '[data-dialog-initial-focus], input:not([disabled]), select:not([disabled]), button:not([disabled])',
            )
            firstField?.focus()
          }}
          ref={contentRef}
        >
          <header className="portal-modal__header">
            <Dialog.Title asChild>
              <h4>{title}</h4>
            </Dialog.Title>
            {description ? (
              <Dialog.Description id={descriptionId}>{description}</Dialog.Description>
            ) : null}
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function TeamMembersPanel({
  currentUserId,
  initialMembers = [],
  initialReadError = false,
}: TeamMembersPanelProps) {
  const { locale } = usePortalPreferences()
  const messages = getPortalMessages(locale).settings
  const command = usePortalCommandKey('portal-team-members')

  const [members, setMembers] = useState<PortalTeamMemberDTO[]>(initialMembers)
  const [busy, setBusy] = useState(false)
  const [readError, setReadError] = useState(initialReadError)
  const [feedback, setFeedback] = useState<TeamMembersFeedback | null>(null)

  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [selectedMember, setSelectedMember] = useState<PortalTeamMemberDTO | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  // Form states
  const [formEmail, setFormEmail] = useState('')
  const [formRole, setFormRole] = useState<PortalTeamMemberRole>('sales')
  const [formPassword, setFormPassword] = useState('')
  const [formConfirmPassword, setFormConfirmPassword] = useState('')
  const [formConfirmEmail, setFormConfirmEmail] = useState('')

  const refresh = useCallback(async (): Promise<PortalTeamMemberDTO[]> => {
    const response = await fetch('/api/portal/settings/users', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    const result = await readTeamMembersResponse(response, messages.teamMembersReadError)
    if (!Array.isArray(result.members)) {
      throw new TeamMembersRequestError('invalid-response', messages.teamMembersReadError)
    }
    setMembers(result.members)
    setReadError(false)
    return result.members
  }, [messages.teamMembersReadError])

  const rememberTrigger = () => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
  }

  const openAddModal = () => {
    rememberTrigger()
    setSelectedMember(null)
    setFormEmail('')
    setFormRole('sales')
    setFormPassword('')
    setFormConfirmPassword('')
    setFeedback(null)
    setModalMode('add')
  }

  const openEditModal = (member: PortalTeamMemberDTO) => {
    rememberTrigger()
    setSelectedMember(member)
    setFormEmail(member.email)
    setFormRole(member.role)
    setFeedback(null)
    setModalMode('edit')
  }

  const openResetPasswordModal = (member: PortalTeamMemberDTO) => {
    rememberTrigger()
    setSelectedMember(member)
    setFormPassword('')
    setFormConfirmPassword('')
    setFeedback(null)
    setModalMode('reset-password')
  }

  const openDeleteModal = (member: PortalTeamMemberDTO) => {
    rememberTrigger()
    setSelectedMember(member)
    setFormConfirmEmail('')
    setFeedback(null)
    setModalMode('delete')
  }

  const closeModal = useCallback(() => {
    const trigger = returnFocusRef.current
    setModalMode(null)
    setSelectedMember(null)
    setFormEmail('')
    setFormPassword('')
    setFormConfirmPassword('')
    setFormConfirmEmail('')
    trigger?.focus()
  }, [])

  const replaceMember = (member: PortalTeamMemberDTO) => {
    setMembers((currentMembers) => {
      const remaining = currentMembers.filter((current) => String(current.id) !== String(member.id))
      return [...remaining, member].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      )
    })
    setReadError(false)
  }

  const recoverFromCommandConflict = async (error: unknown): Promise<boolean> => {
    if (!(error instanceof TeamMembersRequestError)) return false
    const message = {
      'portal-command-result-unknown': messages.teamCommandResultUnknown,
      'stale-user-version': messages.memberStale,
      'user-not-found': messages.memberNotFound,
    }[error.code]
    if (!message) return false

    closeModal()
    try {
      await refresh()
      setFeedback({ message, tone: 'error' })
    } catch {
      setReadError(true)
      setFeedback({ message: messages.teamMembersReadError, tone: 'error' })
    }
    return true
  }

  const retryMemberRead = async () => {
    setBusy(true)
    setFeedback(null)
    try {
      await refresh()
    } catch {
      setReadError(true)
      setFeedback({ message: messages.teamMembersReadError, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const receiveCommandResponse = async (
    response: Response,
    idempotencyKey: string,
    fallbackMessage: string,
    isKnownResult: (result: TeamMembersAPIResult) => boolean,
  ): Promise<TeamMembersAPIResult> => {
    let result: TeamMembersAPIResult
    try {
      result = await readTeamMembersResponse(response, fallbackMessage)
    } catch (error) {
      if (!(error instanceof TeamMembersRequestError) || error.code === 'invalid-response') {
        throw new TeamMembersRequestError(
          'portal-command-result-unknown',
          messages.teamCommandResultUnknown,
        )
      }
      // A well-formed error response is a known command outcome and can retire
      // the idempotency key. Unknown transport/body failures deliberately keep it.
      command.receivedResponse(idempotencyKey)
      throw error
    }

    if (!isKnownResult(result)) {
      throw new TeamMembersRequestError(
        'portal-command-result-unknown',
        messages.teamCommandResultUnknown,
      )
    }

    command.receivedResponse(idempotencyKey)
    return result
  }

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

      const result = await receiveCommandResponse(
        response,
        idempotencyKey,
        messages.teamOperationError,
        (candidate) => Boolean(candidate.member),
      )
      if (!result.member) return
      replaceMember(result.member)
      closeModal()
      setFeedback({ message: messages.memberSaved, tone: 'success' })
    } catch (error) {
      if (!(await recoverFromCommandConflict(error))) {
        setFeedback({
          tone: 'error',
          ...resolveTeamMembersError(error, messages, messages.teamOperationError),
        })
      }
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

      const result = await receiveCommandResponse(
        response,
        idempotencyKey,
        messages.teamOperationError,
        (candidate) => Boolean(candidate.member),
      )
      if (!result.member) return
      replaceMember(result.member)
      closeModal()
      setFeedback({ message: messages.memberSaved, tone: 'success' })
    } catch (error) {
      if (!(await recoverFromCommandConflict(error))) {
        setFeedback({
          tone: 'error',
          ...resolveTeamMembersError(error, messages, messages.teamOperationError),
        })
      }
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
      const response = await fetch(
        `/api/portal/settings/users/${selectedMember.id}/reset-password`,
        {
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
        },
      )

      const result = await receiveCommandResponse(
        response,
        idempotencyKey,
        messages.teamOperationError,
        (candidate) => Boolean(candidate.member),
      )
      if (!result.member) return
      replaceMember(result.member)
      closeModal()
      setFeedback({ message: messages.resetPasswordSuccess, tone: 'success' })
    } catch (error) {
      if (!(await recoverFromCommandConflict(error))) {
        setFeedback({
          tone: 'error',
          ...resolveTeamMembersError(error, messages, messages.teamOperationError),
        })
      }
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

      const result = await receiveCommandResponse(
        response,
        idempotencyKey,
        messages.teamOperationError,
        (candidate) => Boolean(candidate.member),
      )
      if (!result.member) return
      replaceMember(result.member)
      setFeedback({
        message: isLocked ? messages.unlockMemberSuccess : messages.lockMemberSuccess,
        tone: 'success',
      })
    } catch (error) {
      if (!(await recoverFromCommandConflict(error))) {
        setFeedback({
          tone: 'error',
          ...resolveTeamMembersError(error, messages, messages.teamOperationError),
        })
      }
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

      await receiveCommandResponse(
        response,
        idempotencyKey,
        messages.deleteMemberError,
        (candidate) => candidate.success === true,
      )

      setMembers((currentMembers) =>
        currentMembers.filter((member) => String(member.id) !== String(selectedMember.id)),
      )
      closeModal()
      setFeedback({ message: messages.deleteMemberSuccess, tone: 'success' })
    } catch (error) {
      if (!(await recoverFromCommandConflict(error))) {
        setFeedback({
          tone: 'error',
          ...resolveTeamMembersError(error, messages, messages.deleteMemberError),
        })
      }
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
          sub: lockedUntil
            ? `${messages.memberLockedUntil}: ${new Date(lockedUntil).toLocaleTimeString()}`
            : null,
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

  const renderFeedback = (value: TeamMembersFeedback | null) =>
    value ? (
      <div className="portal-team-members__feedback">
        <StatusBadge label={value.message} tone={value.tone === 'success' ? 'success' : 'danger'} />
        {value.details ? (
          <ul className="portal-team-members__feedback-details">
            {value.details.map((detail) => (
              <li key={detail.label}>
                {detail.label}: {detail.value}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    ) : null

  const modalFeedback = renderFeedback(feedback)

  return (
    <Surface
      as="section"
      className="portal-settings__section portal-settings__section--wide portal-team-members"
    >
      <div className="portal-settings__section-heading">
        <span aria-hidden="true" className="portal-settings__section-icon">
          <IconUsers size={20} stroke={1.8} />
        </span>
        <div>
          <h3>{messages.teamMembersTitle}</h3>
          <p>{messages.teamDescription}</p>
        </div>
        <Button
          disabled={busy || readError}
          onClick={openAddModal}
          size="compact"
          variant="primary"
        >
          <IconPlus size={16} stroke={1.8} />
          {messages.addMember}
        </Button>
      </div>

      {renderFeedback(feedback)}

      {readError ? (
        <div className="portal-team-members__read-error" role="alert">
          <StatusBadge label={messages.teamMembersReadError} tone="danger" />
          <Button disabled={busy} onClick={retryMemberRead} size="compact" variant="ghost">
            {messages.retryTeamMembers}
          </Button>
        </div>
      ) : (
        <div className="portal-team-members__list">
          {members.length === 0 ? (
            <div className="portal-team-members__empty">{messages.noTeamMembers}</div>
          ) : (
            members.map((member) => {
              const isSelf = String(member.id) === String(currentUserId)
              const statusInfo = statusLabel(member.status, member.lockedUntil)
              const isLocked =
                member.status === 'manually_locked' || member.status === 'security_locked'

              return (
                <article className="portal-team-members__item" key={member.id}>
                  <div className="portal-team-members__info">
                    <div className="portal-team-members__email-row">
                      <strong>{member.email}</strong>
                      {isSelf ? (
                        <span className="portal-team-members__self-tag">
                          ({messages.selfLabel})
                        </span>
                      ) : null}
                    </div>
                    <div className="portal-team-members__meta">
                      <span>
                        {messages.memberRole}: {roleLabel(member.role)}
                      </span>
                      <span>·</span>
                      <span>
                        {messages.memberCreatedAt}:{' '}
                        {new Date(member.createdAt).toLocaleDateString()}
                      </span>
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
      )}

      <TeamMemberDialog
        busy={busy}
        onClose={closeModal}
        open={modalMode === 'add'}
        returnFocusRef={returnFocusRef}
        title={messages.newMemberTitle}
      >
        {modalFeedback}
        <form className="portal-modal__form" onSubmit={handleAddSubmit}>
          <label className="portal-field">
            <span className="portal-field__label">{messages.memberEmail}</span>
            <span className="portal-field__control">
              <input
                aria-label={messages.memberEmail}
                autoComplete="off"
                data-dialog-initial-focus
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
            <Button
              disabled={busy}
              onClick={closeModal}
              size="compact"
              type="button"
              variant="ghost"
            >
              {messages.cancelMember}
            </Button>
            <Button disabled={busy} size="compact" type="submit" variant="primary">
              {busy ? messages.savingMember : messages.saveMember}
            </Button>
          </div>
        </form>
      </TeamMemberDialog>

      <TeamMemberDialog
        busy={busy}
        onClose={closeModal}
        open={modalMode === 'edit'}
        returnFocusRef={returnFocusRef}
        title={messages.editMemberTitle}
      >
        {modalFeedback}
        <form className="portal-modal__form" onSubmit={handleEditSubmit}>
          <label className="portal-field">
            <span className="portal-field__label">{messages.memberEmail}</span>
            <span className="portal-field__control">
              <input
                aria-label={messages.memberEmail}
                data-dialog-initial-focus
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
            <Button
              disabled={busy}
              onClick={closeModal}
              size="compact"
              type="button"
              variant="ghost"
            >
              {messages.cancelMember}
            </Button>
            <Button disabled={busy} size="compact" type="submit" variant="primary">
              {busy ? messages.savingMember : messages.saveMember}
            </Button>
          </div>
        </form>
      </TeamMemberDialog>

      <TeamMemberDialog
        busy={busy}
        description={messages.resetPasswordDescription}
        onClose={closeModal}
        open={modalMode === 'reset-password'}
        returnFocusRef={returnFocusRef}
        title={messages.resetPasswordTitle}
      >
        {modalFeedback}
        <form className="portal-modal__form" onSubmit={handleResetPasswordSubmit}>
          <label className="portal-field">
            <span className="portal-field__label">{messages.newPassword}</span>
            <span className="portal-field__control">
              <input
                aria-label={messages.newPassword}
                data-dialog-initial-focus
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
            <Button
              disabled={busy}
              onClick={closeModal}
              size="compact"
              type="button"
              variant="ghost"
            >
              {messages.cancelMember}
            </Button>
            <Button disabled={busy} size="compact" type="submit" variant="primary">
              {busy ? messages.savingPassword : messages.resetPassword}
            </Button>
          </div>
        </form>
      </TeamMemberDialog>

      <TeamMemberDialog
        busy={busy}
        description={messages.deleteMemberDescription}
        onClose={closeModal}
        open={modalMode === 'delete'}
        returnFocusRef={returnFocusRef}
        title={messages.deleteMemberTitle}
      >
        {modalFeedback}
        <form className="portal-modal__form" onSubmit={handleDeleteSubmit}>
          <div className="portal-modal__prompt">
            <p>
              {messages.confirmEmailPrompt} <strong>{selectedMember?.email ?? ''}</strong>
            </p>
          </div>
          <label className="portal-field">
            <span className="portal-field__label">{messages.memberEmail}</span>
            <span className="portal-field__control">
              <input
                aria-label={messages.memberEmail}
                autoComplete="off"
                data-dialog-initial-focus
                onChange={(event) => setFormConfirmEmail(event.target.value)}
                placeholder={selectedMember?.email}
                required
                type="email"
                value={formConfirmEmail}
              />
            </span>
          </label>

          <div className="portal-modal__actions">
            <Button
              disabled={busy}
              onClick={closeModal}
              size="compact"
              type="button"
              variant="ghost"
            >
              {messages.cancelMember}
            </Button>
            <Button
              disabled={
                busy ||
                !selectedMember ||
                formConfirmEmail.trim().toLowerCase() !== selectedMember.email.toLowerCase()
              }
              size="compact"
              type="submit"
              variant="danger"
            >
              {busy ? messages.deletingMember : messages.confirmDeleteMember}
            </Button>
          </div>
        </form>
      </TeamMemberDialog>
    </Surface>
  )
}
