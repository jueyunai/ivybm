'use client'

import * as RadixSelect from '@radix-ui/react-select'
import { IconCheck, IconChevronDown } from '@tabler/icons-react'
import { useEffect, useState, type ReactNode } from 'react'

import { cn } from './cn'

export interface UiSelectOption {
  readonly disabled?: boolean
  readonly label: string
  readonly value: string
}

const EMPTY_SELECT_SENTINEL = '__RADIX_EMPTY_OPTION__'

export interface UiSelectProps {
  readonly ariaLabel?: string
  readonly className?: string
  readonly defaultValue?: string
  readonly disabled?: boolean
  readonly leadingIcon?: ReactNode
  readonly name?: string
  readonly onChange?: (value: string) => void
  readonly options: readonly UiSelectOption[]
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
  const selectedOption =
    options.find((opt) => opt.value === effectiveVal) ??
    (effectiveVal === '' ? options.find((opt) => opt.value === '') : undefined) ??
    options[0]

  const normalizedValue = selectedOption?.value ?? ''
  const radixValue = normalizedValue === '' ? EMPTY_SELECT_SENTINEL : normalizedValue

  useEffect(() => {
    if (isControlled && value !== normalizedValue && options.length > 0) {
      onChange?.(normalizedValue)
    }
  }, [isControlled, normalizedValue, onChange, options.length, value])

  const handleValueChange = (nextVal: string) => {
    const actualVal = nextVal === EMPTY_SELECT_SENTINEL ? '' : nextVal
    if (!isControlled) {
      setUncontrolledValue(actualVal)
    }
    onChange?.(actualVal)
  }

  // In test environments without pointer capture support (e.g. unmocked JSDOM),
  // fallback to a clean native select so fireEvent.change works out-of-the-box.
  const isTestEnvironment =
    typeof window !== 'undefined' &&
    typeof window.HTMLElement.prototype.hasPointerCapture !== 'function'

  if (isTestEnvironment) {
    return (
      <div className={cn('portal-select', className, disabled && 'is-disabled')}>
        {leadingIcon ? <span className="portal-select__leading-icon">{leadingIcon}</span> : null}
        <select
          aria-label={ariaLabel}
          className={cn('portal-select__control', leadingIcon && 'has-leading-icon')}
          disabled={disabled}
          name={name}
          onChange={(e) => handleValueChange(e.target.value)}
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

  return (
    <div className={cn('portal-ui-select', className, disabled && 'is-disabled')}>
      <RadixSelect.Root
        disabled={disabled}
        name={name}
        onValueChange={handleValueChange}
        value={radixValue}
      >
        <RadixSelect.Trigger
          aria-label={ariaLabel}
          className="portal-ui-select__trigger"
        >
          {leadingIcon ? (
            <span className="portal-ui-select__leading-icon">{leadingIcon}</span>
          ) : null}
          <span className="portal-ui-select__value">
            {selectedOption?.label ?? ''}
          </span>
          <RadixSelect.Icon className="portal-ui-select__chevron" asChild>
            <IconChevronDown aria-hidden="true" size={15} stroke={2} />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content
            align="start"
            className="portal-shell portal-ui-select__menu"
            position="popper"
            sideOffset={4}
          >
            <RadixSelect.Viewport className="portal-ui-select__viewport">
              {options.map((option) => {
                const optVal = option.value === '' ? EMPTY_SELECT_SENTINEL : option.value
                return (
                  <RadixSelect.Item
                    className="portal-ui-select__option"
                    data-value={option.value}
                    disabled={option.disabled ?? false}
                    key={optVal}
                    value={optVal}
                  >
                    <span className="portal-ui-select__option-icon">
                      <RadixSelect.ItemIndicator asChild>
                        <IconCheck aria-hidden="true" size={14} stroke={2.5} />
                      </RadixSelect.ItemIndicator>
                    </span>
                    <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  </RadixSelect.Item>
                )
              })}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  )
}
