import { forwardRef, type ReactNode, type SelectHTMLAttributes } from 'react'
import { IconChevronDown } from '@tabler/icons-react'

import { cn } from './cn'

export interface SelectOption {
  disabled?: boolean
  label: string
  value: string
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  leadingIcon?: ReactNode
  options?: readonly SelectOption[]
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ children, className, disabled, leadingIcon, options, ...props }, ref) => {
    return (
      <div className={cn('portal-select', className, disabled && 'is-disabled')}>
        {leadingIcon ? <span className="portal-select__leading-icon">{leadingIcon}</span> : null}
        <select
          className={cn('portal-select__control', leadingIcon && 'has-leading-icon')}
          disabled={disabled}
          ref={ref}
          {...props}
        >
          {options
            ? options.map((option) => (
                <option disabled={option.disabled} key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            : children}
        </select>
        <IconChevronDown aria-hidden="true" className="portal-select__chevron" size={15} stroke={2} />
      </div>
    )
  },
)

Select.displayName = 'Select'
