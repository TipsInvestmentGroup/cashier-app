'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatDateTime } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { parsePaymentImportFile, type ParseResult } from '@/lib/payment-import-parser'
import toast from 'react-hot-toast'

interface Connector {
  id: string
  name: string
  kind: string
  channel: string
  isActive: boolean
  lastSyncAt: string | null
  createdAt: string
}

const KINDS = [
  { value: 'API_WEBHOOK', label: 'API / Webhook' },
  { value: 'FILE_IMPORT', label: 'File Import' },
]

export default function PaymentIntegrationConnectorsPage() {
  const { request } = useApi()
  const [items, setItems] = useState<Connector[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', kind: 'API_WEBHOOK', channel: '' })
  const [submitting, setSubmitting] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [importTarget, setImportTarget] = useState<Connector | null>(null)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await request('/api/payment-integration-connectors')
      setItems(r.connectors || [])
    } catch { /* surfaced by interceptor */ } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const submit = async () => {
    if (!form.name || !form.channel) return toast.error('Name and channel are required')
    setSubmitting(true)
    try {
      await request('/api/payment-integration-connectors', { method: 'POST', body: JSON.stringify(form) })
      toast.success('Connector added')
      setShowForm(false)
      setForm({ name: '', kind: 'API_WEBHOOK', channel: '' })
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not add connector')
    } finally { setSubmitting(false) }
  }

  const toggle = async (c: Connector) => {
    setTogglingId(c.id)
    try {
      await request(`/api/payment-integration-connectors/${c.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !c.isActive }) })
      toast.success(c.isActive ? 'Disabled' : 'Enabled')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not update')
    } finally { setTogglingId(null) }
  }

  const openImport = (c: Connector) => {
    setImportTarget(c)
    setParseResult(null)
  }

  const onFileSelected = async (file: File | undefined) => {
    if (!file) return
    setParsing(true)
    try {
      const result = await parsePaymentImportFile(file)
      setParseResult(result)
      if (!result.rows.length) toast.error('No usable rows found — check the file has Date and Amount columns')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not read this file')
    } finally { setParsing(false) }
  }

  const submitImport = async () => {
    if (!importTarget || !parseResult?.rows.length) return
    setImporting(true)
    try {
      const r = await request(`/api/payment-integration-connectors/${importTarget.id}/import`, {
        method: 'POST',
        body: JSON.stringify({ rows: parseResult.rows }),
      })
      toast.success(`Imported ${r.imported} payment(s)`)
      setImportTarget(null); setParseResult(null)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not import')
    } finally { setImporting(false) }
  }

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="max-w-2xl space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Payment Integration Connectors</h1>
            <p className="text-gray-500 text-sm">Adapter framework for Payment Verification sources — bank/MoMo/gateway webhooks and file imports. Phase 1 already covers Cash, Bank, and POS internally; add a connector here when a real external integration is ready.</p>
          </div>
          <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 whitespace-nowrap">Add Connector</button>
        </div>

        <Card className="p-0 overflow-hidden">
          {loading ? (
            <div className="p-5 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : items.length === 0 ? (
            <EmptyState icon="🔌" title="No connectors configured" hint="Add one to wire up a real bank/MoMo/gateway integration." />
          ) : (
            <div className="divide-y divide-gray-50">
              {items.map((c) => (
                <div key={c.id} className="p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{c.name}</p>
                    <p className="text-xs text-gray-400">
                      {KINDS.find((k) => k.value === c.kind)?.label || c.kind} · {c.channel}
                      {c.lastSyncAt && <span> · last synced {formatDateTime(c.lastSyncAt)}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {c.kind === 'FILE_IMPORT' && (
                      <button onClick={() => openImport(c)} className="px-3 py-1.5 text-xs font-semibold bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100">Import File</button>
                    )}
                    <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                      <input type="checkbox" checked={c.isActive} disabled={togglingId === c.id} onChange={() => toggle(c)} className="w-4 h-4 rounded" />
                      {c.isActive ? 'Active' : 'Disabled'}
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Add Connector">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. CRDB Bank Webhook"
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Kind</label>
            <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm bg-white focus:border-indigo-500 focus:outline-none">
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Channel Code</label>
            <input value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))} placeholder="e.g. CRDB, STANBIC, MPESA"
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
          <button disabled={submitting} onClick={submit} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-60">
            {submitting ? 'Saving…' : 'Add Connector'}
          </button>
        </div>
      </Modal>

      <Modal open={!!importTarget} onClose={() => { setImportTarget(null); setParseResult(null) }} title={`Import File — ${importTarget?.name || ''}`}>
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Upload an .xlsx or .csv bank/MoMo statement. Columns are auto-detected — Date, Amount, and (optionally) Reference/Customer.
            Every row is recorded against the <span className="font-semibold">{importTarget?.channel}</span> channel.
          </p>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => onFileSelected(e.target.files?.[0])}
            className="w-full text-sm file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 file:text-xs file:font-semibold hover:file:bg-indigo-100" />

          {parsing && <p className="text-xs text-gray-400">Reading file…</p>}

          {parseResult && (
            <div className="rounded-xl border border-gray-200 p-3 space-y-2">
              <p className="text-xs text-gray-600">
                Detected columns — Date: <span className="font-semibold">{parseResult.detectedColumns.date || 'not found'}</span>,
                {' '}Amount: <span className="font-semibold">{parseResult.detectedColumns.amount || 'not found'}</span>,
                {' '}Reference: <span className="font-semibold">{parseResult.detectedColumns.reference || '—'}</span>,
                {' '}Customer: <span className="font-semibold">{parseResult.detectedColumns.customerName || '—'}</span>
              </p>
              <p className="text-sm font-semibold text-gray-800">
                {parseResult.rows.length} of {parseResult.totalRows} row(s) ready to import
                {parseResult.skipped.length > 0 && <span className="text-amber-600 font-normal"> — {parseResult.skipped.length} skipped</span>}
              </p>
              {parseResult.rows.slice(0, 3).map((r, i) => (
                <p key={i} className="text-xs text-gray-500">{r.date.slice(0, 10)} · {r.amount.toLocaleString()} {r.reference ? `· ${r.reference}` : ''} {r.customerName ? `· ${r.customerName}` : ''}</p>
              ))}
            </div>
          )}

          <button disabled={importing || !parseResult?.rows.length} onClick={submitImport}
            className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-40">
            {importing ? 'Importing…' : `Import ${parseResult?.rows.length || 0} Row(s)`}
          </button>
        </div>
      </Modal>
    </AppShell>
  )
}
