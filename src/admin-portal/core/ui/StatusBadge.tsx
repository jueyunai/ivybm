import {
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconPointFilled,
  type Icon as TablerIcon,
} from '@tabler/icons-react'

import { cn } from './cn'

export type StatusTone = 'danger' | 'info' | 'neutral' | 'success' | 'warning'

export interface StatusBadgeProps {
  className?: string
  label: string
  tone: StatusTone
}

const icons: Record<StatusTone, TablerIcon> = {
  danger: IconAlertTriangle,
  info: IconInfoCircle,
  neutral: IconPointFilled,
  success: IconCircleCheck,
  warning: IconAlertTriangle,
}

export function StatusBadge({ className, label, tone }: StatusBadgeProps) {
  const Icon = icons[tone]

  return (
    <span className={cn('portal-status-badge', `portal-status-badge--${tone}`, className)}>
      <Icon aria-hidden="true" size={14} stroke={2} />
      <span>{label}</span>
    </span>
  )
}
