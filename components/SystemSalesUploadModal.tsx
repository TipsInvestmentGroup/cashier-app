'use client'
import { useState, useCallback } from 'react'
import { Upload, X, FileSpreadsheet } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/lib/utils'
import toast from 'react-hot-toast'

interface Row { staffName: string; amount: number }

/** Cashier's daily System Sales import — parses an Excel/CSV of staff → sales
 *  amount and posts it into an already-open TransactionSession, which both
 *  records each staff's expected sales and creates the roster of staff
 *  expected to declare transactions. */
export function SystemSalesUploadModal({ open, onClose, sessionId, onUploaded }: { open: boolean; onClose: () => void; sessionId: string; onUploaded: () => void }) {
  const { request } = useApi()
  const [rows, setRows] = useState<Row[]>([])
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)

  const reset = () => { setRows([]); setFileName('') }

  const onFile = useCallback(async (file: File) => {
    setParsing(true); setFileName(file.name)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

      const STAFF_KEYS = ['attendant', 'staff', 'name', 'waiter', 'server']
      const VAL_KEYS = ['amount', 'sales', 'total', 'value']
      const row = (i: number) => (aoa[i] || []).map((c) => String(c).toLowerCase().trim())

      let hi = -1
      for (let i = 0; i < Math.min(aoa.length, 8); i++) {
        const r = row(i)
        if (r.some((h) => STAFF_KEYS.some((k) => h.includes(k))) && r.some((h) => VAL_KEYS.some((k) => h.includes(k)))) { hi = i; break }
      }
      if (hi < 0) { toast.error('Could not find a header row with a Staff column and a Sales/Amount column.'); reset(); return }

      const headers = row(hi)
      const si = headers.findIndex((h) => STAFF_KEYS.some((k) => h.includes(k)))
      const vi = headers.findIndex((h) => VAL_KEYS.some((k) => h.includes(k)))
      if (si < 0 || vi < 0) { toast.error('Could not find the Staff and Sales columns.'); reset(); return }

      let lastStaff = ''
      const agg = new Map<string, Row>()
      for (const r of aoa.slice(hi + 1)) {
        const raw = String(r[si] ?? '').trim()
        if (raw) lastStaff = raw
        const name = raw || lastStaff
        if (!name || name.toLowerCase() === 'total') continue
        const value = Number(String(r[vi] ?? '').replace(/[, ]/g, '')) || 0
        if (value <= 0) continue
        const key = name.toLowerCase()
        const cur = agg.get(key) || { staffName: name, amount: 0 }
        cur.amount += value
        agg.set(key, cur)
      }
      const grouped = [...agg.values()].sort((a, b) => b.amount - a.amount)
      if (!grouped.length) { toast.error('No valid rows found (need a staff name and a sales amount > 0).'); reset(); return }
      setRows(grouped)
    } catch {
      toast.error('Could not read the file. Use .xlsx or .csv.'); reset()
    } finally { setParsing(false) }
  }, [])

  const save = async () => {
    if (!rows.length) return
    setSaving(true)
    try {
      const r = await request(`/api/transaction-sessions/${sessionId}/system-sales`, { method: 'POST', body: JSON.stringify({ rows }) })
      toast.success(`Imported System Sales for ${r.inserted} staff.`)
      reset(); onUploaded(); onClose()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally { setSaving(false) }
  }

  if (!open) return null
  const total = rows.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><Upload className="w-5 h-5 text-indigo-600" /> Import System Sales</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <label className="block border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-indigo-300 transition">
          <FileSpreadsheet className="w-8 h-8 mx-auto text-gray-400 mb-2" />
          <span className="text-sm text-gray-600 font-medium">{fileName || 'Click to choose an Excel/CSV file'}</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
        </label>
        <p className="text-[11px] text-gray-400 mt-2">Needs a <strong>Staff/Attendant</strong> column and a <strong>Sales/Amount</strong> column — sales made outside MyPOS for the day.</p>

        {parsing && <p className="text-sm text-gray-400 mt-3">Reading file…</p>}
        {rows.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-semibold text-gray-700">{rows.length} staff</span>
              <span className="text-gray-500">Total: <strong>{formatCurrency(total)}</strong></span>
            </div>
            <div className="border border-gray-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 text-gray-600 text-[11px] uppercase tracking-wide sticky top-0">
                  <tr><th className="px-3 py-2 text-left font-semibold">Staff</th><th className="px-3 py-2 text-right font-semibold">Sales</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r, i) => (
                    <tr key={i} className="even:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-800">{r.staffName}</td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatCurrency(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={save} disabled={!rows.length || saving}>{saving ? 'Uploading…' : `Import ${rows.length || ''} rows`}</Button>
        </div>
      </div>
    </div>
  )
}
