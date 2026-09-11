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
  IconX,
} from '@tabler/icons-react'

import { usePortalCommandKey } from '@/admin-portal/core/commands/usePortalCommandKey'
import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import {
  PERMISSION_MODULE_IDS,
  PORTAL_PERMISSION_PRESETS,
  type PortalUserPermissions,
} from '@/access/roles'
import { Button, StatusBadge, Surface, UiSelect } from '@/admin-portal/core/ui'

import type { PortalTeamMemberDTO, PortalTeamMemberRole } from './userSettingsContracts'

export interface TeamMembersPanelProps {
  currentUserId: number | string
  initialMembers?: PortalTeamMemberDTO[]
  initialReadError?: boolean
}

type ModalMode = 'add' | 'delete' | 'edit' | 'reset-password' | null

const temporaryPasswordCharacters =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*'

const generateTemporaryPassword = (): string => {
  const random = new Uint32Array(16)
  crypto.getRandomValues(random)
  return Array.from(random, (value) =>
    temporaryPasswordCharacters.charAt(value % temporaryPasswordCharacters.length),
  ).join('')
}

const clonePermissions = (value: PortalUserPermissions): PortalUserPermissions =>
  Object.fromEntries(
    PERMISSION_MODULE_IDS.map((moduleId) => [moduleId, { ...value[moduleId] }]),
  ) as PortalUserPermissions

const applyPermissionTemplate = (role: 'admin' | 'operator' | 'sales'): PortalUserPermissions =>
  clonePermissions(PORTAL_PERMISSION_PRESETS[role])

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

const formatMemberDate = (value: string, locale: 'en' | 'zh'): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
  }).format(date)
}

