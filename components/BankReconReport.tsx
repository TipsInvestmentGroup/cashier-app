'use client'
import { useState, useEffect, useCallback } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { format } from 'date-fns'
import { RangeKey, RANGE_OPTIONS, getRangeInterval } from '@/lib/dateRange'
import { ExportBar } from '@/components/ExportBar'
import toast from 'react-hot-toast'

interface Outlet { id: string; name: string }
interface Row { date: string; channel: string; opening: number | null; closing: number | null; required: number | null; reported: number; verified: number | null; verifiedSet: boolean; variance: number | null; verifiedVariance: number | null; reason: string; verifiedBy?: string }
interface Resp { rows: Row[]; totals: { required: number; reported: number; verified: number; variance: number; verifiedVariance: number } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function BankReconReport({ outlets, request }: { outlets: Outlet[]; request: (url: string, opts?: any) => Promise<any> }) {
  const [range, setRange] = useState<RangeKey>('month')
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [outletId, setOutletId] = useState('')
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)

  const interval = getRangeInterval(range, customFrom, customTo)
  const from = format(interval.start, 'yyyy-MM-dd')
  const to = format(interval.end, 'yyyy-MM-dd')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      if (outletId) params.set('outletId', outletId)
      setData(await request(`/api/reports/bank-recon?${params}`))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error loading report')
    } finally { setLoading(false) }
  }, [request, from, to, outletId])

  useEffect(() => { load() }, [load])

  const varLabel = (v: number) => (v > 0 ? 'Over' : v < 0 ? 'Short' : '—')
  const exportRows = (data?.rows || []).map((r) => ({
    Date: formatDate(r.date), Channel: r.channel,
    Opening: r.opening ?? '', Closing: r.closing ?? '', Required: r.required ?? '',
    'Reported (System)': r.reported, 'Variance (Reported−Required)': r.variance ?? '', 'Variance Type': r.variance == null ? '' : varLabel(r.variance),
    Verified: r.verifiedSet ? r.verified : '', 'Verified Variance': r.verifiedVariance ?? '', 'Verified By': r.verifiedBy || '', Reason: r.reason,
  }))

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-600 mr-1">Period:</span>
          {RANGE_OPTIONS.map((r) => (
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
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Outlet</label>
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">All Outlets</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="ml-auto"><ExportBar rows={exportRows} filename={`digital-payment-recon-${from}_to_${to}`} title="Digital Payment Reconciliation Report" /></div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400">Generating report…</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="py-16 text-center text-gray-400">No digital payment reconciliations for this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-600">
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Channel</th>
                  <th className="px-4 py-3 font-semibold text-right">Opening</th>
                  <th className="px-4 py-3 font-semibold text-right">Closing</th>
                  <th className="px-4 py-3 font-semibold text-right">Required</th>
                  <th className="px-4 py-3 font-semibold text-right">Reported</th>
                  <th className="px-4 py-3 font-semibold text-right">Variance</th>
                  <th className="px-4 py-3 font-semibold text-right">Verified</th>
                  <th className="px-4 py-3 font-semibold text-right">Verified Var</th>
                  <th className="px-4 py-3 font-semibold">Verified By</th>
                  <th className="px-4 py-3 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.rows.map((r, i) => (
                  <tr key={i} className={`hover:bg-gray-50 ${r.variance != null && r.variance !== 0 ? 'bg-red-50/40' : ''}`}>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="px-4 py-3 font-medium text-gray-700">{r.channel}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{r.opening != null ? formatCurrency(r.opening) : '-'}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{r.closing != null ? formatCurrency(r.closing) : '-'}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{r.required != null ? formatCurrency(r.required) : '-'}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(r.reported)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${r.variance == null ? 'text-gray-300' : r.variance === 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {r.variance == null ? '-' : r.variance === 0 ? '✓' : `${r.variance > 0 ? '▲ ' : '▼ '}${formatCurrency(Math.abs(r.variance))} ${varLabel(r.variance)}`}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{r.verifiedSet ? formatCurrency(r.verified || 0) : '-'}</td>
                    <td className={`px-4 py-3 text-right font-bold ${r.verifiedVariance == null ? 'text-gray-300' : r.verifiedVariance === 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {r.verifiedVariance == null ? '-' : r.verifiedVariance === 0 ? '✓' : `${r.verifiedVariance > 0 ? '▲ ' : '▼ '}${formatCurrency(Math.abs(r.verifiedVariance))}`}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{r.verifiedBy || '-'}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-[180px] truncate" title={r.reason}>{r.reason || '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-bold text-gray-900">
                <tr>
                  <td className="px-4 py-3" colSpan={4}>TOTAL</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(data.totals.required)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(data.totals.reported)}</td>
                  <td className={`px-4 py-3 text-right ${data.totals.variance === 0 ? 'text-green-700' : 'text-red-700'}`}>{data.totals.variance === 0 ? '✓' : `${formatCurrency(Math.abs(data.totals.variance))} ${varLabel(data.totals.variance)}`}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(data.totals.verified)}</td>
                  <td className={`px-4 py-3 text-right ${data.totals.verifiedVariance === 0 ? 'text-green-700' : 'text-red-700'}`}>{data.totals.verifiedVariance === 0 ? '✓' : formatCurrency(Math.abs(data.totals.verifiedVariance))}</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
