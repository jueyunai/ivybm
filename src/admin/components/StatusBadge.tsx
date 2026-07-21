import {
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  type Icon as TablerIcon,
} from '@tabler/icons-react'

export type StatusTone = 'danger' | 'info' | 'success' | 'warning'

type StatusBadgeProps = {
  label: string
  tone: StatusTone
}

type StatusBadgeModel = {
  icon: 'alert' | 'check' | 'info'
  label: string
  tone: StatusTone
}

const statusIcons: Record<StatusBadgeModel['icon'], TablerIcon> = {
  alert: IconAlertTriangle,
  check: IconCircleCheck,
  info: IconInfoCircle,
}

const iconForTone: Record<StatusTone, StatusBadgeModel['icon']> = {
  danger: 'alert',
  info: 'info',
  success: 'check',
  warning: 'alert',
}

export const getStatusBadgeModel = (tone: StatusTone, label: string): StatusBadgeModel => ({
  icon: iconForTone[tone],
  label,
  tone,
})

export function StatusBadge({ label, tone }: StatusBadgeProps) {
  const { icon, tone: resolvedTone } = getStatusBadgeModel(tone, label)
  const Icon = statusIcons[icon]

  return (
    <span className={`ops-status-badge ops-status-badge--${resolvedTone}`}>
      <Icon aria-hidden="true" size={15} stroke={2} />
      <span>{label}</span>
    </span>
  )
}
