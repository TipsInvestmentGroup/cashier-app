'use client'
import { useEffect, useState, useCallback } from 'react'
import { Upload, FileSpreadsheet } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import toast from 'react-hot-toast'

interface FieldDef { id: string; key: string; label: string; fieldType: string; isRequired: boolean }
interface SectionDef { id: string; key: string; label: string; fields: FieldDef[] }
interface StageDef { id: string; label: string; sections: SectionDef[] }
interface Option { id: string; name: string }
interface ParsedRow { staffId: string | null; staffName: string; values: Record<string, string> }

// Same Levenshtein similarity used by components/UploadSalesModal.tsx, kept
// local and trimmed — this component matches to a template's dynamic field
// set rather than a fixed Shisha/Food dataset, so it isn't a drop-in reuse.
function similarity(a: string, b: string): number {
  const la = a.trim().toLowerCase(), lb = b.trim().toLowerCase()
  if (!la || !lb) return 0
  const m = la.length, n = lb.length
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const cost = la[i - 1] === lb[j - 1] ? 0 : 1
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
  }
  let s = 1 - d[m][n] / (Math.max(m, n) || 1)
  if (la.includes(lb) || lb.includes(la)) s = Math.max(s, 0.85)
  return s
}

const STAFF_HEADER_KEYS = ['staff', 'attendant', 'name', 'waiter', 'server']

interface Props {
  stage: StageDef
  onSubmit: (rows: { staffId: string; values: Record<string, string> }[]) => Promise<void>
}

/**
 * EXCEL_IMPORT entry mode: bulk-fill the same grid submission the
 * MULTI_STAFF_GRID mode uses, just sourced from a spreadsheet instead of
 * typed in. Header row is matched against the stage's field labels/keys
 * (substring, case-insensitive) plus a Staff/Attendant/Name column; one
 * spreadsheet row = one staff member's stage entry.
 */
export function StageExcelImportRenderer({ stage, onSubmit }: Props) {
  const { request } = useApi()
  const [staffOptions, setStaffOptions] = useState<Option[]>([])
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const fields = stage.sections.flatMap((s) => s.fields).filter((f) => f.fieldType !== 'STAFF_PICKER' && f.fieldType !== 'PERSON_PICKER')

  useEffect(() => { request('/api/staff-list').then(setStaffOptions).catch(() => {}) }, [request])

  const matchStaff = useCallback((name: string): string | null => {
    const lc = name.trim().toLowerCase()
    const exact = staffOptions.find((s) => s.name.trim().toLowerCase() === lc)
    if (exact) return exact.id
    let best: { id: string; score: number } | null = null
    for (const s of staffOptions) {
      const score = similarity(name, s.name)
      if (!best || score > best.score) best = { id: s.id, score }
    }
    return best && best.score >= 0.75 ? best.id : null
  }, [staffOptions])

  const onFile = useCallback(async (file: File) => {
    setParsing(true); setFileName(file.name)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      const asRow = (i: number) => (aoa[i] || []).map((c) => String(c).toLowerCase().trim())

      let hi = -1
      for (let i = 0; i < Math.min(aoa.length, 8); i++) {
        const r = asRow(i)
        if (r.some((h) => STAFF_HEADER_KEYS.some((k) => h.includes(k)))) { hi = i; break }
      }
      if (hi < 0) { toast.error('Could not find a header row with a Staff/Attendant/Name column.'); setRows([]); return }

      const headers = asRow(hi)
      const staffCol = headers.findIndex((h) => STAFF_HEADER_KEYS.some((k) => h.includes(k)))
      const fieldCols = fields.map((f) => ({
        field: f,
        col: headers.findIndex((h) => h.includes(f.label.toLowerCase()) || h.includes(f.key.toLowerCase())),
      }))

      const parsed: ParsedRow[] = []
      for (const r of aoa.slice(hi + 1)) {
        const staffName = String(r[staffCol] ?? '').trim()
        if (!staffName) continue
        const values: Record<string, string> = {}
        for (const { field, col } of fieldCols) {
          if (col < 0) continue
          const raw = r[col]
          if (raw === undefined || raw === null || raw === '') continue
          values[field.id] = String(raw).trim()
        }
        if (Object.keys(values).length === 0) continue
        parsed.push({ staffId: matchStaff(staffName), staffName, values })
      }
      if (parsed.length === 0) { toast.error('No usable rows found — check the Staff column and that at least one field column matched.'); setRows([]); return }
      setRows(parsed)
    } catch {
      toast.error('Could not read the file. Use .xlsx or .csv.')
      setRows([])
    } finally { setParsing(false) }
  }, [fields, matchStaff])

  const applyStaff = (idx: number, staffId: string) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, staffId } : r)))

  const submit = async () => {
    const ready = rows.filter((r) => r.staffId)
    if (ready.length === 0) { toast.error('Match at least one row to a staff member first'); return }
    setSubmitting(true)
    try { await onSubmit(ready.map((r) => ({ staffId: r.staffId as string, values: r.values }))) }
    finally { setSubmitting(false) }
  }

  const unmatched = rows.filter((r) => !r.staffId).length

  return (
    <div className="space-y-4">
      <label className="block border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-indigo-300 transition bg-white">
        <FileSpreadsheet className="w-8 h-8 mx-auto text-gray-400 mb-2" />
        <span className="text-sm text-gray-600 font-medium">{fileName || 'Click to choose an Excel/CSV file'}</span>
        <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
      </label>
      <p className="text-[11px] text-gray-400">
        Needs a <strong>Staff/Attendant/Name</strong> column plus one column per field: {fields.map((f) => f.label).join(', ') || '(no fields configured)'}.
      </p>

      {parsing && <p className="text-sm text-gray-400">Reading file…</p>}

      {rows.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {unmatched > 0 && (
            <div className="bg-amber-50 border-b border-amber-100 px-3 py-2 text-xs text-amber-700">
              {unmatched} row(s) need a staff match before they can be saved.
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-3 py-2 font-semibold text-gray-500">Staff</th>
                {fields.map((f) => <th key={f.id} className="text-left px-3 py-2 font-semibold text-gray-500">{f.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="px-3 py-1.5">
                    {r.staffId ? (
                      <span className="font-medium text-gray-700">{staffOptions.find((s) => s.id === r.staffId)?.name || r.staffName}</span>
                    ) : (
                      <select value="" onChange={(e) => applyStaff(i, e.target.value)} className="px-2 py-1 border border-amber-300 rounded-lg text-xs bg-amber-50">
                        <option value="">&quot;{r.staffName}&quot; — select match</option>
                        {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    )}
                  </td>
                  {fields.map((f) => {
                    const raw = r.values[f.id]
                    const display = f.fieldType === 'NUMBER' && raw !== undefined && raw !== '' && !Number.isNaN(Number(raw))
                      ? Number(raw).toLocaleString('en-US')
                      : (raw ?? '')
                    return <td key={f.id} className="px-3 py-1.5 text-gray-600">{display}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button onClick={submit} disabled={rows.length === 0 || submitting}
        className="w-full py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
        <Upload className="w-4 h-4" /> {submitting ? 'Saving…' : `Save "${stage.label}"`}
      </button>
    </div>
  )
}
