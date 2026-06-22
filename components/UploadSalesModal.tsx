'use client'
import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { Upload, X, FileSpreadsheet } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/lib/utils'
import toast from 'react-hot-toast'

interface Outlet { id: string; name: string }
interface Row { date: string; staffName: string; value: number }
type Dataset = 'SHISHA' | 'FOOD'

const DATASETS: { key: Dataset; label: string; outletMatch: string; unit: string }[] = [
  { key: 'SHISHA', label: 'Shisha — Mikocheni', outletMatch: 'mikocheni', unit: 'shisha (count)' },
  { key: 'FOOD', label: 'Food — Coco', outletMatch: 'coco', unit: 'amount (TZS)' },
]

export function UploadSalesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { request } = useApi()
  const [dataset, setDataset] = useState<Dataset>('SHISHA')
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [outletId, setOutletId] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)

  const cfg = DATASETS.find((d) => d.key === dataset)!

  useEffect(() => { if (open) request('/api/outlets').then((o) => setOutlets(o || [])).catch(() => {}) }, [open, request])

  // Auto-pick the matching outlet for the chosen dataset.
  useEffect(() => {
    if (!outlets.length) return
    const match = outlets.find((o) => o.name.toLowerCase().includes(cfg.outletMatch))
    setOutletId(match?.id || outlets[0]?.id || '')
  }, [dataset, outlets]) // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setRows([]); setFileName('') }
  useEffect(() => { reset() }, [dataset])

  const onFile = useCallback(async (file: File) => {
    setParsing(true); setFileName(file.name)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      const headers = (aoa[0] || []).map((h) => String(h).toLowerCase().trim())
      const di = headers.findIndex((h) => h.includes('date'))
      const si = headers.findIndex((h) => h.includes('staff') || h.includes('name') || h.includes('waiter'))
      const vi = headers.findIndex((h) => ['value', 'qty', 'quant', 'amount', 'shisha', 'food', 'sales'].some((k) => h.includes(k)))
      if (di < 0 || si < 0 || vi < 0) { toast.error('Could not find Date / Staff / Value columns in the file.'); reset(); return }
      const toISO = (cell: unknown) => {
        if (cell instanceof Date) return format(cell, 'yyyy-MM-dd')
        const d = new Date(String(cell)); return isNaN(d.getTime()) ? '' : format(d, 'yyyy-MM-dd')
      }
      const parsed = aoa.slice(1).map((r) => ({
        date: toISO(r[di]), staffName: String(r[si] ?? '').trim(), value: Number(String(r[vi] ?? '').replace(/[, ]/g, '')) || 0,
      })).filter((r) => r.date && r.staffName && r.value > 0)
      if (!parsed.length) { toast.error('No valid rows (need date, staff and a value > 0).'); reset(); return }
      setRows(parsed)
    } catch {
      toast.error('Could not read the file. Use .xlsx or .csv.'); reset()
    } finally { setParsing(false) }
  }, [])

  const save = async () => {
    if (!rows.length) return
    if (!outletId) return toast.error('Select the outlet.')
    setSaving(true)
    try {
      const r = await request('/api/sales-metrics', { method: 'POST', body: JSON.stringify({ department: dataset, outletId, rows }) })
      toast.success(`Uploaded ${r.inserted} ${dataset === 'SHISHA' ? 'shisha' : 'food'} sales rows.`)
      reset(); onClose()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally { setSaving(false) }
  }

  if (!open) return null
  const total = rows.reduce((s, r) => s + r.value, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><Upload className="w-5 h-5 text-indigo-600" /> Upload Sales</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        {/* Dataset toggle */}
        <div className="flex gap-2 mb-4">
          {DATASETS.map((d) => (
            <button key={d.key} onClick={() => setDataset(d.key)}
              className={`flex-1 px-3 py-2 rounded-xl text-sm font-semibold transition ${dataset === d.key ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {d.label}
            </button>
          ))}
        </div>

        {/* Outlet */}
        <label className="block text-xs font-semibold text-gray-600 mb-1">Outlet</label>
        <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
          className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white mb-4">
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>

        {/* File input */}
        <label className="block border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-indigo-300 transition">
          <FileSpreadsheet className="w-8 h-8 mx-auto text-gray-400 mb-2" />
          <span className="text-sm text-gray-600 font-medium">{fileName || 'Click to choose an Excel/CSV file'}</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
        </label>
        <p className="text-[11px] text-gray-400 mt-2">Required columns: <strong>Date</strong>, <strong>Staff</strong>, <strong>{dataset === 'SHISHA' ? 'Quantity' : 'Amount'}</strong> ({cfg.unit}).</p>

        {/* Preview */}
        {parsing && <p className="text-sm text-gray-400 mt-3">Reading file…</p>}
        {rows.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-semibold text-gray-700">{rows.length} rows</span>
              <span className="text-gray-500">Total: <strong>{dataset === 'FOOD' ? formatCurrency(total) : `${total.toLocaleString()} shisha`}</strong></span>
            </div>
            <div className="border border-gray-100 rounded-xl overflow-hidden max-h-40 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500"><tr><th className="px-2 py-1.5 text-left">Date</th><th className="px-2 py-1.5 text-left">Staff</th><th className="px-2 py-1.5 text-right">{dataset === 'SHISHA' ? 'Qty' : 'Amount'}</th></tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.slice(0, 8).map((r, i) => (
                    <tr key={i}><td className="px-2 py-1.5">{r.date}</td><td className="px-2 py-1.5">{r.staffName}</td><td className="px-2 py-1.5 text-right">{dataset === 'FOOD' ? formatCurrency(r.value) : r.value}</td></tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 8 && <p className="text-[11px] text-gray-400 text-center py-1">+ {rows.length - 8} more</p>}
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={save} disabled={!rows.length || saving}>{saving ? 'Uploading…' : `Upload ${rows.length || ''} rows`}</Button>
        </div>
      </div>
    </div>
  )
}
