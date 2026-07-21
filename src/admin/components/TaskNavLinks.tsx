import Link from 'next/link'

import { TASK_NAV_ITEMS, getAdminCopy } from '../i18n'

type TaskNavLinksProps = {
  i18n?: {
    language?: string
  }
}

export default function TaskNavLinks({ i18n }: TaskNavLinksProps) {
  const copy = getAdminCopy(i18n?.language)

  return (
    <nav aria-label={copy.taskNavLabel} className="ops-task-nav" data-testid="task-nav-links">
      <p className="ops-task-nav__heading">{copy.navHeading}</p>
      <ul className="ops-task-nav__list">
        {TASK_NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <Link className="ops-task-nav__link" href={item.href} prefetch>
              {copy[item.labelKey]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
