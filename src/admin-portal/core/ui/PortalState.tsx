import type { ReactNode } from 'react'

import {
  IconAlertTriangle,
  IconBarrierBlock,
  IconClockPause,
  IconInbox,
  IconLoader2,
  IconLock,
  type Icon as TablerIcon,
} from '@tabler/icons-react'

import { cn } from './cn'

export type PortalStateType =
  | 'blocked'
  | 'dependency-gated'
  | 'empty'
  | 'error'
  | 'forbidden'
  | 'loading'

export interface PortalStateProps {
  action?: ReactNode
  className?: string
  description: string
  title: string
  type: PortalStateType
}

const icons: Record<PortalStateType, TablerIcon> = {
  blocked: IconBarrierBlock,
  'dependency-gated': IconClockPause,
  empty: IconInbox,
  error: IconAlertTriangle,
  forbidden: IconLock,
  loading: IconLoader2,
}

export function PortalState({ action, className, description, title, type }: PortalStateProps) {
  const Icon = icons[type]
  const liveRole = type === 'error' || type === 'forbidden' ? 'alert' : 'status'

  return (
    <section
      aria-busy={type === 'loading' ? 'true' : undefined}
      className={cn('portal-state', `portal-state--${type}`, className)}
      role={liveRole}
    >
      <span aria-hidden="true" className="portal-state__icon">
        <Icon size={20} stroke={1.8} />
      </span>
      <div>
        <h2 className="portal-state__title">{title}</h2>
        <p className="portal-state__description">{description}</p>
        {action ? <div className="portal-state__action">{action}</div> : null}
      </div>
    </section>
  )
}
