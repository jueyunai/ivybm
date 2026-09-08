import { forwardRef, type InputHTMLAttributes } from 'react'
import { IconSearch } from '@tabler/icons-react'

import { cn } from './cn'

export interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  wrapperClassName?: string
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, disabled, wrapperClassName, type = 'search', ...props }, ref) => {
    return (
      <div className={cn('portal-search', wrapperClassName, disabled && 'is-disabled')}>
        <IconSearch aria-hidden="true" className="portal-search__icon" size={15} stroke={1.8} />
        <input
          className={cn('portal-search__input', className)}
          disabled={disabled}
          ref={ref}
          type={type}
          {...props}
        />
      </div>
    )
  },
)

SearchInput.displayName = 'SearchInput'
