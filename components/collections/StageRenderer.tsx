'use client'
import { useEffect, useState } from 'react'
import { useApi } from '@/hooks/useApi'

interface FieldDef { id: string; key: string; label: string; fieldType: string; isRequired: boolean }
interface SectionDef { id: string; key: string; label: string; isMandatory: boolean; fields: FieldDef[] }
interface StageDef { id: string; key: string; label: string; entryMode: string; sections: SectionDef[] }
interface Option { id: string; name: string }

interface Props {
  stage: StageDef
  initialValues?: Record<string, string>
  onSubmit: (payload: { staffId: string | null; staffName: string | null; values: Record<string, string> }) => Promise<void>
}

/**
 * Renders one stage's sections/fields generically from template metadata —
 * SINGLE_STAFF entry mode only (other modes are a later phase). Field
 * inputs map fieldType to a simple, honest control rather than reusing the
 * bespoke pickers in app/collections/page.tsx (those are tightly coupled to
 * the fixed form); STAFF_PICKER/PERSON_PICKER load their own option list.
 */
export function StageRenderer({ stage, initialValues, onSubmit }: Props) {
  const { request } = useApi()
  const [values, setValues] = useState<Record<string, string>>(initialValues || {})
  const [staffOptions, setStaffOptions] = useState<Option[]>([])
  const [personOptions, setPersonOptions] = useState<Option[]>([])
  const [manualStaffId, setManualStaffId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fields = stage.sections.flatMap((s) => s.fields)
  const staffField = fields.find((f) => f.fieldType === 'STAFF_PICKER')
  const needsManualStaffPicker = stage.entryMode === 'SINGLE_STAFF' && !staffField

  useEffect(() => {
    const needsStaff = fields.some((f) => f.fieldType === 'STAFF_PICKER') || needsManualStaffPicker
    const needsPerson = fields.some((f) => f.fieldType === 'PERSON_PICKER')
    if (needsStaff) request('/api/staff-list').then(setStaffOptions).catch(() => {})
    if (needsPerson) request('/api/persons').then(setPersonOptions).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = (fieldId: string, v: string) => setValues((prev) => ({ ...prev, [fieldId]: v }))

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError(null)
    for (const f of fields) {
      if (f.isRequired && !values[f.id]) { setError(`"${f.label}" is required`); return }
    }
    const staffId = staffField ? values[staffField.id] || null : needsManualStaffPicker ? manualStaffId || null : null
    const staffName = staffId ? staffOptions.find((o) => o.id === staffId)?.name || null : null
    if (stage.entryMode === 'SINGLE_STAFF' && !staffId) { setError('Select the staff member'); return }
    setSubmitting(true)
    try { await onSubmit({ staffId, staffName, values }) } finally { setSubmitting(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {needsManualStaffPicker && (
        <div>
          <label className="text-xs font-semibold text-gray-500">Staff</label>
          <select value={manualStaffId} onChange={(e) => setManualStaffId(e.target.value)}
            className="w-full mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
            <option value="">-- Select staff --</option>
            {staffOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      )}

      {stage.sections.map((section) => (
        <div key={section.id} className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">{section.label}{section.isMandatory && <span className="text-red-500"> *</span>}</h3>
          <div className="space-y-3">
            {section.fields.map((f) => (
              <div key={f.id}>
                <label className="text-xs font-semibold text-gray-500">{f.label}{f.isRequired && <span className="text-red-500"> *</span>}</label>
                {f.fieldType === 'NUMBER' && (
                  <input type="number" value={values[f.id] || ''} onChange={(e) => set(f.id, e.target.value)}
                    className="w-full mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" placeholder="0" />
                )}
                {f.fieldType === 'TEXT' && (
                  <input type="text" value={values[f.id] || ''} onChange={(e) => set(f.id, e.target.value)}
                    className="w-full mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
                )}
                {f.fieldType === 'DATE' && (
                  <input type="date" value={values[f.id] || ''} onChange={(e) => set(f.id, e.target.value)}
                    className="w-full mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
                )}
                {f.fieldType === 'BOOLEAN' && (
                  <label className="flex items-center gap-2 mt-1 text-sm text-gray-600">
                    <input type="checkbox" checked={values[f.id] === 'true'} onChange={(e) => set(f.id, e.target.checked ? 'true' : 'false')} /> Yes
                  </label>
                )}
                {f.fieldType === 'SELECT' && (
                  <input type="text" value={values[f.id] || ''} onChange={(e) => set(f.id, e.target.value)}
                    placeholder="Type a value" className="w-full mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
                )}
                {f.fieldType === 'STAFF_PICKER' && (
                  <select value={values[f.id] || ''} onChange={(e) => set(f.id, e.target.value)}
                    className="w-full mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
                    <option value="">-- Select staff --</option>
                    {staffOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                )}
                {f.fieldType === 'PERSON_PICKER' && (
                  <select value={values[f.id] || ''} onChange={(e) => set(f.id, e.target.value)}
                    className="w-full mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
                    <option value="">-- Select person --</option>
                    {personOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                )}
              </div>
            ))}
            {section.fields.length === 0 && <p className="text-xs text-gray-400">No fields configured for this section.</p>}
          </div>
        </div>
      ))}

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>}

      <button type="submit" disabled={submitting}
        className="w-full py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50">
        {submitting ? 'Saving…' : `Save "${stage.label}"`}
      </button>
    </form>
  )
}
