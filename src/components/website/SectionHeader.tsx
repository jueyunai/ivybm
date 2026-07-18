import React from 'react'

export function SectionHeader({
  action,
  description,
  kicker,
  title,
}: {
  action?: React.ReactNode
  description?: null | string
  kicker: string
  title: string
}) {
  return (
    <div className="section-head">
      <div>
        <div className="section-kicker">{kicker}</div>
        <h2>{title}</h2>
        {description ? <p className="muted">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}
