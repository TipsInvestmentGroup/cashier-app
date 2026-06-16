'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

interface Outlet { id: string; name: string }

interface ReportData {
  date: string
  outletName: string
  generatedBy: string
  collection: { systemSales: number; cash: number; crdb: number; stanbic: number; mpesa: number; total: number; variance: number }
  signed: { byType: Record<string, number>; rows: { type: string; name: string; staff: string; amount: number }[]; total: number }
  paid: { byMethod: Record<string, number>; rows: { name: string; category: string; method: string; amount: number }[]; total: number; cash: number }
  cancellations: { rows: { product: string; staff: string; qty: number; amount: number; reason: string }[]; total: number }
  pettyCash: { rows: { purpose: string; by: string; dept: string; method: string; amount: number; status: string }[]; total: number; approved: number }
  cashInHand: number
}

const SIGNED_LABELS: Record<string, string> = {
  ADMIN: 'Admin', DIRECTOR: 'Director', CUSTOMER: 'Customer', TIPS: 'Tips', DJ: 'DJ', STAFF_LOSS: 'Staff Loss',
}

export default function DailyReportPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [outletId, setOutletId] = useState('')
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)

  const isCashier = user?.role === 'CASHIER'

  useEffect(() => {
    if (!isCashier) request('/api/outlets').then((o) => setOutlets(o || [])).catch(() => {})
  }, [isCashier, request])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ date })
      if (!isCashier && outletId) qs.set('outletId', outletId)
      const r = await request(`/api/reports/daily-report?${qs.toString()}`)
      setData(r)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load report')
    } finally { setLoading(false) }
  }, [date, outletId, isCashier, request])

  useEffect(() => { load() }, [load])

  const money = (n: number) => formatCurrency(n)
  const prettyDate = data ? format(new Date(data.date), 'EEEE, dd MMMM yyyy') : ''

  return (
    <AppShell>
      <div className="space-y-5">
        {/* Controls (hidden when printing) */}
        <div className="no-print flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Cashier Daily Report</h1>
            <p className="text-gray-500 text-sm">Download a one-page summary to share with directors.</p>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
            </div>
            {!isCashier && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Outlet</label>
                <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
                  className="px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                  <option value="">All Outlets</option>
                  {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            )}
            <button onClick={() => window.print()} disabled={!data}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow disabled:opacity-50">
              📥 Download / Print
            </button>
          </div>
        </div>

        <p className="no-print text-xs text-gray-400">
          Tip: click <b>Download / Print</b> → choose <b>“Save as PDF”</b>, then share the PDF in the WhatsApp group.
        </p>

        {loading && <div className="py-16 text-center text-gray-400">Loading report…</div>}

        {/* The printable report */}
        {data && !loading && (
          <div className="print-area bg-white rounded-2xl shadow-sm border border-gray-200 p-6 md:p-8 max-w-3xl mx-auto">
            {/* Header */}
            <div className="text-center border-b-2 border-gray-200 pb-4 mb-5">
              <div className="text-3xl font-extrabold tracking-wide text-gray-900">tips</div>
              <h2 className="text-lg font-bold text-gray-800 mt-1">Cashier Sales Report — {data.outletName}</h2>
              <p className="text-gray-500 text-sm">{prettyDate}</p>
            </div>

            {/* Collection */}
            <Section title="1 · Collection (Sales)">
              <Row label="System Sales" value={money(data.collection.systemSales)} bold />
              <Row label="Cash" value={money(data.collection.cash)} />
              <Row label="Lipa Hapa — CRDB" value={money(data.collection.crdb)} />
              <Row label="Stanbic" value={money(data.collection.stanbic)} />
              <Row label="M-PESA" value={money(data.collection.mpesa)} />
              <Row label="Total Collected" value={money(data.collection.total)} bold accent />
              <Row label="Variance (Collected − System)"
                value={money(data.collection.variance)}
                valueClass={data.collection.variance < 0 ? 'text-red-600' : data.collection.variance > 0 ? 'text-green-600' : ''} />
            </Section>

            {/* Signed bills */}
            <Section title="2 · Signed Bills (credit given)">
              {data.signed.rows.length === 0 ? (
                <Empty>No signed bills</Empty>
              ) : (
                <>
                  <MiniTable
                    head={['Type', 'Name', 'Staff', 'Amount']}
                    rows={data.signed.rows.map((r) => [SIGNED_LABELS[r.type] || r.type, r.name, r.staff, money(r.amount)])}
                  />
                  <Row label="Total Signed Bills" value={money(data.signed.total)} bold accent />
                </>
              )}
            </Section>

            {/* Paid bills */}
            <Section title="3 · Paid Bills (debts collected)">
              {data.paid.rows.length === 0 ? (
                <Empty>No paid bills</Empty>
              ) : (
                <>
                  <MiniTable
                    head={['Payer', 'Category', 'Method', 'Amount']}
                    rows={data.paid.rows.map((r) => [r.name, r.category, r.method, money(r.amount)])}
                  />
                  <Row label="Total Paid Bills" value={money(data.paid.total)} bold accent />
                </>
              )}
            </Section>

            {/* Cancellations */}
            <Section title="4 · Cancellations">
              {data.cancellations.rows.length === 0 ? (
                <Empty>No cancellations</Empty>
              ) : (
                <>
                  <MiniTable
                    head={['Product', 'Staff', 'Qty', 'Amount']}
                    rows={data.cancellations.rows.map((r) => [r.product, r.staff, String(r.qty), money(r.amount)])}
                  />
                  <Row label="Total Cancellations" value={money(data.cancellations.total)} bold accent />
                </>
              )}
            </Section>

            {/* Petty cash */}
            <Section title="5 · Petty Cash / Expenses">
              {data.pettyCash.rows.length === 0 ? (
                <Empty>No petty cash</Empty>
              ) : (
                <>
                  <MiniTable
                    head={['Purpose', 'Requested By', 'Status', 'Amount']}
                    rows={data.pettyCash.rows.map((r) => [r.purpose, r.by, r.status, money(r.amount)])}
                  />
                  <Row label="Total Petty Cash" value={money(data.pettyCash.total)} bold accent />
                  <Row label="Approved & Paid Out" value={money(data.pettyCash.approved)} />
                </>
              )}
            </Section>

            {/* Cash in hand */}
            <div className="mt-6 rounded-xl bg-indigo-50 border-2 border-indigo-200 p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-indigo-900">Cash in Hand</p>
                <p className="text-xs text-indigo-500">Cash collected + cash debts − approved petty cash</p>
              </div>
              <p className="text-2xl font-extrabold text-indigo-700">{money(data.cashInHand)}</p>
            </div>

            <p className="text-center text-xs text-gray-400 mt-6">
              Generated by {data.generatedBy || '—'} · {format(new Date(), 'dd MMM yyyy HH:mm')} · tips Cashier Management
            </p>
          </div>
        )}
      </div>
    </AppShell>
  )
}

/* ---------- small presentational helpers ---------- */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-sm font-bold uppercase tracking-wide text-indigo-700 border-b border-gray-200 pb-1 mb-2">{title}</h3>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function Row({ label, value, bold, accent, valueClass = '' }: { label: string; value: string; bold?: boolean; accent?: boolean; valueClass?: string }) {
  return (
    <div className={`flex items-center justify-between py-1 text-sm ${accent ? 'bg-yellow-50 px-2 rounded' : ''}`}>
      <span className={`${bold ? 'font-bold text-gray-900' : 'text-gray-600'}`}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-bold text-gray-900' : 'text-gray-800'} ${valueClass}`}>{value}</span>
    </div>
  )
}

function MiniTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full text-xs mb-1">
      <thead>
        <tr className="text-left text-gray-500 border-b border-gray-200">
          {head.map((h, i) => <th key={i} className={`py-1 font-semibold ${i === head.length - 1 ? 'text-right' : ''}`}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-gray-50">
            {r.map((c, ci) => <td key={ci} className={`py-1 ${ci === r.length - 1 ? 'text-right tabular-nums font-medium text-gray-800' : 'text-gray-600'}`}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-400 italic py-1">{children}</p>
}
