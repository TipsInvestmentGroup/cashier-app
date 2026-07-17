'use client'
import { useEffect, useState } from 'react'
import { useApi } from '@/hooks/useApi'

interface FieldDef { id: string; key: string; label: string; fieldType: string; isRequired: boolean }
interface SectionDef { id: string; key: string; label: string; fields: FieldDef[] }
interface StageDef { id: string; label: string; sections: SectionDef[] }
interface Option { id: string; name: string }

interface Props {
  stage: StageDef
  onSubmit: (rows: { staffId: string; values: Record<string, string> }[]) => Promise<void>
}

/**
 * MULTI_STAFF_GRID entry mode: one table, every active staff member as a
 * row, every non-picker field as a column. STAFF_PICKER/PERSON_PICKER
 * columns are skipped — the row's staff IS the staff picker in this mode.
 * Rows left entirely blank are just not submitted (see the grid API route).
 */
export function StageGridRenderer({ stage, onSubmit }: Props) {
  const { request } = useApi()
  const [staffOptions, setStaffOptions] = useState<Option[]>([])
  const [rows, setRows] = useState<Record<string, Record<string, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fields = stage.sections.flatMap((s) => s.fields).filter((f) => f.fieldType !== 'STAFF_PICKER' && f.fieldType !== 'PERSON_PICKER')

  useEffect(() => { request('/api/staff-list').then(setStaffOptions).catch(() => {}) }, [request])

  const setCell = (staffId: string, fieldId: string, value: string) =>
    setRows((prev) => ({ ...prev, [staffId]: { ...prev[staffId], [fieldId]: value } }))

  const submit = async () => {
    setError(null)
    const payload = Object.entries(rows)
      .map(([staffId, values]) => ({ staffId, values }))
      .filter((r) => Object.values(r.values).some((v) => v !== undefined && v !== '' && v !== null))
    if (payload.length === 0) { setError('Enter at least one row before saving'); return }
    setSubmitting(true)
    try { await onSubmit(payload) } finally { setSubmitting(false) }
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto bg-white rounded-2xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-3 py-2 font-semibold text-gray-500 sticky left-0 bg-white">Staff</th>
              {fields.map((f) => <th key={f.id} className="text-left px-3 py-2 font-semibold text-gray-500 whitespace-nowrap">{f.label}{f.isRequired && <span className="text-red-500"> *</span>}</th>)}
            </tr>
          </thead>
          <tbody>
            {staffOptions.map((staff) => (
              <tr key={staff.id} className="border-b border-gray-50">
                <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap sticky left-0 bg-white">{staff.name}</td>
                {fields.map((f) => (
                  <td key={f.id} className="px-3 py-1.5">
                    {f.fieldType === 'BOOLEAN' ? (
                      <input type="checkbox" checked={rows[staff.id]?.[f.id] === 'true'}
                        onChange={(e) => setCell(staff.id, f.id, e.target.checked ? 'true' : 'false')} />
                    ) : (
                      <input type={f.fieldType === 'NUMBER' ? 'number' : f.fieldType === 'DATE' ? 'date' : 'text'}
                        value={rows[staff.id]?.[f.id] || ''} onChange={(e) => setCell(staff.id, f.id, e.target.value)}
                        placeholder={f.fieldType === 'NUMBER' ? '0' : ''}
                        className="w-28 px-2 py-1 border border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>}

      <button onClick={submit} disabled={submitting}
        className="w-full py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50">
        {submitting ? 'Saving…' : `Save "${stage.label}"`}
      </button>
    </div>
  )
}
