'use client'

import * as RadixSelect from '@radix-ui/react-select'
import { IconCheck, IconChevronDown } from '@tabler/icons-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

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
  const containerRef = useRef<HTMLDivElement>(null)
  const formControlRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [invalid, setInvalid] = useState(false)
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? '')
  const [prevDefaultValue, setPrevDefaultValue] = useState(defaultValue)

  if (!isControlled && defaultValue !== prevDefaultValue) {
    setPrevDefaultValue(defaultValue)
    setUncontrolledValue(defaultValue ?? '')
  }

  const effectiveVal = isControlled ? value : uncontrolledValue
  const selectedOption =
    options.find((option) => option.value === effectiveVal) ??
    (effectiveVal === '' ? options.find((option) => option.value === '') : undefined) ??
    options[0]

  useEffect(() => {
    const form = containerRef.current?.closest('form')
    if (!form || isControlled) return

    const handleReset = () => {
      formControlRef.current?.setCustomValidity('')
      setInvalid(false)
      setUncontrolledValue(defaultValue ?? '')
    }
    form.addEventListener('reset', handleReset)
    return () => form.removeEventListener('reset', handleReset)
  }, [defaultValue, isControlled])

  const handleValueChange = (nextVal: string) => {
    const actualValue = nextVal === EMPTY_SELECT_SENTINEL ? '' : nextVal
    if (!isControlled) {
      setUncontrolledValue(actualValue)
    }
    formControlRef.current?.setCustomValidity('')
    setInvalid(false)
    onChange?.(actualValue)
  }

  return (
    <div
      className={cn('portal-ui-select', className, disabled && 'is-disabled')}
      ref={containerRef}
    >
      <RadixSelect.Root
        disabled={disabled}
        onValueChange={handleValueChange}
        value={effectiveVal}
      >
        <RadixSelect.Trigger
          aria-invalid={invalid || undefined}
          aria-label={ariaLabel}
          aria-required={required || undefined}
          className="portal-ui-select__trigger"
          data-required={required ? '' : undefined}
          ref={triggerRef}
        >
          {leadingIcon ? (
            <span className="portal-ui-select__leading-icon">{leadingIcon}</span>
          ) : null}
          <span className="portal-ui-select__value">{selectedOption?.label ?? ''}</span>
          <RadixSelect.Icon className="portal-ui-select__chevron" asChild>
            <IconChevronDown aria-hidden="true" size={15} stroke={2} />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content
            align="start"
            className="portal-shell portal-ui-select__menu"
            collisionPadding={8}
            onEscapeKeyDown={(event) => event.stopPropagation()}
            position="popper"
            sideOffset={4}
          >
            <RadixSelect.Viewport className="portal-ui-select__viewport">
              {options.map((option) => {
                const optionValue =
                  option.value === '' ? EMPTY_SELECT_SENTINEL : option.value
                const isSelected = option.value === effectiveVal

                return (
                  <RadixSelect.Item
                    className="portal-ui-select__option"
                    data-selected={isSelected || undefined}
                    data-value={option.value}
                    disabled={option.disabled ?? false}
                    key={optionValue}
                    textValue={option.label}
                    value={optionValue}
                  >
                    <span className="portal-ui-select__option-icon">
                      {isSelected ? (
                        <IconCheck aria-hidden="true" size={14} stroke={2.5} />
                      ) : null}
                    </span>
                    <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  </RadixSelect.Item>
                )
              })}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
      {name || required ? (
        <input
          aria-hidden="true"
          className="portal-ui-select__form-control"
          data-ui-select-control=""
          disabled={disabled}
          name={name}
          onChange={() => undefined}
          onInvalid={(event) => {
            event.preventDefault()
            setInvalid(true)
            triggerRef.current?.focus({ preventScroll: true })
          }}
          required={required}
          ref={formControlRef}
          tabIndex={-1}
          type="text"
          value={effectiveVal}
        />
      ) : null}
    </div>
  )
}
