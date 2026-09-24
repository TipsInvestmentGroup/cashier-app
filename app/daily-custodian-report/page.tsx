'use client'
import { useEffect, useState, useCallback, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, PETTY_TABS } from '@/components/Layout/SectionTabs'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ExportBar } from '@/components/ExportBar'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'
import { format } from 'date-fns'

type FundClass = 'CASHIER_CASH' | 'PETTY_CASH' | 'DIGITAL'
interface AccountDetail {
  accountLabel: string; accountMasked: string | null; channel: string | null
  depositsByCashiers: number; internalTransfersOut: number; withdrawals: number
  disbursements: number; otherCredits: number; otherOut: number
}
interface Row {
  fundingSourceId: string; fundName: string; fundClass: FundClass; fundClassLabel: string
  outletName: string; custodianName: string
  opening: number; debited: number; spent: number; closing: number
  accountDetail?: AccountDetail
}
interface Totals { opening: number; debited: number; spent: number; closing: number }
interface FundClassCard { fundClass: FundClass; label: string; totals: Totals; flagged: number }
interface DailyTxn { time: string; fundClass: FundClass; fundClassLabel: string; fundName: string; description: string; amount: number; party: string; kind: 'disbursement' | 'topup' }
interface Daily {
  date: string
  report: { rows: Row[]; byFundClass: FundClassCard[]; combined: Totals; flaggedCount: number }
  transactions: DailyTxn[]
  outlets: { id: string; name: string }[]
}

const FUND_ORDER: FundClass[] = ['CASHIER_CASH', 'PETTY_CASH', 'DIGITAL']

function DailyCustodianReportPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const singleOutlet = user?.role === 'CASHIER' || user?.role === 'WAITER'

  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [outletId, setOutletId] = useState('')
  const [daily, setDaily] = useState<Daily | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ date })
      if (outletId) qs.set('outletId', outletId)
      setDaily(await request(`/api/expense/custodian-report/daily?${qs.toString()}`))
    } finally { setLoading(false) }
  }, [request, date, outletId])
  useEffect(() => { load() }, [load])

  const timeOf = (iso: string) => { try { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

  // Rows for CSV/Excel/PDF/Email — the summary per fund class then every
  // transaction, so the emailed document carries both the headline and detail.
  const exportRows = useMemo(() => {
    if (!daily) return []
    const summary = daily.report.byFundClass.map((c) => ({
      Section: c.label, Time: '', Detail: 'DAY SUMMARY', Party: '',
      Debited: c.totals.debited, Spent: c.totals.spent, Closing: c.totals.closing,
    }))
    const txns = daily.transactions.map((t) => ({
      Section: t.fundClassLabel, Time: timeOf(t.time), Detail: t.description, Party: t.party,
      Debited: t.amount > 0 ? t.amount : '', Spent: t.amount < 0 ? -t.amount : '', Closing: '',
    }))
    return [...summary, ...txns]
  }, [daily])

  const cardFor = (fc: FundClass) => daily?.report.byFundClass.find((c) => c.fundClass === fc)
  const rowsFor = (fc: FundClass) => daily?.report.rows.filter((r) => r.fundClass === fc) || []
  const txnsFor = (fc: FundClass) => daily?.transactions.filter((t) => t.fundClass === fc) || []

  return (
    <AppShell>
      <SectionTabs tabs={PETTY_TABS} />
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Daily Custodian Movement Report</h1>
            <p className="text-gray-500 text-sm">A same-day snapshot of what moved through each custodian&apos;s hands — built to send to directors.</p>
          </div>
          <Link href="/custodian-report" className="text-sm text-indigo-600 hover:text-indigo-800">← Full Custodian Report</Link>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-end gap-3">
          <label className="block"><span className="text-xs text-gray-500">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="block mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" /></label>
          {!singleOutlet && (
            <label className="block"><span className="text-xs text-gray-500">Outlet</span>
              <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="block mt-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                <option value="">All outlets</option>
                {(daily?.outlets || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select></label>
          )}
          <Button onClick={load}>Refresh</Button>
          {daily && daily.transactions.length + daily.report.rows.length > 0 && (
            // "Send Now" = the existing Email Directors mechanism (locked decision:
            // same DIRECTOR distribution list). CSV/Excel/PDF sit alongside it.
            // NOTE: scheduled auto-send (end-of-day cron) is deferred to v2 — it
            // would hook in here by POSTing these same rows to /api/email-report
            // from a Vercel Cron route on a daily schedule.
            <ExportBar rows={exportRows} filename={`daily-custodian-report-${date}`} title={`Daily Custodian Movement — ${date}`} subject={`Daily Custodian Movement Report — ${date}`} />
          )}
        </div>

        {loading ? <div className="py-16 text-center text-gray-400">Loading…</div> : !daily ? (
          <EmptyState icon="📅" title="No data" hint="Pick a date." />
        ) : (
          <>
            {/* Top combined summary line (§9.2 item 2). */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-2xl p-4 shadow bg-gradient-to-br from-emerald-600 to-emerald-700 text-white">
                <p className="text-white/80 text-xs">Total Debited Today</p>
                <p className="text-2xl font-bold mt-1">{formatCurrency(daily.report.combined.debited)}</p>
              </div>
              <div className="rounded-2xl p-4 shadow bg-gradient-to-br from-rose-600 to-rose-700 text-white">
                <p className="text-white/80 text-xs">Total Spent Today</p>
                <p className="text-2xl font-bold mt-1">{formatCurrency(daily.report.combined.spent)}</p>
              </div>
              <div className="rounded-2xl p-4 shadow bg-gradient-to-br from-indigo-600 to-indigo-800 text-white">
                <p className="text-indigo-100 text-xs">Combined Closing Balance</p>
                <p className="text-2xl font-bold mt-1">{formatCurrency(daily.report.combined.closing)}</p>
              </div>
            </div>

            {daily.report.flaggedCount > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                ⚠ {daily.report.flaggedCount} custodian balance(s) did not reconcile — see the full Custodian Report.
              </div>
            )}

            {/* One section per custodian type. */}
            {FUND_ORDER.map((fc) => {
              const card = cardFor(fc)
              const rows = rowsFor(fc)
              const txns = txnsFor(fc)
              if (!card || (rows.length === 0 && txns.length === 0)) return null
              return (
                <div key={fc} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="font-semibold text-gray-800">{card.label}</h2>
                    <div className="text-xs text-gray-500 flex gap-3">
                      <span>Opening <b className="text-gray-700">{formatCurrency(card.totals.opening)}</b></span>
                      <span className="text-green-600">Debited +{formatCurrency(card.totals.debited)}</span>
                      <span className="text-red-600">Spent −{formatCurrency(card.totals.spent)}</span>
                      <span>Closing <b className="text-gray-900">{formatCurrency(card.totals.closing)}</b></span>
                    </div>
                  </div>

                  {/* Digital per-account breakdown (§9.2 item 3). */}
                  {fc === 'DIGITAL' && rows.some((r) => r.accountDetail) && (
                    <div className="px-4 py-3 border-b border-gray-50 space-y-2">
                      {rows.filter((r) => r.accountDetail).map((r) => {
                        const d = r.accountDetail!
                        return (
                          <div key={r.fundingSourceId} className="text-xs">
                            <span className="text-gray-500">{d.accountLabel}{d.accountMasked ? ` · ${d.accountMasked}` : ''}</span>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-gray-600">
                              <span>Deposits <b className="text-green-700">{formatCurrency(d.depositsByCashiers)}</b></span>
                              <span>Transfers out <b className="text-red-700">{formatCurrency(d.internalTransfersOut)}</b></span>
                              <span>Withdrawals <b className="text-red-700">{formatCurrency(d.withdrawals)}</b></span>
                              <span>Disbursements <b className="text-red-700">{formatCurrency(d.disbursements)}</b></span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {txns.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50"><tr className="text-left text-gray-500 text-xs">
                        <th className="px-4 py-2 font-semibold">Time</th>
                        <th className="px-4 py-2 font-semibold">Description</th>
                        <th className="px-4 py-2 font-semibold">Party</th>
                        <th className="px-4 py-2 font-semibold text-right">Amount</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-50">
                        {txns.map((t, i) => (
                          <tr key={i}>
                            <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{timeOf(t.time)}</td>
                            <td className="px-4 py-2 text-gray-700">{t.description}
                              {t.kind === 'topup' && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">top-up</span>}
                            </td>
                            <td className="px-4 py-2 text-gray-600">{t.party}</td>
                            <td className={`px-4 py-2 text-right font-semibold ${t.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>{t.amount >= 0 ? '+' : '−'}{formatCurrency(Math.abs(t.amount))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="px-4 py-3 text-xs text-gray-400">No itemised transactions today (balances above reflect collections/computed movement).</p>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    </AppShell>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<AppShell><div className="py-12 text-center text-gray-400">Loading…</div></AppShell>}>
      <DailyCustodianReportPage />
    </Suspense>
  )
}
