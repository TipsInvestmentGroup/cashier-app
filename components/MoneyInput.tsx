'use client'
import React from 'react'

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string
  onChange: (raw: string) => void
}

/**
 * Number entry that DISPLAYS thousands separators (1,234,567) while keeping the
 * raw digit string (no commas) in the parent's state — so existing Number(form.x)
 * parsing keeps working unchanged. Supports a single decimal point.
 */
export function MoneyInput({ value, onChange, ...rest }: Props) {
  const fmt = (v: string) => {
    if (v === '' || v == null) return ''
    const [int, dec] = v.split('.')
    const grouped = (int || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return dec !== undefined ? `${grouped}.${dec}` : grouped
  }
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/,/g, '').replace(/[^\d.]/g, '')
    const parts = raw.split('.')
    if (parts.length > 2) raw = parts[0] + '.' + parts.slice(1).join('')
    onChange(raw)
  }
  return <input {...rest} type="text" inputMode="decimal" value={fmt(value)} onChange={handle} />
}
