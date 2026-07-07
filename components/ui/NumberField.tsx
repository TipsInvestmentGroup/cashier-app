'use client'
import { useState } from 'react'

/** Formats a raw numeric string with thousand separators for display, e.g. "700000" -> "700,000". Keeps a trailing "." while the user is still typing decimals. */
export function formatNumberInput(raw: string): string {
  const clean = raw.replace(/[^0-9.]/g, '')
  if (!clean) return ''
  const [intPart, ...rest] = clean.split('.')
  const intFormatted = (Number(intPart || '0') || 0).toLocaleString('en-US')
  if (rest.length === 0) return intFormatted
  return `${intFormatted}.${rest.join('').slice(0, 2)}`
}

/** Controlled number input that displays comma separators while typing; `value`/`onChange` carry the plain (unformatted) numeric string. */
export function NumberField({ value, onChange, className, placeholder }: { value: string; onChange: (raw: string) => void; className?: string; placeholder?: string }) {
  return (
    <input
      type="text" inputMode="decimal" placeholder={placeholder} className={className}
      value={formatNumberInput(value)}
      onChange={(e) => onChange(e.target.value.replace(/,/g, ''))}
    />
  )
}

/** Same comma formatting as NumberField, but for "type freely, commit on blur" inline-edit inputs (defaultValue + onBlur) rather than a value fully controlled by the parent. */
export function InlineNumberField({ defaultValue, onCommit, className, placeholder }: { defaultValue: number | string; onCommit: (raw: string) => void; className?: string; placeholder?: string }) {
  const [value, setValue] = useState(defaultValue === '' || defaultValue == null ? '' : String(defaultValue))
  return (
    <input
      type="text" inputMode="decimal" placeholder={placeholder} className={className}
      value={formatNumberInput(value)}
      onChange={(e) => setValue(e.target.value.replace(/,/g, ''))}
      onBlur={() => onCommit(value)}
    />
  )
}
