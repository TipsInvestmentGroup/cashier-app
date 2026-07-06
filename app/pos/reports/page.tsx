'use client'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { ExportBar } from '@/components/ExportBar'
import { useApi } from '@/hooks/useApi'
import { RangeKey, getRangeInterval } from '@/lib/dateRange'

// ---- Shared types for the various report response shapes ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

interface Outlet { id: string; name: string }
interface Shift { id: string; name: string; date: string }
interface StaffOption { id: string; name: string; role: string }
interface Counter { code: string; label: string }
interface Product { id: string; name: string; category: string | null }

type Section = 'Sales' | 'Operations' | 'Credit' | 'Summary'

interface Column { key: string; label: string; align?: 'right'; format?: (v: unknown, row: Row) => string }

interface TabConfig {
  key: string
  label: string
  section: Section
  columns: Column[]
  defaultSortKey?: string
  defaultSortDir?: 'asc' | 'desc'
  isSummary?: boolean // renders as cards, not a table (Gross Sales Summary)
}

const money = (v: unknown) => `TSh ${Number(v ?? 0).toLocaleString()}`
const num = (v: unknown) => Number(v ?? 0).toLocaleString()
const dateStr = (v: unknown) => (v ? new Date(v as string).toLocaleString('sw-TZ') : '')

const SALES_COLUMNS: Column[] = [
  { key: 'label', label: 'Jina' },
  { key: 'quantity', label: 'Idadi', align: 'right', format: num },
  { key: 'revenue', label: 'Mauzo', align: 'right', format: money },
  { key: 'billCount', label: 'Bili', align: 'right', format: num },
]

