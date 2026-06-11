'use client'
import { useState, useEffect, useCallback } from 'react'
import { formatCurrency } from '@/lib/utils'
import { format } from 'date-fns'
import { RangeKey, RANGE_OPTIONS, getRangeInterval } from '@/lib/dateRange'
import toast from 'react-hot-toast'

interface Outlet { id: string; name: string }
interface Row {
  staffName: string; outletName: string; systemSales: number
  cash: number; crdb: number; stanbic: number; mpesa: number; total: number
  signed: Record<string, number>; paid: Record<string, number>; netCollection: number
}
interface ReportResp {
  from: string; to: string; rows: Row[]
  totals: { systemSales: number; cash: number; crdb: number; stanbic: number; mpesa: number; total: number; signedTotal: number; paidTotal: number; netCollection: number }
  signedKeys: string[]; paidKeys: string[]
}

const SIGNED_LABELS: Record<string, string> = { ADMIN: 'Admin', DIRECTOR: 'Director', CUSTOMER: 'Customer', TIPS: 'Tips', DJ: 'DJ', STAFF_LOSS: 'Staff Loss' }
const PAID_LABELS: Record<string, string> = { ADMIN: 'Admin', DIRECTOR: 'Director', CUSTOMER: 'Customer', STAFF_LOSS: 'Staff Loss', OTHER: 'Other' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DailyCashierReport({ outlets, request }: { outlets: Outlet[]; request: (url: string, opts?: any) => Promise<any> }) {
  const [range, setRange] = useState<RangeKey>('today')
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [outletId, setOutletId] = useState('')
  const [groupBy, setGroupBy] = useState<'staff' | 'outlet'>('staff')
  const [data, setData] = useState<ReportResp | null>(null)
  const [loading, setLoading] = useState(false)

  const interval = getRangeInterval(range, customFrom, customTo)
  const from = format(interval.start, 'yyyy-MM-dd')
  const to = format(interval.end, 'yyyy-MM-dd')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to, groupBy })
      if (outletId) params.set('outletId', outletId)
      setData(await request(`/api/reports/daily-cashier?${params}`))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error loading report')
    } finally {
      setLoading(false)
    }
  }, [request, from, to, outletId, groupBy])

  useEffect(() => { load() }, [load])

  const signedKeys = data?.signedKeys || []
  const paidKeys = (data?.paidKeys || []).filter((k) => k !== 'OTHER')

  const labelHeader = groupBy === 'outlet' ? 'Outlet' : 'Staff'
  const fileBase = `cashier-report-${from}_to_${to}`

  // Shared header + numeric body for all export formats
  const buildTable = () => {
    const header = [
      labelHeader, 'System Sales', 'Cash', 'CRDB', 'Stanbic', 'M-PESA', 'Collection',
      ...signedKeys.map((k) => `Signed ${SIGNED_LABELS[k]}`), 'Signed Total',
      ...paidKeys.map((k) => `Paid ${PAID_LABELS[k]}`), 'Paid Total', 'Net Collection',
    ]
    const body = (data?.rows || []).map((r) => [
      r.staffName, r.systemSales, r.cash, r.crdb, r.stanbic, r.mpesa, r.total,
      ...signedKeys.map((k) => r.signed[k] || 0), r.signed.total,
      ...paidKeys.map((k) => r.paid[k] || 0), r.paid.total, r.netCollection,
    ] as (string | number)[])
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
            <div className="flex gap-1">
              {(['staff', 'outlet'] as const).map((g) => (
                <button key={g} onClick={() => setGroupBy(g)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium capitalize transition ${groupBy === g ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
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

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-4 shadow">
            <p className="text-indigo-100 text-xs">Net Collection</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(data.totals.netCollection)}</p>
            <p className="text-indigo-200 text-xs mt-1">{data.rows.length} staff</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"><p className="text-gray-500 text-xs">🧾 System Sales</p><p className="text-lg font-bold mt-1 text-gray-800">{formatCurrency(data.totals.systemSales)}</p></div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"><p className="text-gray-500 text-xs">💰 Collection</p><p className="text-lg font-bold mt-1 text-gray-800">{formatCurrency(data.totals.total)}</p></div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"><p className="text-gray-500 text-xs">✅ Paid Bills</p><p className="text-lg font-bold mt-1 text-green-700">{formatCurrency(data.totals.paidTotal)}</p></div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">Generating report…</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No cashier activity for this day.</div>
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
                {data.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className={`${td} font-medium text-gray-800`}>{r.staffName}</td>
                    <td className={td}>{formatCurrency(r.systemSales)}</td>
                    <td className={`${td} text-green-700`}>{formatCurrency(r.cash)}</td>
                    <td className={`${td} text-blue-700`}>{formatCurrency(r.crdb)}</td>
                    <td className={`${td} text-purple-700`}>{formatCurrency(r.stanbic)}</td>
                    <td className={`${td} text-yellow-700`}>{formatCurrency(r.mpesa)}</td>
                    <td className={`${td} font-bold`}>{formatCurrency(r.total)}</td>
                    {signedKeys.map((k) => <td key={k} className={td}>{r.signed[k] ? formatCurrency(r.signed[k]) : '-'}</td>)}
                    <td className={`${td} font-semibold text-amber-700`}>{formatCurrency(r.signed.total)}</td>
                    {paidKeys.map((k) => <td key={k} className={td}>{r.paid[k] ? formatCurrency(r.paid[k]) : '-'}</td>)}
                    <td className={`${td} font-semibold text-green-700`}>{formatCurrency(r.paid.total)}</td>
                    <td className={`${td} font-bold text-indigo-700`}>{formatCurrency(r.netCollection)}</td>
                  </tr>
                ))}
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
    </div>
  )
}
