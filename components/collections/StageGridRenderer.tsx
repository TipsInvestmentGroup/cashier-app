'use client'
import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useApi } from '@/hooks/useApi'

interface FieldDef { id: string; key: string; label: string; fieldType: string; isRequired: boolean }
interface SectionDef { id: string; key: string; label: string; fields: FieldDef[] }
interface StageDef { id: string; label: string; sections: SectionDef[] }
interface Option { id: string; name: string }

interface Props {
  stage: StageDef
  onSubmit: (rows: { staffId: string; values: Record<string, string> }[]) => Promise<void>
  /** BATCH mode: start with nobody selected and require picking a subset of
   *  staff before the grid appears, instead of showing every active staff
   *  member (MULTI_STAFF_GRID's behavior) right away. */
  batchMode?: boolean
}

/**
 * MULTI_STAFF_GRID / BATCH entry mode: one table, every non-picker field as
 * a column. In MULTI_STAFF_GRID every active staff member is a row from the
 * start; in BATCH the cashier first picks which staff this batch covers.
 * STAFF_PICKER/PERSON_PICKER columns are skipped — the row's staff IS the
 * staff picker in this mode. Rows left entirely blank are not submitted.
 */
export function StageGridRenderer({ stage, onSubmit, batchMode }: Props) {
  const { request } = useApi()
  const [staffOptions, setStaffOptions] = useState<Option[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Record<string, Record<string, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fields = stage.sections.flatMap((s) => s.fields).filter((f) => f.fieldType !== 'STAFF_PICKER' && f.fieldType !== 'PERSON_PICKER')

  useEffect(() => { request('/api/staff-list').then(setStaffOptions).catch(() => {}) }, [request])

  const toggleStaff = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const query = search.trim().toLowerCase()
  const matchesSearch = (s: Option) => !query || s.name.toLowerCase().includes(query)
  // In the chip picker, keep an already-selected chip visible even if it no
  // longer matches what's typed — losing track of who's picked mid-search
  // would be worse than a slightly longer chip list.
  const chipOptions = useMemo(() => staffOptions.filter((s) => matchesSearch(s) || selected.has(s.id)), [staffOptions, query, selected])
  const visibleStaff = (batchMode ? staffOptions.filter((s) => selected.has(s.id)) : staffOptions).filter(matchesSearch)

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
      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search staff by name…"
          className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white" />
      </div>

      {batchMode && (
        <div className="bg-white rounded-2xl border border-gray-100 p-3">
          <p className="text-xs font-semibold text-gray-500 mb-2">Select staff for this batch ({selected.size} selected)</p>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
            {chipOptions.map((s) => (
              <button key={s.id} onClick={() => toggleStaff(s.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${selected.has(s.id) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                {s.name}
              </button>
            ))}
            {chipOptions.length === 0 && <p className="text-xs text-gray-400 py-1">No staff match "{search}"</p>}
          </div>
        </div>
      )}

      <div className="overflow-x-auto bg-white rounded-2xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-3 py-2 font-semibold text-gray-500 sticky left-0 bg-white">Staff</th>
              {fields.map((f) => <th key={f.id} className="text-left px-3 py-2 font-semibold text-gray-500 whitespace-nowrap">{f.label}{f.isRequired && <span className="text-red-500"> *</span>}</th>)}
            </tr>
          </thead>
          <tbody>
            {visibleStaff.length === 0 && (
              <tr><td colSpan={fields.length + 1} className="px-3 py-6 text-center text-xs text-gray-400">
                {batchMode && selected.size === 0 ? 'Select staff above to start entering this batch' : `No staff match "${search}"`}
              </td></tr>
            )}
            {visibleStaff.map((staff) => (
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
