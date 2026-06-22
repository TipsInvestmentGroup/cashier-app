'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, DAILY_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import toast from 'react-hot-toast'

type RangeKey = 'today' | 'week' | 'month' | 'custom'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' }, { key: 'custom', label: 'Custom' },
]

interface Outlet { id: string; name: string }
interface StaffRow { id: string; date: string; outlet: string; staffName: string; systemSales: number; collection: number; signed: number; cancellations: number; discount: number; accounted: number; variance: number }
interface CashRow { id: string; date: string; outlet: string; expected: number; verified: number; variance: number }
interface DigitalRow { id: string; date: string; outlet: string; channel: string; reported: number; collected: number; variance: number }
interface ReportData { staff: StaffRow[]; cash: CashRow[]; digital: DigitalRow[] }

function ExcessLossPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const isCashier = user?.role === 'CASHIER'

  const [view, setView] = useState<'excess' | 'loss'>(searchParams.get('view') === 'loss' ? 'loss' : 'excess')
  const [range, setRange] = useState<RangeKey>('today')
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [outletId, setOutletId] = useState('')
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { setView(searchParams.get('view') === 'loss' ? 'loss' : 'excess') }, [searchParams])

  useEffect(() => {
    if (!isCashier) request('/api/outlets').then((o) => setOutlets(o || [])).catch(() => {})
  }, [isCashier, request])

  const interval = (() => {
    const now = new Date()
    switch (range) {
      case 'today': return { start: startOfDay(now), end: endOfDay(now) }
      case 'week': return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
      case 'month': return { start: startOfMonth(now), end: endOfMonth(now) }
      case 'custom': return { start: startOfDay(new Date(customFrom)), end: endOfDay(new Date(customTo)) }
    }
  })()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ startDate: format(interval.start, 'yyyy-MM-dd'), endDate: format(interval.end, 'yyyy-MM-dd') })
      if (!isCashier && outletId) qs.set('outletId', outletId)
      setData(await request(`/api/reports/excess-loss?${qs.toString()}`))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load report')
    } finally { setLoading(false) }
  }, [request, isCashier, outletId, range, customFrom, customTo]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  // Sign filter: excess → variance > 0; loss → variance < 0.
  const keep = (v: number) => (view === 'excess' ? v > 0 : v < 0)
  const staff = (data?.staff || []).filter((r) => keep(r.variance))
  const cash = (data?.cash || []).filter((r) => keep(r.variance))
  const digital = (data?.digital || []).filter((r) => keep(r.variance))
  const abs = (n: number) => Math.abs(n)
  const sum = (arr: { variance: number }[]) => arr.reduce((s, r) => s + abs(r.variance), 0)
  const grandTotal = sum(staff) + sum(cash) + sum(digital)

  const accent = view === 'excess' ? 'green' : 'red'
  const amtClass = view === 'excess' ? 'text-green-700' : 'text-red-700'

  return (
    <AppShell>
      <SectionTabs tabs={DAILY_TABS} />
      <div className="space-y-5">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Cashier {view === 'excess' ? 'Excess' : 'Loss'} Report</h1>
            <p className="text-gray-500 text-sm">Staff variance (collections) + cashier variance (cash & digital reconciliation)</p>
          </div>
          {/* Excess / Loss toggle */}
          <div className="flex gap-2 bg-white border border-gray-200 rounded-xl p-1">
            <button onClick={() => setView('excess')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${view === 'excess' ? 'bg-green-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100'}`}>🔺 Excess</button>
            <button onClick={() => setView('loss')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${view === 'loss' ? 'bg-red-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100'}`}>🔻 Loss</button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-600 mr-1">Period:</span>
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${range === r.key ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{r.label}</button>
          ))}
          {range === 'custom' && (
            <div className="flex items-center gap-2 ml-1">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
              <span className="text-gray-400 text-sm">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
          )}
          {!isCashier && (
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="ml-auto px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
              <option value="">All Outlets</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>

        {/* Grand total */}
        <div className={`rounded-2xl p-5 shadow text-white ${view === 'excess' ? 'bg-gradient-to-br from-green-600 to-green-700' : 'bg-gradient-to-br from-red-600 to-red-700'}`}>
          <p className="text-white/80 text-xs font-medium">Total {view === 'excess' ? 'Excess' : 'Loss'} in period</p>
          <p className="text-3xl font-bold mt-1">{formatCurrency(grandTotal)}</p>
        </div>

        {loading && <div className="py-12 text-center text-gray-400">Loading…</div>}

        {!loading && data && (
          <>
            {/* 1 · Staff variance */}
            <Section title={`1 · Daily Staff ${view === 'excess' ? 'Excess' : 'Loss'}`} subtitle="System sales vs collection + signed bills + cancellations + discount" total={sum(staff)} accent={accent}>
              {staff.length === 0 ? <Empty>No staff {view} in this period</Empty> : (
                <Table head={['Date', 'Outlet', 'Staff', 'System', 'Collection', 'Signed', 'Cancel', 'Discount', 'Accounted', view === 'excess' ? 'Excess' : 'Loss']}
                  rows={staff.map((r) => [formatDate(r.date), r.outlet, r.staffName, formatCurrency(r.systemSales), formatCurrency(r.collection), formatCurrency(r.signed), formatCurrency(r.cancellations), formatCurrency(r.discount), formatCurrency(r.accounted), <span key="v" className={`font-bold ${amtClass}`}>{formatCurrency(abs(r.variance))}</span>])} />
              )}
            </Section>

            {/* 2 · Cashier variance — cash recon */}
            <Section title={`2a · Cashier ${view === 'excess' ? 'Excess' : 'Loss'} — Cash Reconciliation`} subtitle="Verified cash vs expected closing balance" total={sum(cash)} accent={accent}>
              {cash.length === 0 ? <Empty>No cash-recon {view} in this period</Empty> : (
                <Table head={['Date', 'Outlet', 'Expected', 'Verified', view === 'excess' ? 'Excess' : 'Loss']}
                  rows={cash.map((r) => [formatDate(r.date), r.outlet, formatCurrency(r.expected), formatCurrency(r.verified), <span key="v" className={`font-bold ${amtClass}`}>{formatCurrency(abs(r.variance))}</span>])} />
              )}
            </Section>

            {/* 2 · Cashier variance — digital recon */}
            <Section title={`2b · Cashier ${view === 'excess' ? 'Excess' : 'Loss'} — Digital Payment Reconciliation`} subtitle="Collected per channel vs system reported" total={sum(digital)} accent={accent}>
              {digital.length === 0 ? <Empty>No digital-recon {view} in this period</Empty> : (
                <Table head={['Date', 'Outlet', 'Channel', 'Reported', 'Collected', view === 'excess' ? 'Excess' : 'Loss']}
                  rows={digital.map((r) => [formatDate(r.date), r.outlet, r.channel, formatCurrency(r.reported), formatCurrency(r.collected), <span key="v" className={`font-bold ${amtClass}`}>{formatCurrency(abs(r.variance))}</span>])} />
              )}
            </Section>
          </>
        )}
      </div>
    </AppShell>
  )
}

function Section({ title, subtitle, total, accent, children }: { title: string; subtitle: string; total: number; accent: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-semibold text-gray-800">{title}</h2>
          <p className="text-xs text-gray-400">{subtitle}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-bold ${accent === 'green' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{formatCurrency(total)}</span>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50">
        <tr className="text-left text-gray-600">
          {head.map((h, i) => <th key={i} className={`px-4 py-3 font-semibold ${i >= head.length - 1 ? 'text-right' : ''}`}>{h}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {rows.map((r, ri) => (
          <tr key={ri} className="hover:bg-gray-50">
            {r.map((c, ci) => <td key={ci} className={`px-4 py-3 ${ci >= r.length - 1 ? 'text-right' : 'text-gray-700'}`}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-gray-400 text-sm">{children}</p>
}

export default function Page() {
  return (
    <Suspense fallback={<AppShell><div className="py-12 text-center text-gray-400">Loading…</div></AppShell>}>
      <ExcessLossPage />
    </Suspense>
  )
}
