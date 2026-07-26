'use client'
import { useState, useEffect, useCallback } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { format } from 'date-fns'
import { RangeKey, RANGE_OPTIONS, getRangeInterval } from '@/lib/dateRange'
import { SearchBox } from '@/components/SearchBox'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import toast from 'react-hot-toast'

interface Outlet { id: string; name: string }

// Row/totals shape varies by `groupBy` (staff/outlet share one shape; customer
// and admin/director each have their own) — modelled as one permissive shape
// rather than a discriminated union, since call sites branch on `groupBy`
// (not a `kind` field) to know which fields are populated.
// `paid` is a per-channel Record (with a `total`) for staff/outlet rows, but a
// plain number for customer rows — narrowed via `paidBreakdown`/`paidAmount`
// helpers below rather than a single static type.
type PaidBreakdown = Record<string, number> & { total?: number }
interface ReportRow {
  name?: string; staffName?: string; outletName?: string
  systemSales?: number; cash?: number; crdb?: number; stanbic?: number; mpesa?: number; total?: number
  signed?: PaidBreakdown; paid?: PaidBreakdown | number
  netCollection?: number
  debt?: number; unpaid?: number
  spent?: number; creditLimit?: number; deduction?: number
}
const paidBreakdown = (r: ReportRow): PaidBreakdown => (typeof r.paid === 'object' && r.paid ? r.paid : {})
const paidAmount = (r: ReportRow): number => (typeof r.paid === 'number' ? r.paid : r.paid?.total ?? 0)
interface ReportTotals {
  systemSales?: number; cash?: number; crdb?: number; stanbic?: number; mpesa?: number; total?: number
  signedTotal?: number; paidTotal?: number; netCollection?: number
  debt?: number; paid?: number; unpaid?: number
  spent?: number; creditLimit?: number; deduction?: number
}
interface ReportData {
  from: string; to: string; rows: ReportRow[]; totals: ReportTotals
  signedKeys: string[]; paidKeys: string[]
}

// Per-staff/customer/admin/director day-by-day breakdown shown in the detail modal.
interface DetailRow {
  date: string; serviceStaff?: string
  debt?: number; paid?: number; outstanding?: number
  spent?: number; creditLimit?: number; exceeded?: number
  system?: number; collection?: number; signed?: number; difference?: number; net?: number
}
interface DetailTotals {
  debt?: number; paid?: number; outstanding?: number
  spent?: number; creditLimit?: number; exceeded?: number
  system?: number; collection?: number; signed?: number; difference?: number; net?: number
}
interface DetailData { kind?: string; rows: DetailRow[]; totals: DetailTotals }

const SIGNED_LABELS: Record<string, string> = { ADMIN: 'Admin', DIRECTOR: 'Director', CUSTOMER: 'Customer', TIPS: 'Tips', DJ: 'DJ', STAFF_LOSS: 'Staff Loss' }
const PAID_LABELS: Record<string, string> = { ADMIN: 'Admin', DIRECTOR: 'Director', CUSTOMER: 'Customer', STAFF_LOSS: 'Staff Loss', OTHER: 'Other' }

