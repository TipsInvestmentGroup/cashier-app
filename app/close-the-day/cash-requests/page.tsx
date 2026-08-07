'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useApi } from '@/hooks/useApi'
import { formatCurrency, formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'

interface CashRequestRow {
  id: string
  fundingSourceId: string
  requestNumber: string | null
  requestedByName: string | null
  purpose: string
  department: string | null
  requestType: string
  category: string
  amount: number
  paid: number
  outstanding: number
  currency: string
  status: string
  isPaid: boolean
  createdAt: string
}
interface CashRequests {
  outletId: string | null
  date: string | null
  count: number
  paidCount: number
  unpaidCount: number
  totalToPay: number
  rows: CashRequestRow[]
  noFund?: boolean
}

// Reads useSearchParams (?outletId=&date=) so it must sit under a Suspense
// boundary — same wrapper pattern as the other query-reading pages here.
function CashRequestsWorklist() {
  const { request } = useApi()
  const searchParams = useSearchParams()
  const outletId = searchParams.get('outletId') || ''
  const date = searchParams.get('date') || ''

  const [data, setData] = useState<CashRequests | null>(null)
  const [loading, setLoading] = useState(true)
  // The row whose inline Pay confirm is open, and the one currently posting.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (outletId) qs.set('outletId', outletId)
      if (date) qs.set('date', date)
      setData(await request(`/api/expense/cash-requests?${qs.toString()}`))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not load cash requests')
    } finally {
      setLoading(false)
    }
  }, [request, outletId, date])
  useEffect(() => { load() }, [load])

  // Pay-on-screen (§4.2): full outstanding, in CASH, from the request's own
  // Cashier Cash fund. No navigation away — re-render the row as Paid in place.
  const pay = async (row: CashRequestRow) => {
    setPayingId(row.id)
    try {
      await request(`/api/expense/requests/${row.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ fundingSourceId: row.fundingSourceId, paymentMethod: 'CASH', amount: row.outstanding }),
      })
      toast.success(`Paid ${formatCurrency(row.outstanding)}`)
      setConfirmingId(null)
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not record payment')
    } finally {
      setPayingId(null)
    }
  }

  const newRequestHref = `/expense-requests${outletId ? `?outletId=${outletId}` : ''}`

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Cash Requests</h1>
            <p className="text-gray-500 text-sm">
              Pay out today&apos;s Cashier Cash requests before reconciling.
              {data?.date && <span className="ml-1 text-gray-400">· {formatDate(data.date)}</span>}
            </p>
          </div>
          <Link href="/collections" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">← Back to Close the Day</Link>
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400">Loading…</div>
        ) : data?.noFund ? (
          <EmptyState icon="🏦" title="No Cashier Cash fund for this outlet"
            hint="Add a Cashier Cash (drawer) funding source in Expense Settings before cash requests can be paid here." />
        ) : !data || data.count === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
            <div className="text-4xl mb-3">💸</div>
            <h2 className="font-semibold text-gray-800">No cash requests today</h2>
            <p className="text-gray-500 text-sm mt-1 mb-4">Nothing to pay out from the Cashier Cash fund for this day.</p>
            <Link href={newRequestHref} className="inline-block px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700">+ New Cash Request</Link>
          </div>
        ) : (
          <>
            {/* Progress + gating header (§4.3): X of Y paid, and what's left. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <p className="text-gray-500 text-xs">Progress</p>
                <p className="text-lg font-bold mt-1 text-gray-800">{data.paidCount} of {data.count} paid</p>
              </div>
              <div className={`rounded-2xl p-4 shadow-sm border ${data.totalToPay > 0 ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100'} sm:col-span-2`}>
                <p className="text-gray-500 text-xs">Remaining to pay</p>
                <p className={`text-lg font-bold mt-1 ${data.totalToPay > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{formatCurrency(data.totalToPay)}</p>
              </div>
            </div>

            {data.totalToPay <= 0 ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800 text-sm font-medium">
                ✅ All cash requests settled. You can continue to Cash Reconciliation.
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm">
                {data.unpaidCount} cash request{data.unpaidCount === 1 ? '' : 's'} still unpaid — reconciliation totals won&apos;t include {data.unpaidCount === 1 ? 'it' : 'them'} until paid. You can still proceed.
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
                <h2 className="font-semibold text-gray-800">Cashier Cash worklist</h2>
                <Link href={newRequestHref} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium whitespace-nowrap">+ New Cash Request</Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-600">
                      <th className="px-4 py-3 font-semibold">Requested By</th>
                      <th className="px-4 py-3 font-semibold">Purpose</th>
                      <th className="px-4 py-3 font-semibold">Department</th>
                      <th className="px-4 py-3 font-semibold text-right">Amount</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.rows.map((r) => {
                      const confirming = confirmingId === r.id
                      return (
                        <tr key={r.id} className={r.isPaid ? 'bg-gray-50/60 text-gray-400' : 'hover:bg-gray-50'}>
                          <td className="px-4 py-3">
                            <span className={r.isPaid ? '' : 'text-gray-700'}>{r.requestedByName || '—'}</span>
                            {r.requestNumber && <span className="block text-[11px] text-gray-400 font-mono">{r.requestNumber}</span>}
                          </td>
                          <td className="px-4 py-3 max-w-[240px] truncate" title={r.purpose}>
                            <span className={r.isPaid ? '' : 'text-gray-700'}>{r.purpose}</span>
                            <span className="block text-[11px] text-gray-400">{r.requestType} · {r.category}</span>
                          </td>
                          <td className="px-4 py-3">{r.department || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-3 text-right font-bold">
                            <span className={r.isPaid ? 'line-through' : 'text-gray-900'}>{formatCurrency(r.amount)}</span>
                            {!r.isPaid && r.paid > 0 && <span className="block text-[11px] text-amber-600 font-normal">{formatCurrency(r.outstanding)} left</span>}
                          </td>
                          <td className="px-4 py-3">
                            {r.isPaid ? (
                              <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">✓ Paid</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-amber-600 font-medium">● Pending</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {r.isPaid ? (
                              <span className="text-gray-300">—</span>
                            ) : confirming ? (
                              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                                <span className="text-xs text-gray-500">Pay {formatCurrency(r.outstanding)}?</span>
                                <button onClick={() => pay(r)} disabled={payingId === r.id}
                                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">
                                  {payingId === r.id ? 'Paying…' : 'Confirm'}
                                </button>
                                <button onClick={() => setConfirmingId(null)} disabled={payingId === r.id}
                                  className="px-2 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700">Cancel</button>
                              </span>
                            ) : (
                              <button onClick={() => setConfirmingId(r.id)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700">Pay</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<AppShell><div className="py-12 text-center text-gray-400">Loading…</div></AppShell>}>
      <CashRequestsWorklist />
    </Suspense>
  )
}
