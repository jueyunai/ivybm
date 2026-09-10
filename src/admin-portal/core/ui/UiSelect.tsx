'use client'

import { IconChevronDown } from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'

import { cn } from './cn'

export interface UiSelectOption {
  readonly disabled?: boolean
  readonly label: string
  readonly value: string
}

export interface UiSelectProps {
  readonly ariaLabel?: string
  readonly className?: string
  readonly defaultValue?: string
  readonly disabled?: boolean
  readonly leadingIcon?: ReactNode
  readonly name?: string
  readonly onChange?: (value: string) => void
  readonly options: readonly UiSelectOption[]
  readonly required?: boolean
  readonly value?: string
}

export function UiSelect({
  ariaLabel,
  className,
  defaultValue,
  disabled = false,
  leadingIcon,
  name,
  onChange,
  options,
  required = false,
  value,
}: UiSelectProps) {
  const isControlled = value !== undefined
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? '')
  const [prevDefaultValue, setPrevDefaultValue] = useState(defaultValue)

  if (!isControlled && defaultValue !== prevDefaultValue) {
    setPrevDefaultValue(defaultValue)
    setUncontrolledValue(defaultValue ?? '')
  }

  const effectiveVal = isControlled ? value : uncontrolledValue

  const handleValueChange = (nextVal: string) => {
    if (!isControlled) {
      setUncontrolledValue(nextVal)
    }
    onChange?.(nextVal)
  }

  return (
    <div className={cn('portal-select portal-ui-select', className, disabled && 'is-disabled')}>
      {leadingIcon ? <span className="portal-select__leading-icon">{leadingIcon}</span> : null}
      <select
        aria-label={ariaLabel}
        className={cn('portal-select__control', leadingIcon && 'has-leading-icon')}
        disabled={disabled}
        name={name}
        onChange={(e) => handleValueChange(e.target.value)}
        required={required}
        value={effectiveVal}
      >
        {options.map((option) => (
          <option disabled={option.disabled} key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <IconChevronDown aria-hidden="true" className="portal-select__chevron" size={15} stroke={2} />
    </div>
  )
}