const TABS: TabConfig[] = [
  { key: 'staff-incl', label: 'Staff Sales (na Signed)', section: 'Sales', columns: SALES_COLUMNS, defaultSortKey: 'revenue', defaultSortDir: 'desc' },
  { key: 'staff-excl', label: 'Staff Sales (bila Signed)', section: 'Sales', columns: SALES_COLUMNS, defaultSortKey: 'revenue', defaultSortDir: 'desc' },
  { key: 'product', label: 'Product Sales', section: 'Sales', columns: SALES_COLUMNS, defaultSortKey: 'revenue', defaultSortDir: 'desc' },
  { key: 'category', label: 'Category Sales', section: 'Sales', columns: SALES_COLUMNS, defaultSortKey: 'revenue', defaultSortDir: 'desc' },
  { key: 'payment', label: 'Payment Method', section: 'Sales', columns: SALES_COLUMNS, defaultSortKey: 'revenue', defaultSortDir: 'desc' },
  { key: 'counter', label: 'Counter Performance', section: 'Sales', columns: SALES_COLUMNS, defaultSortKey: 'revenue', defaultSortDir: 'desc' },
  { key: 'hourly', label: 'Hourly Sales', section: 'Sales', columns: SALES_COLUMNS, defaultSortKey: 'label', defaultSortDir: 'asc' },
  { key: 'top', label: 'Top Sellers', section: 'Sales', columns: SALES_COLUMNS, defaultSortKey: 'quantity', defaultSortDir: 'desc' },
  { key: 'slow', label: 'Slow Movers', section: 'Sales', columns: SALES_COLUMNS, defaultSortKey: 'quantity', defaultSortDir: 'asc' },
  {
    key: 'cancelled', label: 'Cancelled/Void', section: 'Operations', defaultSortKey: 'date', defaultSortDir: 'desc',
    columns: [
      { key: 'date', label: 'Tarehe', format: dateStr },
      { key: 'type', label: 'Aina' },
      { key: 'staffName', label: 'Staff' },
      { key: 'productName', label: 'Bidhaa', format: (v) => (v as string) ?? '—' },
      { key: 'amount', label: 'Thamani', align: 'right', format: money },
      { key: 'reason', label: 'Sababu', format: (v) => (v as string) || '—' },
    ],
  },
  {
    key: 'discounts', label: 'Discounts', section: 'Operations', defaultSortKey: 'date', defaultSortDir: 'desc',
    columns: [
      { key: 'date', label: 'Tarehe', format: dateStr },
      { key: 'orderNo', label: 'Order' },
      { key: 'staffName', label: 'Staff' },
      { key: 'amount', label: 'Punguzo', align: 'right', format: money },
      { key: 'percentage', label: '%', align: 'right', format: (v) => `${v}%` },
      { key: 'reason', label: 'Sababu', format: (v) => (v as string) || '—' },
    ],
  },
  {
    key: 'signed', label: 'Signed Bills', section: 'Credit', defaultSortKey: 'date', defaultSortDir: 'desc',
    columns: [
      { key: 'date', label: 'Tarehe', format: dateStr },
      { key: 'orderNo', label: 'Order' },
      { key: 'staffName', label: 'Staff' },
      { key: 'total', label: 'Jumla', align: 'right', format: money },
      { key: 'paid', label: 'Imelipwa', align: 'right', format: money },
      { key: 'balance', label: 'Baki', align: 'right', format: money },
      { key: 'status', label: 'Hali' },
      { key: 'agingDays', label: 'Siku', align: 'right', format: num },
    ],
  },
  {
    key: 'signed-outstanding', label: 'Outstanding Signed', section: 'Credit', defaultSortKey: 'agingDays', defaultSortDir: 'desc',
    columns: [
      { key: 'date', label: 'Tarehe', format: dateStr },
      { key: 'orderNo', label: 'Order' },
      { key: 'staffName', label: 'Staff' },
      { key: 'total', label: 'Jumla', align: 'right', format: money },
      { key: 'paid', label: 'Imelipwa', align: 'right', format: money },
      { key: 'balance', label: 'Baki', align: 'right', format: money },
      { key: 'status', label: 'Hali' },
      { key: 'agingDays', label: 'Siku', align: 'right', format: num },
    ],
  },
  { key: 'summary', label: 'Gross Sales Summary', section: 'Summary', columns: [], isSummary: true },
  {
    key: 'staff-perf', label: 'Staff Performance', section: 'Summary', defaultSortKey: 'totalSales', defaultSortDir: 'desc',
    columns: [
      { key: 'label', label: 'Staff' },
      { key: 'totalSales', label: 'Mauzo', align: 'right', format: money },
      { key: 'billCount', label: 'Bili', align: 'right', format: num },
      { key: 'avgBillValue', label: 'Wastani/Bili', align: 'right', format: money },
      { key: 'quantitySold', label: 'Idadi', align: 'right', format: num },
      { key: 'signedTotal', label: 'Signed', align: 'right', format: money },
      { key: 'voidedCount', label: 'Void', align: 'right', format: num },
      { key: 'discountTotal', label: 'Punguzo', align: 'right', format: money },
    ],
  },
]

const SECTIONS: Section[] = ['Sales', 'Operations', 'Credit', 'Summary']
const PAYMENT_METHODS = ['CASH', 'CRDB', 'STANBIC', 'MPESA', 'SIGNED']

function endpointFor(tabKey: string, params: URLSearchParams): string {
  const qs = params.toString()
  switch (tabKey) {
    case 'staff-incl': return `/api/pos/reports/sales?groupBy=staff&${qs}`
    case 'staff-excl': return `/api/pos/reports/sales?groupBy=staff&includeSigned=false&${qs}`
    case 'product': return `/api/pos/reports/sales?groupBy=product&${qs}`
    case 'category': return `/api/pos/reports/sales?groupBy=category&${qs}`
    case 'payment': return `/api/pos/reports/sales?groupBy=paymentMethod&${qs}`
    case 'counter': return `/api/pos/reports/sales?groupBy=counter&${qs}`
    case 'hourly': return `/api/pos/reports/sales?groupBy=hour&${qs}`
    case 'top': return `/api/pos/reports/sales?groupBy=product&${qs}`
    case 'slow': return `/api/pos/reports/sales?groupBy=product&${qs}`
    case 'cancelled': return `/api/pos/reports/cancelled?${qs}`
    case 'discounts': return `/api/pos/reports/discounts?${qs}`
    case 'signed': return `/api/pos/reports/signed-bills?${qs}`
    case 'signed-outstanding': return `/api/pos/reports/signed-bills?outstandingOnly=true&${qs}`
    case 'summary': return `/api/pos/reports/summary?${qs}`
    case 'staff-perf': return `/api/pos/reports/staff-performance?${qs}`
    default: return ''
  }
}

