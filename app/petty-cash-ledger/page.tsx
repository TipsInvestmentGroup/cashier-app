'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, PETTY_TABS } from '@/components/Layout/SectionTabs'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ExportBar } from '@/components/ExportBar'
import { useApi } from '@/hooks/useApi'
import { formatCurrency, formatDate } from '@/lib/utils'
import { MoneyInput } from '@/components/MoneyInput'
import { format, subDays } from 'date-fns'
import toast from 'react-hot-toast'

interface FundingSource { id: string; name: string; code: string; sourceType: string; isActive: boolean }
interface LedgerRow { id: string; type: string; amount: number; reference: string | null; note: string | null; createdByName: string | null; createdAt: string; runningBalance?: number }
interface Ledger { fundingSourceId: string; openingBalance: number; totalReceived: number; totalPaid: number; closingBalance: number; rows: LedgerRow[]; live?: boolean }
interface Group { label: string; count: number; amount: number }
interface ExpenseReport {
  totals: { requested: number; paid: number; pending: number; approvedUnpaid: number; cashierPaid: number; fundBackedPaid: number }
  byOutlet: Group[]; byCategory: Group[]; byDepartment: Group[]; byRequester: Group[]; byFundingSource: Group[]; byRequestType: Group[]
  legacy?: { paid: number }; combinedPaidTotal?: number
}

const TYPE_LABEL: Record<string, string> = { OPEN: 'Opening balance', REPLENISH: 'Funds received', PAYMENT: 'Expense paid', ADJUST: 'Adjustment' }

