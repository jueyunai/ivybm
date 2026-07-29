import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from './cn'

type SurfaceElement = 'article' | 'aside' | 'div' | 'section'
type SurfaceVariant = 'default' | 'plain' | 'subtle'

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: SurfaceElement
  children?: ReactNode
  variant?: SurfaceVariant
}

export function Surface({
  as: Component = 'div',
  children,
  className,
  variant = 'default',
  ...props
}: SurfaceProps) {
  return (
    <Component
      className={cn(
        'portal-surface',
        variant !== 'default' && `portal-surface--${variant}`,
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  )
}