const formatMemberTime = (value: string, locale: 'en' | 'zh'): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    timeStyle: 'short',
  }).format(date)
}

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
          className="portal-shell portal-surface portal-modal portal-modal--team"
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
            const firstField =
              contentRef.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]') ??
              contentRef.current?.querySelector<HTMLElement>(
                'input:not([disabled]), select:not([disabled]), button:not([disabled])',
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
            <Dialog.Close asChild>
              <Button
                aria-label="关闭弹窗"
                className="portal-modal__close-btn"
                disabled={busy}
                size="icon"
                type="button"
                variant="ghost"
              >
                <IconX aria-hidden="true" size={16} stroke={2} />
              </Button>
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PermissionMatrix({
  locale,
  messages,
  onChange,
  value,
}: {
  locale: 'en' | 'zh'
  messages: ReturnType<typeof getPortalMessages>['settings']
  onChange: (permissions: PortalUserPermissions) => void
  value: PortalUserPermissions
}) {
  const moduleMessages = getPortalMessages(locale).modules

  const updatePermission = (
    moduleId: (typeof PERMISSION_MODULE_IDS)[number],
    action: 'edit' | 'view',
    checked: boolean,
  ) => {
    const current = value[moduleId]
    const view = action === 'view' ? checked : checked ? true : current.view
    const edit = action === 'edit' ? checked : current.edit
    onChange({
      ...value,
      [moduleId]: {
        edit: view && edit,
        view,
      },
    })
  }

  return (
    <div className="portal-team-members__permissions-section">
      <div className="portal-team-members__perm-header">
        <div className="portal-team-members__perm-title-wrap">
          <span className="portal-field__label">
            <span aria-hidden="true" className="portal-required" />
            {messages.permissionMatrix}
          </span>
          <span className="portal-team-members__perm-required-badge">必填</span>
        </div>
        <div className="portal-team-members__perm-quick-actions">
          <Button
            onClick={() => {
              onChange(
                Object.fromEntries(
                  PERMISSION_MODULE_IDS.map((moduleId) => [moduleId, { edit: true, view: true }]),
                ) as PortalUserPermissions,
              )
            }}
            size="compact"
            type="button"
            variant="ghost"
          >
            {messages.permissionAll}
          </Button>
          <Button
            onClick={() => {
              onChange(
                Object.fromEntries(
                  PERMISSION_MODULE_IDS.map((moduleId) => [moduleId, { edit: false, view: false }]),
                ) as PortalUserPermissions,
              )
            }}
            size="compact"
            type="button"
            variant="ghost"
          >
            {messages.permissionNone}
          </Button>
        </div>
      </div>
      <div className="portal-team-members__perm-grid">
        {PERMISSION_MODULE_IDS.map((moduleId) => {
          const perm = value[moduleId]
          const isActive = perm.view || perm.edit
          return (
            <article
              key={moduleId}
              className={`portal-team-members__perm-card ${isActive ? 'is-active' : ''}`}
            >
              <div className="portal-team-members__perm-card-header">
                <strong>{moduleMessages[moduleId]}</strong>
              </div>
              <div className="portal-team-members__perm-card-actions">
                <label className="portal-team-members__check-label">
                  <input
                    checked={perm.view}
                    onChange={(event) => updatePermission(moduleId, 'view', event.target.checked)}
                    type="checkbox"
                  />
                  {messages.permissionView}
                </label>
                <label className="portal-team-members__check-label">
                  <input
                    checked={perm.edit}
                    onChange={(event) => updatePermission(moduleId, 'edit', event.target.checked)}
                    type="checkbox"
                  />
                  {messages.permissionEdit}
                </label>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

export function TeamMembersPanel({
  currentUserId,
  initialMembers = [],
  initialReadError = false,
}: TeamMembersPanelProps) {
  const { locale } = usePortalPreferences()
  const messages = getPortalMessages(locale).settings
  const moduleMessages = getPortalMessages(locale).modules
  const command = usePortalCommandKey('portal-team-members')

  const [members, setMembers] = useState<PortalTeamMemberDTO[]>(initialMembers)
  const [busy, setBusy] = useState(false)
  const [readError, setReadError] = useState(initialReadError)
  const [feedback, setFeedback] = useState<TeamMembersFeedback | null>(null)

  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [selectedMember, setSelectedMember] = useState<PortalTeamMemberDTO | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  // Form states
  const [formUsername, setFormUsername] = useState('')
  const [formRole, setFormRole] = useState<PortalTeamMemberRole>('sales')
  const [formPassword, setFormPassword] = useState('')
  const [formConfirmPassword, setFormConfirmPassword] = useState('')
  const [formPermissions, setFormPermissions] = useState<PortalUserPermissions>(() =>
    applyPermissionTemplate('sales'),
  )
  const [formConfirmUsername, setFormConfirmUsername] = useState('')

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
    setFormRole('sales')
    setFormPassword(generateTemporaryPassword())
    setFormUsername('')
    setFormPermissions(applyPermissionTemplate('sales'))
    setFeedback(null)
    setModalMode('add')
  }

  const openEditModal = (member: PortalTeamMemberDTO) => {
    rememberTrigger()
    setSelectedMember(member)
    setFormRole(member.role)
    setFormUsername(member.username)
    setFormPermissions(clonePermissions(member.permissions))
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
    setFormConfirmUsername('')
    setFeedback(null)
    setModalMode('delete')
  }

  const closeModal = useCallback(() => {
    const trigger = returnFocusRef.current
    setModalMode(null)
    setSelectedMember(null)
    setFormUsername('')
    setFormPassword('')
    setFormPermissions(applyPermissionTemplate('sales'))
    setFormConfirmPassword('')
    setFormConfirmUsername('')
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
    setBusy(true)
    setFeedback(null)
    const idempotencyKey = command.key(
      JSON.stringify({
        action: 'create_team_member',
        username: formUsername.trim().toLowerCase(),
        role: formRole,
      }),
    )

    try {
      const response = await fetch('/api/portal/settings/users', {
        body: JSON.stringify({
          permissions: formPermissions,
          password: formPassword,
          role: formRole,
          username: formUsername,
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
        username: formUsername.trim().toLowerCase(),
        id: selectedMember.id,
        role: formRole,
        updatedAt: selectedMember.updatedAt,
      }),
    )

    try {
      const response = await fetch(`/api/portal/settings/users/${selectedMember.id}`, {
        body: JSON.stringify({
          permissions: formPermissions,
          role: formRole,
          updatedAt: selectedMember.updatedAt,
          username: formUsername,
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
        confirmUsername: formConfirmUsername.trim().toLowerCase(),
        id: selectedMember.id,
        updatedAt: selectedMember.updatedAt,
      }),
    )

    try {
      const response = await fetch(`/api/portal/settings/users/${selectedMember.id}`, {
        body: JSON.stringify({
          confirmUsername: formConfirmUsername,
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

  const handleRoleChange = (role: PortalTeamMemberRole) => {
    setFormRole(role)
    setFormPermissions(applyPermissionTemplate(role))
  }

  const handleCopyPassword = async () => {
    await navigator.clipboard.writeText(formPassword)
    setFeedback({ message: messages.copyPasswordSuccess, tone: 'success' })
  }

  const statusLabel = (status: PortalTeamMemberDTO['status'], lockedUntil: string | null) => {
    switch (status) {
      case 'security_locked':
        return {
          label: messages.statusSecurityLocked,
          sub: lockedUntil
            ? `${messages.memberLockedUntil}: ${formatMemberTime(lockedUntil, locale)}`
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
                    <div className="portal-team-members__username-row">
                      <strong>{member.username}</strong>
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
                        {messages.memberCreatedAt}: {formatMemberDate(member.createdAt, locale)}
                      </span>
                    </div>
                    <div className="portal-team-members__permission-tags">
                      {PERMISSION_MODULE_IDS.map((moduleId) => (
                        <small key={moduleId}>
                          {moduleMessages[moduleId]}:{' '}
                          {member.permissions[moduleId].edit
                            ? messages.permissionEditable
                            : messages.permissionViewOnly}
                        </small>
                      ))}
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
            <span className="portal-field__label">
              <span aria-hidden="true" className="portal-required" />
              {messages.memberUsername}
            </span>
            <span className="portal-field__control">
              <input
                aria-label={messages.memberUsername}
                autoComplete="off"
                data-dialog-initial-focus
                onChange={(event) => setFormUsername(event.target.value)}
                required
                type="text"
                value={formUsername}
              />
            </span>
          </label>

          <div className="portal-team-members__template-field">
            <div className="portal-team-members__template-label-row">
              <span className="portal-field__label" style={{ marginBottom: 0 }}>
                <span>{messages.memberRole}</span>
                <span className="portal-team-members__template-tag">可选权限模板</span>
              </span>
              <span className="portal-team-members__template-tip">选择可快速套用预设权限</span>
            </div>
            <UiSelect
              ariaLabel={messages.memberRole}
              onChange={(value) => handleRoleChange(value as PortalTeamMemberRole)}
              options={[
                { label: messages.roleSalesOption, value: 'sales' },
                { label: messages.roleOperatorOption, value: 'operator' },
                { label: messages.roleAdminOption, value: 'admin' },
              ]}
              required={false}
              value={formRole}
            />
          </div>

          <PermissionMatrix
            locale={locale}
            messages={messages}
            onChange={setFormPermissions}
            value={formPermissions}
          />

          <label className="portal-field">
            <span className="portal-field__label">
              <span aria-hidden="true" className="portal-required" />
              {messages.initialPassword}
            </span>
            <span className="portal-field__control">
              <input
                aria-label={messages.initialPassword}
                maxLength={128}
                minLength={12}
                onChange={(event) => setFormPassword(event.target.value)}
                required
                type="text"
                value={formPassword}
              />
            </span>
          </label>

          <div className="portal-team-members__permission-actions">
            <Button
              disabled={busy}
              onClick={() => setFormPassword(generateTemporaryPassword())}
              size="compact"
              type="button"
              variant="ghost"
            >
              {messages.generatePassword}
            </Button>
            <Button
              disabled={busy}
              onClick={handleCopyPassword}
              size="compact"
              type="button"
              variant="ghost"
            >
              {messages.copyPassword}
            </Button>
          </div>

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
            <span className="portal-field__label">{messages.memberUsername}</span>
            <span className="portal-field__control">
              <input
                aria-label={messages.memberUsername}
                autoComplete="username"
                data-dialog-initial-focus
                onChange={(event) => setFormUsername(event.target.value)}
                required
                type="text"
                value={formUsername}
              />
            </span>
          </label>

          <div className="portal-team-members__template-field">
            <div className="portal-team-members__template-label-row">
              <span className="portal-field__label" style={{ marginBottom: 0 }}>
                <span>{messages.memberRole}</span>
                <span className="portal-team-members__template-tag">可选权限模板</span>
              </span>
              <span className="portal-team-members__template-tip">选择可快速套用预设权限</span>
            </div>
            <UiSelect
              ariaLabel={messages.memberRole}
              onChange={(value) => handleRoleChange(value as PortalTeamMemberRole)}
              options={[
                { label: messages.roleSalesOption, value: 'sales' },
                { label: messages.roleOperatorOption, value: 'operator' },
                { label: messages.roleAdminOption, value: 'admin' },
              ]}
              required={false}
              value={formRole}
            />
          </div>

          <PermissionMatrix
            locale={locale}
            messages={messages}
            onChange={setFormPermissions}
            value={formPermissions}
          />

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
            <span className="portal-field__label">
              <span aria-hidden="true" className="portal-required" />
              {messages.newPassword}
            </span>
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
            <span className="portal-field__label">
              <span aria-hidden="true" className="portal-required" />
              {messages.confirmResetPassword}
            </span>
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
              {messages.confirmUsernamePrompt} <strong>{selectedMember?.username ?? ''}</strong>
            </p>
          </div>
          <label className="portal-field">
            <span className="portal-field__label">{messages.memberUsername}</span>
            <span className="portal-field__control">
              <input
                aria-label={messages.memberUsername}
                autoComplete="off"
                data-dialog-initial-focus
                onChange={(event) => setFormConfirmUsername(event.target.value)}
                placeholder={selectedMember?.username}
                required
                type="text"
                value={formConfirmUsername}
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
                formConfirmUsername.trim().toLowerCase() !== selectedMember.username.toLowerCase()
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
