import Link from 'next/link'

import { IconArrowUpRight } from '@tabler/icons-react'

import type { StatusTone } from '../components/StatusBadge'

type DashboardQueueCardProps = {
  count: number
  description: string
  href: string
  label: string
  openLabel: string
  tone: StatusTone
}

export function DashboardQueueCard({
  count,
  description,
  href,
  label,
  openLabel,
  tone,
}: DashboardQueueCardProps) {
  return (
    <article className={`ops-queue-card ops-queue-card--${tone}`}>
      <p className="ops-queue-card__label">{label}</p>
      <strong className="ops-queue-card__count">{count}</strong>
      <p className="ops-queue-card__description">{description}</p>
      <Link className="ops-queue-card__link" href={href} prefetch>
        <span>{openLabel}</span>
        <IconArrowUpRight aria-hidden="true" size={16} stroke={2} />
      </Link>
    </article>
  )
}
