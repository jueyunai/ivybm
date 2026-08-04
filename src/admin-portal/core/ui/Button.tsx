import { forwardRef, type ButtonHTMLAttributes } from 'react'

import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from './cn'

const buttonVariants = cva('portal-button', {
  variants: {
    size: {
      compact: 'portal-button--compact',
      default: 'portal-button--default',
      icon: 'portal-button--icon',
    },
    variant: {
      danger: 'portal-button--danger',
      ghost: 'portal-button--ghost',
      primary: 'portal-button--primary',
      secondary: 'portal-button--secondary',
    },
  },
  defaultVariants: {
    size: 'default',
    variant: 'primary',
  },
})

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, size, type, variant, ...props }, ref) => {
    const Component = asChild ? Slot : 'button'

    return (
      <Component
        className={cn(buttonVariants({ className, size, variant }))}
        ref={ref}
        type={asChild ? undefined : (type ?? 'button')}
        {...props}
      />
    )
  },
)

Button.displayName = 'Button'

export { buttonVariants }