export function DailyCashierReport({ outlets, request }: { outlets: Outlet[]; request: (url: string, opts?: RequestInit) => Promise<unknown> }) {
  const [range, setRange] = useState<RangeKey>('today')
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [outletId, setOutletId] = useState('')
  const [groupBy, setGroupBy] = useState<'staff' | 'outlet' | 'customer' | 'admin' | 'director'>('staff')
  const peopleGroup = groupBy === 'customer' || groupBy === 'admin' || groupBy === 'director'
  const [search, setSearch] = useState('')
  // Detail modal
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)

  const interval = getRangeInterval(range, customFrom, customTo)
  const from = format(interval.start, 'yyyy-MM-dd')
  const to = format(interval.end, 'yyyy-MM-dd')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to, groupBy })
      if (outletId) params.set('outletId', outletId)
      setData((await request(`/api/reports/daily-cashier?${params}`)) as ReportData)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error loading report')
    } finally {
      setLoading(false)
    }
  }, [request, from, to, outletId, groupBy])

  useEffect(() => { load() }, [load])

  const signedKeys: string[] = data?.signedKeys || []
  const paidKeys: string[] = (data?.paidKeys || []).filter((k: string) => k !== 'OTHER')
  const q = search.trim().toLowerCase()
  const visibleRows = (data?.rows || []).filter((r) => !q || String(r.staffName ?? r.name ?? '').toLowerCase().includes(q))

  const openDetail = async (key: string) => {
    setDetailKey(key); setDetail(null); setDetailLoading(true)
    try {
      const params = new URLSearchParams({ from, to, groupBy, key })
      if (outletId) params.set('outletId', outletId)
      setDetail((await request(`/api/reports/daily-cashier/detail?${params}`)) as DetailData)
    } catch {
      toast.error('Could not load details')
    } finally {
      setDetailLoading(false)
    }
  }

  const downloadDetail = () => {
    if (!detail || !detail.rows.length) return toast.error('No data to download')
    const k = detail.kind
    let header: string[]
    let body: (string | number)[][]
    if (k === 'customer') {
      header = ['Date', 'Debt', 'Paid', 'Outstanding', 'Service Staff']
      body = detail.rows.map((r) => [r.date, r.debt ?? 0, r.paid ?? 0, r.outstanding ?? 0, r.serviceStaff ?? ''])
    } else if (k === 'admin' || k === 'director') {
      header = ['Date', 'Signed Amount', 'Credit Limit', 'Exceeded', 'Service Staff']
      body = detail.rows.map((r) => [r.date, r.spent ?? 0, r.creditLimit ?? 0, r.exceeded ?? 0, r.serviceStaff ?? ''])
    } else {
      header = ['Date', 'System', 'Collection', 'Signed', 'Paid', 'Shortage', 'Net']
      body = detail.rows.map((r) => [r.date, r.system ?? 0, r.collection ?? 0, r.signed ?? 0, r.paid ?? 0, r.difference ?? 0, r.net ?? 0])
    }
    const csv = [header, ...body].map((row) => row.map((v) => `"${v}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = `${detailKey}-${from}_to_${to}.csv`; a.click(); URL.revokeObjectURL(url)
    toast.success('Downloaded')
  }

  const labelHeader = groupBy === 'outlet' ? 'Outlet' : groupBy === 'customer' ? 'Customer'
    : groupBy === 'admin' ? 'Admin' : groupBy === 'director' ? 'Director' : 'Staff'
  const fileBase = `${groupBy}-report-${from}_to_${to}`

  // Shared header + numeric body for all export formats
  const buildTable = () => {
    const rows: ReportRow[] = data?.rows || []
    if (groupBy === 'customer') {
      return { header: ['Customer', 'Debt', 'Paid', 'Unpaid Balance'], body: rows.map((r) => [r.name ?? '', r.debt ?? 0, paidAmount(r), r.unpaid ?? 0] as (string | number)[]) }
    }
    if (peopleGroup) { // admin / director
      return { header: [labelHeader, 'Amount Spent', 'Credit Limit', 'Deduction'], body: rows.map((r) => [r.name ?? '', r.spent ?? 0, r.creditLimit ?? 0, r.deduction ?? 0] as (string | number)[]) }
    }
    const header = [
      labelHeader, 'System Sales', 'Cash', 'CRDB', 'Stanbic', 'M-PESA', 'Collection',
      ...signedKeys.map((k) => `Signed ${SIGNED_LABELS[k]}`), 'Signed Total',
      ...paidKeys.map((k) => `Paid ${PAID_LABELS[k]}`), 'Paid Total', 'Net Collection',
    ]
    const body = rows.map((r) => {
      const paid = paidBreakdown(r)
      return [
        r.staffName ?? '', r.systemSales ?? 0, r.cash ?? 0, r.crdb ?? 0, r.stanbic ?? 0, r.mpesa ?? 0, r.total ?? 0,
        ...signedKeys.map((k) => r.signed?.[k] || 0), r.signed?.total ?? 0,
        ...paidKeys.map((k) => paid[k] || 0), paid.total ?? 0, r.netCollection ?? 0,
      ] as (string | number)[]
    })
    return { header, body }
  }

  const exportCSV = () => {
    if (!data?.rows.length) return toast.error('No data to export')
    const { header, body } = buildTable()
    const csv = [header, ...body].map((row) => row.map((v) => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${fileBase}.csv`
    a.click(); URL.revokeObjectURL(url)
    toast.success('CSV exported!')
  }

  const exportExcel = async () => {
    if (!data?.rows.length) return toast.error('No data to export')
    const XLSX = await import('xlsx')
    const { header, body } = buildTable()
    const ws = XLSX.utils.aoa_to_sheet([header, ...body])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Cashier Report')
    XLSX.writeFile(wb, `${fileBase}.xlsx`)
    toast.success('Excel exported!')
  }

  const exportPDF = async () => {
    if (!data?.rows.length) return toast.error('No data to export')
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const { header, body } = buildTable()
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFontSize(13)
    doc.text('Cashier Report', 14, 14)
    doc.setFontSize(9)
    doc.text(`Period: ${from === to ? from : `${from} to ${to}`}  ·  Grouped by ${labelHeader}`, 14, 20)
    autoTable(doc, {
      startY: 24,
      head: [header],
      body: body.map((row) => row.map((v, i) => (i === 0 ? String(v) : formatCurrency(Number(v))))),
      styles: { fontSize: 6.5, cellPadding: 1.5 },
      headStyles: { fillColor: [79, 70, 229], fontSize: 6.5 },
    })
    doc.save(`${fileBase}.pdf`)
    toast.success('PDF exported!')
  }

  const th = 'px-3 py-2 font-semibold whitespace-nowrap'
  const td = 'px-3 py-2 whitespace-nowrap'

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-600 mr-1">Period:</span>
          {RANGE_OPTIONS.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${range === r.key ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {r.label}
            </button>
          ))}
          {range === 'custom' && (
            <div className="flex items-center gap-2 ml-1">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
              <span className="text-gray-400 text-sm">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Outlet</label>
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
              className="px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm">
              <option value="">All Outlets</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Group by</label>
            <div className="flex gap-1 flex-wrap">
              {(['staff', 'outlet', 'customer', 'admin', 'director'] as const).map((g) => (
                <button key={g} onClick={() => { setGroupBy(g); setSearch('') }}
                  className={`px-3 py-2 rounded-xl text-sm font-medium capitalize transition ${groupBy === g ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          <span className="text-xs text-gray-500">{from === to ? from : `${from} → ${to}`}</span>
          <div className="ml-auto flex gap-2">
            <button onClick={exportCSV} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-xl hover:bg-gray-200 transition">📄 CSV</button>
            <button onClick={exportExcel} className="px-4 py-2 bg-green-600 text-white text-sm rounded-xl hover:bg-green-700 transition">📊 Excel</button>
            <button onClick={exportPDF} className="px-4 py-2 bg-red-600 text-white text-sm rounded-xl hover:bg-red-700 transition">📕 PDF</button>
          </div>
        </div>
      </div>

      {/* Summary cards — staff/outlet */}
      {data && !peopleGroup && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-4 shadow">
            <p className="text-indigo-100 text-xs">Net Collection</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(data.totals.netCollection)}</p>
            <p className="text-indigo-200 text-xs mt-1">{data.rows.length} {labelHeader.toLowerCase()}</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"><p className="text-gray-500 text-xs">🧾 System Sales</p><p className="text-lg font-bold mt-1 text-gray-800">{formatCurrency(data.totals.systemSales)}</p></div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"><p className="text-gray-500 text-xs">💰 Collection</p><p className="text-lg font-bold mt-1 text-gray-800">{formatCurrency(data.totals.total)}</p></div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"><p className="text-gray-500 text-xs">✅ Paid Bills</p><p className="text-lg font-bold mt-1 text-green-700">{formatCurrency(data.totals.paidTotal)}</p></div>
        </div>
      )}

      {/* Summary cards — customer */}
      {data && groupBy === 'customer' && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"><p className="text-gray-500 text-xs">📋 Total Debt</p><p className="text-lg font-bold mt-1 text-gray-800">{formatCurrency(data.totals.debt)}</p></div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"><p className="text-gray-500 text-xs">✅ Paid</p><p className="text-lg font-bold mt-1 text-green-700">{formatCurrency(data.totals.paid)}</p></div>
          <div className="bg-gradient-to-br from-red-500 to-red-600 text-white rounded-2xl p-4 shadow col-span-2 lg:col-span-1"><p className="text-red-100 text-xs">Unpaid Balance</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.totals.unpaid)}</p><p className="text-red-200 text-xs mt-1">{data.rows.length} customers</p></div>
        </div>
      )}

      {/* Summary cards — admin/director */}
      {data && (groupBy === 'admin' || groupBy === 'director') && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"><p className="text-gray-500 text-xs">💳 Amount Spent</p><p className="text-lg font-bold mt-1 text-gray-800">{formatCurrency(data.totals.spent)}</p></div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"><p className="text-gray-500 text-xs">🎯 Total Credit Limit</p><p className="text-lg font-bold mt-1 text-gray-800">{formatCurrency(data.totals.creditLimit)}</p></div>
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-2xl p-4 shadow col-span-2 lg:col-span-1"><p className="text-orange-100 text-xs">Payroll Deduction</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.totals.deduction)}</p><p className="text-orange-200 text-xs mt-1">{data.rows.length} {labelHeader.toLowerCase()}s</p></div>
        </div>
      )}

      {/* Outlet comparison charts (consolidated view) */}
      {groupBy === 'outlet' && data && data.rows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-semibold text-gray-800 mb-4">Net Collection by Outlet</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.rows.map((r) => ({ name: r.staffName, Net: r.netCollection }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: unknown) => formatCurrency(v as number)} />
                <Bar dataKey="Net" fill="#4f46e5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-semibold text-gray-800 mb-4">System Sales vs Collection by Outlet</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.rows.map((r) => ({ name: r.staffName, System: r.systemSales, Collection: r.total }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: unknown) => formatCurrency(v as number)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="System" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Collection" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Search */}
      {data && data.rows.length > 0 && (
        <SearchBox value={search} onChange={setSearch} placeholder={`Search by ${labelHeader.toLowerCase()} name…`} />
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">Generating report…</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No activity for this period.</div>
        ) : peopleGroup ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                {groupBy === 'customer' ? (
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">Customer</th>
                    <th className="px-4 py-3 font-semibold text-right">Debt</th>
                    <th className="px-4 py-3 font-semibold text-right">Paid</th>
                    <th className="px-4 py-3 font-semibold text-right">Unpaid Balance</th>
                  </tr>
                ) : (
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">{labelHeader}</th>
                    <th className="px-4 py-3 font-semibold text-right">Amount Spent</th>
                    <th className="px-4 py-3 font-semibold text-right">Credit Limit</th>
                    <th className="px-4 py-3 font-semibold text-right">Deduction</th>
                  </tr>
                )}
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visibleRows.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-8 text-gray-400">No match for “{search}”.</td></tr>
                )}
                {groupBy === 'customer'
                  ? visibleRows.map((r, i: number) => (
                    <tr key={i} className={`hover:bg-gray-50 ${(r.unpaid ?? 0) > 0 ? 'bg-red-50/40' : ''}`}>
                      <td className="px-4 py-3"><button onClick={() => openDetail(r.name ?? '')} className="font-medium text-indigo-700 hover:underline text-left">{r.name}</button></td>
                      <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(r.debt)}</td>
                      <td className="px-4 py-3 text-right text-green-700">{formatCurrency(paidAmount(r))}</td>
                      <td className={`px-4 py-3 text-right font-bold ${(r.unpaid ?? 0) > 0 ? 'text-red-600' : 'text-gray-500'}`}>{formatCurrency(r.unpaid)}</td>
                    </tr>
                  ))
                  : visibleRows.map((r, i: number) => (
                    <tr key={i} className={`hover:bg-gray-50 ${(r.deduction ?? 0) > 0 ? 'bg-red-50/40' : ''}`}>
                      <td className="px-4 py-3"><button onClick={() => openDetail(r.name ?? '')} className="font-medium text-indigo-700 hover:underline text-left">{r.name}</button></td>
                      <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(r.spent)}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(r.creditLimit)}</td>
                      <td className={`px-4 py-3 text-right font-bold ${(r.deduction ?? 0) > 0 ? 'text-red-600' : 'text-gray-400'}`}>{(r.deduction ?? 0) > 0 ? formatCurrency(r.deduction) : '-'}</td>
                    </tr>
                  ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-bold text-gray-900">
                {groupBy === 'customer' ? (
                  <tr>
                    <td className="px-4 py-3">TOTAL</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(data.totals.debt)}</td>
                    <td className="px-4 py-3 text-right text-green-700">{formatCurrency(data.totals.paid)}</td>
                    <td className="px-4 py-3 text-right text-red-700">{formatCurrency(data.totals.unpaid)}</td>
                  </tr>
                ) : (
                  <tr>
                    <td className="px-4 py-3">TOTAL</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(data.totals.spent)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(data.totals.creditLimit)}</td>
                    <td className="px-4 py-3 text-right text-orange-700">{formatCurrency(data.totals.deduction)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-100 text-gray-600 text-left">
                  <th className={th} rowSpan={2}>{labelHeader}</th>
                  <th className={th} rowSpan={2}>System Sales</th>
                  <th className={`${th} text-center bg-blue-50`} colSpan={5}>Collection</th>
                  <th className={`${th} text-center bg-amber-50`} colSpan={signedKeys.length + 1}>Signed Bills</th>
                  <th className={`${th} text-center bg-green-50`} colSpan={paidKeys.length + 1}>Paid Bills</th>
                  <th className={`${th} bg-indigo-50`} rowSpan={2}>Net Collection</th>
                </tr>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className={th}>Cash</th><th className={th}>CRDB</th><th className={th}>Stanbic</th><th className={th}>M-PESA</th><th className={th}>Total</th>
                  {signedKeys.map((k) => <th key={k} className={th}>{SIGNED_LABELS[k]}</th>)}
                  <th className={th}>Total</th>
                  {paidKeys.map((k) => <th key={k} className={th}>{PAID_LABELS[k]}</th>)}
                  <th className={th}>Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visibleRows.length === 0 && (
                  <tr><td colSpan={9 + signedKeys.length + paidKeys.length} className="text-center py-8 text-gray-400">No match for “{search}”.</td></tr>
                )}
                {visibleRows.map((r, i: number) => {
                  const paid = paidBreakdown(r)
                  return (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className={td}>
                      <button onClick={() => openDetail(r.staffName ?? '')}
                        className="font-medium text-indigo-700 hover:underline text-left">{r.staffName}</button>
                    </td>
                    <td className={td}>{formatCurrency(r.systemSales)}</td>
                    <td className={`${td} text-green-700`}>{formatCurrency(r.cash)}</td>
                    <td className={`${td} text-blue-700`}>{formatCurrency(r.crdb)}</td>
                    <td className={`${td} text-purple-700`}>{formatCurrency(r.stanbic)}</td>
                    <td className={`${td} text-yellow-700`}>{formatCurrency(r.mpesa)}</td>
                    <td className={`${td} font-bold`}>{formatCurrency(r.total)}</td>
                    {signedKeys.map((k) => <td key={k} className={td}>{r.signed?.[k] ? formatCurrency(r.signed[k]) : '-'}</td>)}
                    <td className={`${td} font-semibold text-amber-700`}>{formatCurrency(r.signed?.total)}</td>
                    {paidKeys.map((k) => <td key={k} className={td}>{paid[k] ? formatCurrency(paid[k]) : '-'}</td>)}
                    <td className={`${td} font-semibold text-green-700`}>{formatCurrency(paid.total)}</td>
                    <td className={`${td} font-bold text-indigo-700`}>{formatCurrency(r.netCollection)}</td>
                  </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-bold text-gray-900">
                <tr>
                  <td className={td}>TOTAL</td>
                  <td className={td}>{formatCurrency(data.totals.systemSales)}</td>
                  <td className={`${td} text-green-700`}>{formatCurrency(data.totals.cash)}</td>
                  <td className={`${td} text-blue-700`}>{formatCurrency(data.totals.crdb)}</td>
                  <td className={`${td} text-purple-700`}>{formatCurrency(data.totals.stanbic)}</td>
                  <td className={`${td} text-yellow-700`}>{formatCurrency(data.totals.mpesa)}</td>
                  <td className={td}>{formatCurrency(data.totals.total)}</td>
                  <td className={td} colSpan={signedKeys.length}></td>
                  <td className={`${td} text-amber-700`}>{formatCurrency(data.totals.signedTotal)}</td>
                  <td className={td} colSpan={paidKeys.length}></td>
                  <td className={`${td} text-green-700`}>{formatCurrency(data.totals.paidTotal)}</td>
                  <td className={`${td} text-indigo-700`}>{formatCurrency(data.totals.netCollection)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Per-staff day-by-day detail modal */}
      {detailKey && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onClick={() => setDetailKey(null)}>
          <div className="bg-white w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900">{detailKey}</h3>
                <p className="text-xs text-gray-500">{from === to ? from : `${from} → ${to}`} · day-by-day</p>
              </div>
              <div className="flex items-center gap-2">
                {detail && detail.rows.length > 0 && (
                  <button onClick={downloadDetail} className="px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition">📥 Download</button>
                )}
                <button onClick={() => setDetailKey(null)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
              </div>
            </div>
            <div className="overflow-auto p-4">
              {detailLoading ? (
                <div className="py-12 text-center text-gray-400">Loading…</div>
              ) : !detail || detail.rows.length === 0 ? (
                <div className="py-12 text-center text-gray-400">No activity in this period.</div>
              ) : detail.kind === 'customer' ? (
                <table className="w-full text-xs sm:text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-600">
                      <th className="px-2 py-2 font-semibold">Date</th>
                      <th className="px-2 py-2 font-semibold text-right">Debt</th>
                      <th className="px-2 py-2 font-semibold text-right">Paid</th>
                      <th className="px-2 py-2 font-semibold text-right">Outstanding</th>
                      <th className="px-2 py-2 font-semibold">Service Staff</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {detail.rows.map((r, i: number) => (
                      <tr key={i} className={(r.outstanding ?? 0) > 0 ? 'bg-red-50/50' : ''}>
                        <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{formatDate(r.date)}</td>
                        <td className="px-2 py-2 text-right text-gray-700">{formatCurrency(r.debt)}</td>
                        <td className="px-2 py-2 text-right text-green-700">{formatCurrency(r.paid)}</td>
                        <td className={`px-2 py-2 text-right font-bold ${(r.outstanding ?? 0) > 0 ? 'text-red-600' : 'text-gray-500'}`}>{formatCurrency(r.outstanding)}</td>
                        <td className="px-2 py-2 text-gray-500">{r.serviceStaff || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-bold text-gray-900">
                    <tr>
                      <td className="px-2 py-2">TOTAL</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(detail.totals.debt)}</td>
                      <td className="px-2 py-2 text-right text-green-700">{formatCurrency(detail.totals.paid)}</td>
                      <td className="px-2 py-2 text-right text-red-700">{formatCurrency(detail.totals.outstanding)}</td>
                      <td className="px-2 py-2"></td>
                    </tr>
                  </tfoot>
                </table>
              ) : (detail.kind === 'admin' || detail.kind === 'director') ? (
                <table className="w-full text-xs sm:text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-600">
                      <th className="px-2 py-2 font-semibold">Date</th>
                      <th className="px-2 py-2 font-semibold text-right">Signed Amount</th>
                      <th className="px-2 py-2 font-semibold text-right">Credit Limit</th>
                      <th className="px-2 py-2 font-semibold text-right">Exceeded</th>
                      <th className="px-2 py-2 font-semibold">Service Staff</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {detail.rows.map((r, i: number) => (
                      <tr key={i} className={(r.exceeded ?? 0) > 0 ? 'bg-red-50/50' : ''}>
                        <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{formatDate(r.date)}</td>
                        <td className="px-2 py-2 text-right font-semibold text-gray-900">{formatCurrency(r.spent)}</td>
                        <td className="px-2 py-2 text-right text-gray-500">{formatCurrency(r.creditLimit)}</td>
                        <td className={`px-2 py-2 text-right font-bold ${(r.exceeded ?? 0) > 0 ? 'text-red-600' : 'text-gray-400'}`}>{(r.exceeded ?? 0) > 0 ? formatCurrency(r.exceeded) : '-'}</td>
                        <td className="px-2 py-2 text-gray-500">{r.serviceStaff || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-bold text-gray-900">
                    <tr>
                      <td className="px-2 py-2">TOTAL</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(detail.totals.spent)}</td>
                      <td className="px-2 py-2 text-right text-gray-500">{formatCurrency(detail.totals.creditLimit)}</td>
                      <td className="px-2 py-2 text-right text-red-700">{formatCurrency(detail.totals.exceeded)}</td>
                      <td className="px-2 py-2"></td>
                    </tr>
                  </tfoot>
                </table>
              ) : (
                <table className="w-full text-xs sm:text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-600">
                      <th className="px-2 py-2 font-semibold">Date</th>
                      <th className="px-2 py-2 font-semibold text-right">System</th>
                      <th className="px-2 py-2 font-semibold text-right">Collection</th>
                      <th className="px-2 py-2 font-semibold text-right">Signed</th>
                      <th className="px-2 py-2 font-semibold text-right">Paid</th>
                      <th className="px-2 py-2 font-semibold text-right">Shortage</th>
                      <th className="px-2 py-2 font-semibold text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {detail.rows.map((r, i: number) => (
                      <tr key={i} className={(r.difference ?? 0) > 0 ? 'bg-red-50/50' : ''}>
                        <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{formatDate(r.date)}</td>
                        <td className="px-2 py-2 text-right text-gray-600">{formatCurrency(r.system)}</td>
                        <td className="px-2 py-2 text-right font-semibold text-gray-900">{formatCurrency(r.collection)}</td>
                        <td className="px-2 py-2 text-right text-amber-700">{r.signed ? formatCurrency(r.signed) : '-'}</td>
                        <td className="px-2 py-2 text-right text-green-700">{r.paid ? formatCurrency(r.paid) : '-'}</td>
                        <td className={`px-2 py-2 text-right font-semibold ${(r.difference ?? 0) > 0 ? 'text-red-600' : (r.difference ?? 0) < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                          {!r.difference ? '-' : formatCurrency(Math.abs(r.difference))}
                        </td>
                        <td className="px-2 py-2 text-right font-bold text-indigo-700">{formatCurrency(r.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-bold text-gray-900">
                    <tr>
                      <td className="px-2 py-2">TOTAL</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(detail.totals.system)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(detail.totals.collection)}</td>
                      <td className="px-2 py-2 text-right text-amber-700">{formatCurrency(detail.totals.signed)}</td>
                      <td className="px-2 py-2 text-right text-green-700">{formatCurrency(detail.totals.paid)}</td>
                      <td className={`px-2 py-2 text-right ${(detail.totals.difference ?? 0) > 0 ? 'text-red-700' : 'text-green-700'}`}>{formatCurrency(Math.abs(detail.totals.difference ?? 0))}</td>
                      <td className="px-2 py-2 text-right text-indigo-700">{formatCurrency(detail.totals.net)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
