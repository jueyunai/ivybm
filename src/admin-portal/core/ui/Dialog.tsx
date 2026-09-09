import * as RadixDialog from '@radix-ui/react-dialog'
import { IconX } from '@tabler/icons-react'
import { useId, type FormEvent, type ReactNode } from 'react'

import { Button } from './Button'
import { cn } from './cn'

export interface ModalDialogProps {
  children?: ReactNode
  className?: string
  closeLabel?: string
  description?: string
  maxWidth?: string
  onOpenChange: (open: boolean) => void
  open: boolean
  title: string
}

export function ModalDialog({
  children,
  className,
  closeLabel = '关闭弹窗',
  description,
  maxWidth = '560px',
  onOpenChange,
  open,
  title,
}: ModalDialogProps) {
  const descriptionId = useId()

  return (
    <RadixDialog.Root onOpenChange={onOpenChange} open={open}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="portal-modal-backdrop" />
        <RadixDialog.Content
          aria-describedby={description ? descriptionId : undefined}
          className={cn('portal-shell portal-surface portal-modal', className)}
          style={{ maxWidth }}
        >
          <header className="portal-modal__header">
            <RadixDialog.Title asChild>
              <h4>{title}</h4>
            </RadixDialog.Title>
            {description ? (
              <RadixDialog.Description id={descriptionId}>
                {description}
              </RadixDialog.Description>
            ) : null}
            <RadixDialog.Close asChild>
              <Button
                aria-label={closeLabel}
                className="portal-modal__close-btn"
                size="icon"
                type="button"
                variant="ghost"
              >
                <IconX aria-hidden="true" size={16} stroke={2} />
              </Button>
            </RadixDialog.Close>
          </header>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

export interface DrawerDialogProps {
  children?: ReactNode
  className?: string
  closeLabel?: string
  description?: string
  maxWidth?: string
  onOpenChange: (open: boolean) => void
  open: boolean
  title: string
}

export function DrawerDialog({
  children,
  className,
  closeLabel = '关闭抽屉',
  description,
  maxWidth = '760px',
  onOpenChange,
  open,
  title,
}: DrawerDialogProps) {
  const descriptionId = useId()

  return (
    <RadixDialog.Root onOpenChange={onOpenChange} open={open}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="portal-drawer-backdrop" />
        <RadixDialog.Content
          aria-describedby={description ? descriptionId : undefined}
          className={cn('portal-shell portal-surface portal-drawer', className)}
          style={{ maxWidth }}
        >
          <header className="portal-drawer__header">
            <div>
              <RadixDialog.Title asChild>
                <h4>{title}</h4>
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description id={descriptionId}>
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close asChild>
              <Button
                aria-label={closeLabel}
                className="portal-drawer__close-btn"
                size="icon"
                type="button"
                variant="ghost"
              >
                <IconX aria-hidden="true" size={16} stroke={2} />
              </Button>
            </RadixDialog.Close>
          </header>
          <div className="portal-drawer__body">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}


export interface ConfirmDialogProps {
  busy?: boolean
  cancelLabel?: string
  closeLabel?: string
  confirmLabel?: string
  description: string
  onConfirm: () => void | Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
  title: string
  variant?: 'danger' | 'primary'
}

export function ConfirmDialog({
  busy = false,
  cancelLabel = '取消',
  closeLabel,
  confirmLabel = '确认',
  description,
  onConfirm,
  onOpenChange,
  open,
  title,
  variant = 'danger',
}: ConfirmDialogProps) {
  return (
    <ModalDialog
      closeLabel={closeLabel}
      description={description}
      maxWidth="460px"
      onOpenChange={onOpenChange}
      open={open}
      title={title}
    >
      <div className="portal-modal__actions">
        <Button
          disabled={busy}
          onClick={() => onOpenChange(false)}
          size="compact"
          type="button"
          variant="ghost"
        >
          {cancelLabel}
        </Button>
        <Button
          disabled={busy}
          onClick={() => void onConfirm()}
          size="compact"
          type="button"
          variant={variant}
        >
          {confirmLabel}
        </Button>
      </div>
    </ModalDialog>
  )
}

export interface FormDialogProps {
  busy?: boolean
  busyLabel?: string
  cancelLabel?: string
  children?: ReactNode
  closeLabel?: string
  confirmLabel?: string
  description?: string
  disabled?: boolean
  maxWidth?: string
  onOpenChange: (open: boolean) => void
  onSubmit: () => void | Promise<void>
  open: boolean
  title: string
  variant?: 'danger' | 'primary'
}

export function FormDialog({
  busy = false,
  busyLabel = '正在保存…',
  cancelLabel = '取消',
  children,
  closeLabel,
  confirmLabel = '保存',
  description,
  disabled = false,
  maxWidth = '600px',
  onOpenChange,
  onSubmit,
  open,
  title,
  variant = 'primary',
}: FormDialogProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!busy && !disabled) {
      void onSubmit()
    }
  }

  return (
    <ModalDialog
      closeLabel={closeLabel}
      description={description}
      maxWidth={maxWidth}
      onOpenChange={onOpenChange}
      open={open}
      title={title}
    >
      <form className="portal-modal__form" onSubmit={handleSubmit}>
        <fieldset className="portal-modal__fieldset" disabled={busy}>
          {children}
        </fieldset>
        <div className="portal-modal__actions">
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            size="compact"
            type="button"
            variant="ghost"
          >
            {cancelLabel}
          </Button>
          <Button
            disabled={busy || disabled}
            size="compact"
            type="submit"
            variant={variant}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </form>
    </ModalDialog>
  )
}