function useSortableRows(rows: Row[], defaultKey?: string, defaultDir: 'asc' | 'desc' = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultDir)
  useEffect(() => { setSortKey(defaultKey); setSortDir(defaultDir) }, [defaultKey, defaultDir])

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    return [...rows].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey]
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir])

  const toggleSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }
  return { sorted, sortKey, sortDir, toggleSort }
}

export default function PosReportsPage() {
  const { request } = useApi()

  // ---- Shared filter bar state ----
  const [range, setRange] = useState<RangeKey>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [outletId, setOutletId] = useState('')
  const [shiftId, setShiftId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [counterCode, setCounterCode] = useState('')
  const [category, setCategory] = useState('')
  const [productId, setProductId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [search, setSearch] = useState('')

  const [activeTab, setActiveTab] = useState('staff-incl')
  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<Row | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ---- Dropdown option lists ----
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [staff, setStaff] = useState<StaffOption[]>([])
  const [counters, setCounters] = useState<Counter[]>([])
  const [products, setProducts] = useState<Product[]>([])

  useEffect(() => {
    request('/api/outlets').then(setOutlets).catch(() => {})
    request('/api/users').then((users: StaffOption[]) => setStaff(users.filter((u) => u.role === 'WAITER'))).catch(() => {})
  }, [request])

  useEffect(() => {
    if (!outletId) { setShifts([]); setCounters([]); return }
    request(`/api/pos/shifts?outletId=${outletId}&all=true`).then(setShifts).catch(() => {})
    request(`/api/pos/counters?outletId=${outletId}`).then(setCounters).catch(() => {})
  }, [outletId, request])

  useEffect(() => {
    request('/api/pos/products').then((data: { flat: Product[] }) => setProducts(data.flat)).catch(() => {})
  }, [request])

  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].sort(), [products])
  const productsInCategory = useMemo(() => (category ? products.filter((p) => p.category === category) : products), [products, category])

  // ---- Build the query string shared by every report endpoint ----
  const filterParams = useMemo(() => {
    const { start, end } = getRangeInterval(range, customFrom, customTo)
    const p = new URLSearchParams()
    p.set('startDate', start.toISOString())
    p.set('endDate', end.toISOString())
    if (outletId) p.set('outletId', outletId)
    if (shiftId) p.set('shiftId', shiftId)
    if (staffId) p.set('staffId', staffId)
    if (counterCode) p.set('counterCode', counterCode)
    if (productId) p.set('productId', productId)
    else if (category) p.set('category', category)
    if (paymentMethod) p.set('paymentMethod', paymentMethod)
    return p
  }, [range, customFrom, customTo, outletId, shiftId, staffId, counterCode, productId, category, paymentMethod])

  // Guards against an out-of-order response: the very first data fetch fires
  // before AuthContext finishes hydrating the token from localStorage (a
  // 401), and re-fires once the token is ready — but if that first 401
  // happens to resolve AFTER the successful retry, it would otherwise
  // overwrite good data with a stale error. Only the latest invocation's
  // result is ever applied.
  const loadIdRef = useRef(0)
  const load = useCallback(async () => {
    const id = ++loadIdRef.current
    setLoading(true)
    setError('')
    try {
      const url = endpointFor(activeTab, filterParams)
      const data = await request(url)
      if (id !== loadIdRef.current) return
      if (activeTab === 'summary') setSummary(data)
      else setRows(data.rows ?? [])
    } catch (err) {
      if (id !== loadIdRef.current) return
      setError(err instanceof Error ? err.message : 'Imeshindikana kupakia ripoti')
      setRows([]); setSummary(null)
    }
    if (id === loadIdRef.current) setLoading(false)
  }, [activeTab, filterParams, request])

  useEffect(() => { load() }, [load])

  const tab = TABS.find((t) => t.key === activeTab)!

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q)))
  }, [rows, search])

  const { sorted, sortKey, sortDir, toggleSort } = useSortableRows(filteredRows, tab.defaultSortKey, tab.defaultSortDir)

  const exportRows = useMemo(() => sorted.map((r) => {
    const out: Row = {}
    for (const col of tab.columns) out[col.label] = col.format ? col.format(r[col.key], r) : r[col.key]
    return out
  }), [sorted, tab.columns])

  const printReport = () => window.print()

  return (
    <AppShell>
      <SectionTabs tabs={MYPOS_TABS} />
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #pos-report-print, #pos-report-print * { visibility: visible; }
          #pos-report-print { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>
      <div className="max-w-6xl mx-auto">
        <h1 className="text-xl font-bold text-indigo-900 mb-4">MyPOS Reports</h1>

        {/* Filter bar */}
        <div className="space-y-3 mb-4 print:hidden">
          <DateRangeFilter range={range} setRange={setRange} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} />
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap gap-2">
            <select value={outletId} onChange={(e) => { setOutletId(e.target.value); setShiftId(''); setCounterCode('') }} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">Outlet zote</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <select value={shiftId} onChange={(e) => setShiftId(e.target.value)} disabled={!outletId} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none disabled:bg-gray-50">
              <option value="">Shift zote</option>
              {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} — {new Date(s.date).toLocaleDateString('sw-TZ')}</option>)}
            </select>
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">Staff wote</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={counterCode} onChange={(e) => setCounterCode(e.target.value)} disabled={!outletId} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none disabled:bg-gray-50">
              <option value="">Counter zote</option>
              {counters.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setProductId('') }} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">Category zote</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">Bidhaa zote</option>
              {productsInCategory.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">Malipo yote</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        {/* Tab groups */}
        <div className="space-y-2 mb-4 print:hidden">
          {SECTIONS.map((section) => (
            <div key={section} className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-gray-400 uppercase w-20 flex-shrink-0">{section}</span>
              {TABS.filter((t) => t.section === section).map((t) => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${activeTab === t.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Search + export + print */}
        {!tab.isSummary && (
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 print:hidden">
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tafuta..."
              className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm w-56 focus:border-indigo-500 focus:outline-none" />
            <div className="flex items-center gap-2">
              <button onClick={printReport} className="px-3 py-2 bg-gray-800 text-white text-sm rounded-xl hover:bg-gray-900 transition">🖨 Print</button>
              <ExportBar rows={exportRows} filename={`mypos-${activeTab}`} title={tab.label} />
            </div>
          </div>
        )}

        <div id="pos-report-print">
          <h2 className="hidden print:block text-lg font-bold mb-2">{tab.label} — {new Date().toLocaleDateString('sw-TZ')}</h2>

          {loading ? (
            <div className="text-center py-16 text-gray-400">Inapakia...</div>
          ) : error ? (
            <div className="text-center py-16 text-rose-500">{error}</div>
          ) : tab.isSummary ? (
            summary && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <SummaryCard label="Jumla ya Mauzo" value={money(summary.totalSales)} color="indigo" />
                <SummaryCard label="Punguzo" value={money(summary.totalDiscount)} color="rose" />
                <SummaryCard label="Mauzo Halisi (Net)" value={money(summary.netSales)} color="green" />
                <SummaryCard label="Signed Bills" value={money(summary.signedTotal)} color="amber" />
                <SummaryCard label="Idadi ya Bili" value={num(summary.billCount)} color="gray" />
              </div>
            )
          ) : sorted.length === 0 ? (
            <div className="text-center py-16 text-gray-400">Hakuna data kwa vigezo hivi.</div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {tab.columns.map((col) => (
                      <th key={col.key} onClick={() => toggleSort(col.key)}
                        className={`px-4 py-2.5 font-semibold text-gray-600 cursor-pointer select-none whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'}`}>
                        {col.label} {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      {tab.columns.map((col) => (
                        <td key={col.key} className={`px-4 py-2 whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'}`}>
                          {col.format ? col.format(row[col.key], row) : String(row[col.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-700', rose: 'bg-rose-50 text-rose-700', green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-700', gray: 'bg-gray-50 text-gray-700',
  }
  return (
    <div className={`rounded-2xl p-4 ${colors[color]}`}>
      <p className="text-xs font-semibold opacity-70 mb-1">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  )
}