export default function PettyCashLedgerPage() {
  const { request } = useApi()
  const [view, setView] = useState<'ledger' | 'report'>('ledger')
  const [sources, setSources] = useState<FundingSource[]>([])
  const [selected, setSelected] = useState('')
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [from, setFrom] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [report, setReport] = useState<ExpenseReport | null>(null)
  const loadReport = useCallback(async () => {
    try { setReport(await request(`/api/expense/report?from=${from}&to=${to}&combined=true`)) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load report') }
  }, [request, from, to])
  useEffect(() => { if (view === 'report') loadReport() }, [view, loadReport])

  const loadSources = useCallback(async () => {
    try {
      const s: FundingSource[] = await request('/api/expense/funding-sources')
      const active = (s || []).filter((x) => x.isActive)
      setSources(active)
      if (!selected && active.length) setSelected(active[0].id)
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load funding sources') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])
  useEffect(() => { loadSources() }, [loadSources])

  const loadLedger = useCallback(async () => {
    if (!selected) return
    setLoading(true)
    try { setLedger(await request(`/api/expense/funding-sources/${selected}/ledger`)) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load ledger') }
    finally { setLoading(false) }
  }, [request, selected])
  useEffect(() => { loadLedger() }, [loadLedger])

  const source = sources.find((s) => s.id === selected)
  const canReplenish = source && (source.sourceType === 'CASH' || source.sourceType === 'OTHER')

  const submitReplenish = async (e: React.FormEvent) => {
    e.preventDefault()
    const amt = Number(amount)
    if (!amt || amt <= 0) return toast.error('Enter an amount greater than zero')
    setSubmitting(true)
    try {
      await request(`/api/expense/funding-sources/${selected}/replenish`, { method: 'POST', body: JSON.stringify({ amount: amt, reference: reference || undefined, note: note || undefined }) })
      toast.success('Allocation recorded')
      setAmount(''); setReference(''); setNote('')
      loadLedger()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not record allocation') }
    finally { setSubmitting(false) }
  }

  return (
    <AppShell>
      <SectionTabs tabs={PETTY_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Petty Cash Ledger</h1>
          <p className="text-gray-500 text-sm">Every allocation (DR) and disbursement (CR) against a petty cash fund, with a running balance for audit.</p>
        </div>

        <div className="flex gap-2 border-b border-gray-100">
          {(['ledger', 'report'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${view === v ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {v === 'ledger' ? 'Ledger' : 'Report'}
            </button>
          ))}
        </div>

        {view === 'ledger' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <label className="block max-w-sm">
            <span className="text-xs text-gray-500">Funding source</span>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}
              className="w-full mt-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.sourceType})</option>)}
            </select>
          </label>
        </div>
        )}

        {view === 'report' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-end gap-3">
              <label className="block"><span className="text-xs text-gray-500">From</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" /></label>
              <label className="block"><span className="text-xs text-gray-500">To</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" /></label>
              <Button onClick={loadReport}>Refresh</Button>
              {report && (
                <ExportBar
                  rows={[
                    ...report.byOutlet.map((g) => ({ Group: 'Outlet', Name: g.label, Count: g.count, Amount: g.amount })),
                    ...report.byCategory.map((g) => ({ Group: 'Category', Name: g.label, Count: g.count, Amount: g.amount })),
                    ...report.byRequester.map((g) => ({ Group: 'Requester', Name: g.label, Count: g.count, Amount: g.amount })),
                    ...report.byFundingSource.map((g) => ({ Group: 'Funding source', Name: g.label, Count: g.count, Amount: g.amount })),
                  ]}
                  filename="expense-framework-report"
                  title="Expense Framework Report"
                />
              )}
            </div>

            {!report ? <div className="py-16 text-center text-gray-400">Loading…</div> : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                    <p className="text-gray-500 text-xs">Requested</p>
                    <p className="text-lg font-bold mt-1 text-gray-800">{formatCurrency(report.totals.requested)}</p>
                  </div>
                  <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                    <p className="text-gray-500 text-xs">Paid (new framework)</p>
                    <p className="text-lg font-bold mt-1 text-red-600">{formatCurrency(report.totals.paid)}</p>
                  </div>
                  <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                    <p className="text-gray-500 text-xs">Cash-drawer paid</p>
                    <p className="text-lg font-bold mt-1 text-gray-800">{formatCurrency(report.totals.cashierPaid)}</p>
                  </div>
                  <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-4 shadow">
                    <p className="text-indigo-100 text-xs">Combined (legacy + new)</p>
                    <p className="text-lg font-bold mt-1">{formatCurrency(report.combinedPaidTotal ?? report.totals.paid)}</p>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  {([['By outlet', report.byOutlet], ['By category', report.byCategory], ['By requester', report.byRequester], ['By funding source', report.byFundingSource]] as [string, Group[]][]).map(([title, rows]) => (
                    <div key={title} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                      <h3 className="font-semibold text-gray-800 mb-2 text-sm">{title}</h3>
                      {rows.length ? (
                        <table className="w-full text-sm">
                          <tbody className="divide-y divide-gray-50">
                            {rows.map((g) => (
                              <tr key={g.label}>
                                <td className="py-1.5 text-gray-700">{g.label}</td>
                                <td className="py-1.5 text-gray-400 text-xs text-right pr-2">{g.count}×</td>
                                <td className="py-1.5 text-right font-medium text-gray-800">{formatCurrency(g.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <p className="text-gray-400 text-sm">No data for this range.</p>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {view === 'ledger' && (loading ? <div className="py-16 text-center text-gray-400">Loading…</div> : !ledger ? (
          <EmptyState icon="📒" title="No funding source selected" hint="Create one in Expense Settings first." />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <p className="text-gray-500 text-xs">Opening</p>
                <p className="text-lg font-bold mt-1 text-gray-800">{formatCurrency(ledger.openingBalance)}</p>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <p className="text-gray-500 text-xs">Funds Received</p>
                <p className="text-lg font-bold mt-1 text-green-600">{formatCurrency(ledger.totalReceived)}</p>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <p className="text-gray-500 text-xs">Expenses Paid</p>
                <p className="text-lg font-bold mt-1 text-red-600">{formatCurrency(ledger.totalPaid)}</p>
              </div>
              <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-4 shadow">
                <p className="text-indigo-100 text-xs">Closing Balance{ledger.live ? ' (live)' : ''}</p>
                <p className="text-lg font-bold mt-1">{formatCurrency(ledger.closingBalance)}</p>
              </div>
            </div>

            {canReplenish && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h2 className="font-semibold text-gray-800 mb-3">Record allocation to custodian</h2>
                <form onSubmit={submitReplenish} className="grid sm:grid-cols-4 gap-3 items-end">
                  <label className="block"><span className="text-xs text-gray-500">Amount *</span>
                    <MoneyInput value={amount} onChange={setAmount} className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="0" /></label>
                  <label className="block"><span className="text-xs text-gray-500">Reference</span>
                    <input value={reference} onChange={(e) => setReference(e.target.value)} className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="Cheque no., voucher…" /></label>
                  <label className="block sm:col-span-1"><span className="text-xs text-gray-500">Note</span>
                    <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="Optional" /></label>
                  <Button type="submit" disabled={submitting}>{submitting ? 'Recording…' : 'Record allocation'}</Button>
                </form>
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-600">
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold">Type</th>
                      <th className="px-4 py-3 font-semibold">Reference</th>
                      <th className="px-4 py-3 font-semibold">By</th>
                      <th className="px-4 py-3 font-semibold text-right">Amount</th>
                      {!ledger.live && <th className="px-4 py-3 font-semibold text-right">Balance</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {ledger.rows.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                        <td className="px-4 py-3 text-gray-700">{TYPE_LABEL[r.type] || r.type}{r.note ? <span className="block text-[11px] text-gray-400">{r.note}</span> : null}</td>
                        <td className="px-4 py-3 text-gray-500">{r.reference || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{r.createdByName || '—'}</td>
                        <td className={`px-4 py-3 text-right font-bold ${r.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>{r.amount >= 0 ? '+' : ''}{formatCurrency(r.amount)}</td>
                        {!ledger.live && <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(r.runningBalance ?? 0)}</td>}
                      </tr>
                    ))}
                    {!ledger.rows.length && (
                      <tr><td colSpan={ledger.live ? 5 : 6}><EmptyState icon="📒" title="No transactions yet" hint="Allocations and expense payments will appear here." /></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ))}
      </div>
    </AppShell>
  )
}
