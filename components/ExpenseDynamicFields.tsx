'use client'
import { useEffect, useState, useCallback } from 'react'
import { useApi } from '@/hooks/useApi'

export interface RequestTypeField {
  id: string
  fieldKey: string
  label: string
  fieldType: string
  required: boolean
  options: string | null
  sortOrder: number
  isSystem: boolean
}

const inputCls = 'w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white'

function parseOptions(raw: string | null): string[] {
  if (!raw) return []
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map(String) : [] } catch { return [] }
}

/** Renders one input per active RequestTypeField for a given requestTypeId —
 *  the Digital Expense Form's "do not hard-code the fields" requirement.
 *  Admin-added fields appear here with zero code changes, since this reads
 *  RequestTypeField rows rather than any fixed field list. */
export function ExpenseDynamicFields({ requestTypeId, values, onChange }: {
  requestTypeId: string
  values: Record<string, string>
  onChange: (values: Record<string, string>) => void
}) {
  const { request } = useApi()
  const [fields, setFields] = useState<RequestTypeField[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!requestTypeId) { setFields([]); setLoading(false); return }
    setLoading(true)
    try { setFields(await request(`/api/expense/request-types/${requestTypeId}/fields`)) }
    catch { setFields([]) }
    finally { setLoading(false) }
  }, [request, requestTypeId])
  useEffect(() => { load() }, [load])

  const set = (fieldKey: string, value: string) => onChange({ ...values, [fieldKey]: value })

  if (!requestTypeId) return null
  if (loading) return <p className="text-xs text-gray-400">Loading fields…</p>
  if (!fields.length) return null

  return (
    <div className="space-y-3">
      {fields.map((f) => {
        const value = values[f.fieldKey] || ''
        const label = <span className="block text-xs text-gray-500 mb-1">{f.label}{f.required && ' *'}</span>
        if (f.fieldType === 'TEXTAREA') {
          return <label key={f.id} className="block">{label}<textarea className={inputCls} rows={2} value={value} required={f.required} onChange={(e) => set(f.fieldKey, e.target.value)} /></label>
        }
        if (f.fieldType === 'SELECT') {
          const options = parseOptions(f.options)
          return (
            <label key={f.id} className="block">{label}
              <select className={inputCls} value={value} required={f.required} onChange={(e) => set(f.fieldKey, e.target.value)}>
                <option value="">Select…</option>
                {options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          )
        }
        const inputType = f.fieldType === 'DATE' ? 'date' : f.fieldType === 'NUMBER' ? 'number' : f.fieldType === 'PHONE' ? 'tel' : 'text'
        return <label key={f.id} className="block">{label}<input type={inputType} className={inputCls} value={value} required={f.required} onChange={(e) => set(f.fieldKey, e.target.value)} /></label>
      })}
    </div>
  )
}
