'use client'
import { useEffect, useState, useCallback, useMemo, Suspense, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, PETTY_TABS } from '@/components/Layout/SectionTabs'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ExportBar } from '@/components/ExportBar'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'
import { format, subDays } from 'date-fns'
import toast from 'react-hot-toast'

type FundClass = 'CASHIER_CASH' | 'PETTY_CASH' | 'DIGITAL'
type VarianceStatus = 'RECONCILED' | 'MISMATCH' | 'UNVERIFIABLE'

interface Variance { status: VarianceStatus; note: string; recordedBalance: number | null; difference: number | null }
interface AccountDetail {
  accountLabel: string; accountMasked: string | null; channel: string | null
  depositsByCashiers: number; internalTransfersOut: number; withdrawals: number
  disbursements: number; otherCredits: number; otherOut: number
}
interface Row {
  fundingSourceId: string; fundName: string; fundClass: FundClass; fundClassLabel: string
  outletId: string | null; outletName: string; custodianName: string; custodianUserIds: string[]
  opening: number; debited: number; spent: number; closing: number; variance: Variance
  accountDetail?: AccountDetail
}
interface Totals { opening: number; debited: number; spent: number; closing: number }
interface FundClassCard { fundClass: FundClass; label: string; totals: Totals; flagged: number }
interface Report {
  from: string; to: string; rows: Row[]; byFundClass: FundClassCard[]; combined: Totals
  flaggedCount: number; outlets: { id: string; name: string }[]
}

const FUND_CLASS_FILTERS: { value: '' | FundClass; label: string }[] = [
  { value: '', label: 'All custodians' },
  { value: 'CASHIER_CASH', label: 'Cashier' },
  { value: 'PETTY_CASH', label: 'Petty Cash' },
  { value: 'DIGITAL', label: 'Digital Expenses' },
]

// Colour accent per fund class so the four summary cards read at a glance.
const CARD_ACCENT: Record<FundClass, string> = {
  CASHIER_CASH: 'from-sky-600 to-sky-700',
  PETTY_CASH: 'from-emerald-600 to-emerald-700',
  DIGITAL: 'from-violet-600 to-violet-700',
}

function CustodianReportPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const router = useRouter()
  // Mirror lib/auth.ts SINGLE_OUTLET_ROLES without importing that server-only
  // module (it pulls jsonwebtoken/bcrypt) into this client bundle. A single-
  // outlet role is locked to its own outlet by the API, so hide the picker.
  const singleOutlet = user?.role === 'CASHIER' || user?.role === 'WAITER'

  const [from, setFrom] = useState(format(subDays(new Date(), 6), 'yyyy-MM-dd'))
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [outletId, setOutletId] = useState('')
  const [fundClass, setFundClass] = useState<'' | FundClass>('')
  // §6 edge case 3: never blend a multi-outlet custodian's balances. So the
  // default keeps each outlet's row separate; toggling OFF rolls up by custodian
  // + fund for a higher-altitude view (outlet column then reads "All outlets").
  const [groupByOutlet, setGroupByOutlet] = useState(true)

  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  // Which Digital rows have their §2.1 per-account breakdown expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) => setExpanded((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ from, to })
      if (outletId) qs.set('outletId', outletId)
      if (fundClass) qs.set('fundClass', fundClass)
      setReport(await request(`/api/expense/custodian-report?${qs.toString()}`))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not load the custodian report')
    } finally {
      setLoading(false)
    }
  }, [request, from, to, outletId, fundClass])
  useEffect(() => { load() }, [load])

  // Client-side view of the detail rows: either as-is (per fund/outlet) or rolled
  // up by custodian + fund class when group-by-outlet is off.
  const displayRows = useMemo(() => {
    if (!report) return []
    if (groupByOutlet) return report.rows
    const map = new Map<string, Row>()
    for (const r of report.rows) {
      const key = `${r.custodianName}::${r.fundClass}`
      const existing = map.get(key)
      if (!existing) {
        map.set(key, { ...r, outletId: null, outletName: 'All outlets', fundName: r.fundClassLabel })
      } else {
        existing.opening += r.opening
        existing.debited += r.debited
        existing.spent += r.spent
        existing.closing += r.closing
        // A roll-up is flagged if ANY of its component funds is flagged.
        if (r.variance.status === 'MISMATCH') existing.variance = r.variance
        else if (existing.variance.status !== 'MISMATCH' && r.variance.status === 'RECONCILED') existing.variance = r.variance
      }
    }
    return [...map.values()]
  }, [report, groupByOutlet])

  // §2.1: the per-account digital breakdown must always be available in exports,
  // not just the UI expansion — so the digital buckets ride along as columns
  // (blank for non-digital rows).
  const exportRows = useMemo(() => displayRows.map((r) => ({
    Custodian: r.custodianName,
    Fund: r.fundClassLabel,
    Outlet: r.outletName,
    Account: r.accountDetail ? `${r.accountDetail.accountLabel}${r.accountDetail.accountMasked ? ` (${r.accountDetail.accountMasked})` : ''}` : '',
    Opening: r.opening,
    Debited: r.debited,
    Spent: r.spent,
    Closing: r.closing,
    'Deposits by cashiers': r.accountDetail?.depositsByCashiers ?? '',
    'Internal transfers out': r.accountDetail?.internalTransfersOut ?? '',
    Withdrawals: r.accountDetail?.withdrawals ?? '',
    Disbursements: r.accountDetail?.disbursements ?? '',
    Flag: r.variance.status === 'MISMATCH' ? `MISMATCH (${r.variance.difference})` : r.variance.status === 'RECONCILED' ? 'OK' : '—',
  })), [displayRows])

  const cardFor = (fc: FundClass) => report?.byFundClass.find((c) => c.fundClass === fc)

  return (
    <AppShell>
      <SectionTabs tabs={PETTY_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Custodian Report</h1>
          <p className="text-gray-500 text-sm">For the selected period: how much each custodian received (Debited), spent, and is holding now (Closing) — across Cashier Cash, Petty Cash and Digital Expenses.</p>
        </div>

        {/* Header controls — same pattern as the ledger Report tab. */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-end gap-3">
          <label className="block"><span className="text-xs text-gray-500">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" /></label>
          <label className="block"><span className="text-xs text-gray-500">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" /></label>
          {!singleOutlet && (
            <label className="block"><span className="text-xs text-gray-500">Outlet</span>
              <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="block mt-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                <option value="">All outlets</option>
                {(report?.outlets || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select></label>
          )}
          <label className="block"><span className="text-xs text-gray-500">Custodian</span>
            <select value={fundClass} onChange={(e) => setFundClass(e.target.value as '' | FundClass)} className="block mt-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
              {FUND_CLASS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select></label>
          <label className="flex items-center gap-2 pb-2 cursor-pointer">
            <input type="checkbox" checked={groupByOutlet} onChange={(e) => setGroupByOutlet(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            <span className="text-sm text-gray-600">Group by outlet</span>
          </label>
          <Button onClick={load}>Refresh</Button>
          {report && report.rows.length > 0 && (
            <ExportBar rows={exportRows} filename={`custodian-report-${from}_to_${to}`} title="Custodian Report" subject={`Custodian Report ${from} → ${to}`} />
          )}
        </div>

        {loading ? <div className="py-16 text-center text-gray-400">Loading…</div> : !report || report.rows.length === 0 ? (
          <EmptyState icon="👥" title="No custodian activity for this range" hint="Pick a wider date range, or check that funds and custodians are set up in Expense Settings." />
        ) : (
          <>
            {report.flaggedCount > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                ⚠ {report.flaggedCount} custodian balance{report.flaggedCount === 1 ? '' : 's'} did not reconcile to the recorded figure — see the Flag column.
              </div>
            )}

            {/* §4 summary cards: one per custodian type + a combined card. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {(['CASHIER_CASH', 'PETTY_CASH', 'DIGITAL'] as FundClass[]).map((fc) => {
                const c = cardFor(fc)
                return (
                  <div key={fc} className={`rounded-2xl p-4 shadow bg-gradient-to-br ${CARD_ACCENT[fc]} text-white`}>
                    <div className="flex items-center justify-between">
                      <p className="text-white/80 text-xs font-medium">{c?.label || fc}</p>
                      {!!c?.flagged && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-300 text-amber-900">⚠ {c.flagged}</span>}
                    </div>
                    <p className="text-2xl font-bold mt-1">{formatCurrency(c?.totals.closing ?? 0)}</p>
                    <div className="mt-2 space-y-0.5 text-[11px] text-white/85">
                      <div className="flex justify-between"><span>Opening</span><span>{formatCurrency(c?.totals.opening ?? 0)}</span></div>
                      <div className="flex justify-between"><span>Debited</span><span>+{formatCurrency(c?.totals.debited ?? 0)}</span></div>
                      <div className="flex justify-between"><span>Spent</span><span>−{formatCurrency(c?.totals.spent ?? 0)}</span></div>
                    </div>
                  </div>
                )
              })}
              <div className="rounded-2xl p-4 shadow bg-gradient-to-br from-indigo-600 to-indigo-800 text-white">
                <p className="text-indigo-100 text-xs font-medium">Combined</p>
                <p className="text-2xl font-bold mt-1">{formatCurrency(report.combined.closing)}</p>
                <div className="mt-2 space-y-0.5 text-[11px] text-indigo-100">
                  <div className="flex justify-between"><span>Opening</span><span>{formatCurrency(report.combined.opening)}</span></div>
                  <div className="flex justify-between"><span>Debited</span><span>+{formatCurrency(report.combined.debited)}</span></div>
                  <div className="flex justify-between"><span>Spent</span><span>−{formatCurrency(report.combined.spent)}</span></div>
                </div>
              </div>
            </div>

            {/* Detail table — one row per custodian (per outlet when grouped). */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-600">
                      <th className="px-4 py-3 font-semibold">Custodian</th>
                      <th className="px-4 py-3 font-semibold">Fund</th>
                      <th className="px-4 py-3 font-semibold">Outlet</th>
                      <th className="px-4 py-3 font-semibold text-right">Opening</th>
                      <th className="px-4 py-3 font-semibold text-right">Debited</th>
                      <th className="px-4 py-3 font-semibold text-right">Spent</th>
                      <th className="px-4 py-3 font-semibold text-right">Closing</th>
                      <th className="px-4 py-3 font-semibold text-center">Flag</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {displayRows.map((r) => {
                      // Drill-through (§4): open that fund class's ledger, with the
                      // exact fund preselected when we're showing a single fund row.
                      const drill = () => {
                        const qs = new URLSearchParams({ fund: r.fundClass })
                        if (groupByOutlet) qs.set('source', r.fundingSourceId)
                        router.push(`/petty-cash-ledger?${qs.toString()}`)
                      }
                      const canExpand = !!r.accountDetail
                      const isOpen = expanded.has(r.fundingSourceId)
                      const d = r.accountDetail
                      return (
                        <Fragment key={`${r.fundingSourceId}-${r.custodianName}`}>
                        <tr onClick={drill} className="hover:bg-indigo-50/40 cursor-pointer">
                          <td className="px-4 py-3 font-medium text-gray-800">{r.custodianName}
                            {groupByOutlet && r.fundName !== r.fundClassLabel && <span className="block text-[11px] text-gray-400">{r.fundName}</span>}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            <span className="inline-flex items-center gap-1.5">
                              {r.fundClassLabel}
                              {canExpand && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleExpand(r.fundingSourceId) }}
                                  className="text-[11px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 hover:bg-violet-200"
                                  title="Show per-account movement">
                                  {isOpen ? '▾ account' : '▸ account'}
                                </button>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{r.outletName}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(r.opening)}</td>
                          <td className="px-4 py-3 text-right text-green-600 font-medium">+{formatCurrency(r.debited)}</td>
                          <td className="px-4 py-3 text-right text-red-600 font-medium">−{formatCurrency(r.spent)}</td>
                          <td className="px-4 py-3 text-right font-bold text-gray-900">{formatCurrency(r.closing)}</td>
                          <td className="px-4 py-3 text-center">
                            {r.variance.status === 'MISMATCH' ? (
                              <span title={r.variance.note} className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">⚠ {r.variance.difference != null ? formatCurrency(r.variance.difference) : 'off'}</span>
                            ) : r.variance.status === 'RECONCILED' ? (
                              <span title={r.variance.note} className="text-emerald-600">✓</span>
                            ) : (
                              <span title={r.variance.note} className="text-gray-300">—</span>
                            )}
                          </td>
                        </tr>
                        {canExpand && isOpen && d && (
                          <tr className="bg-violet-50/40">
                            <td colSpan={8} className="px-6 py-3">
                              <div className="text-[11px] text-gray-500 mb-1">
                                {d.accountLabel}{d.channel ? ` · ${d.channel}` : ''}{d.accountMasked ? ` · ${d.accountMasked}` : ''}
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                                {([
                                  ['Deposits by cashiers', d.depositsByCashiers, 'text-green-700'],
                                  ['Other credits', d.otherCredits, 'text-green-700'],
                                  ['Internal transfers out (top-ups)', d.internalTransfersOut, 'text-red-700'],
                                  ['Withdrawals', d.withdrawals, 'text-red-700'],
                                  ['Disbursements', d.disbursements, 'text-red-700'],
                                  ['Other out', d.otherOut, 'text-red-700'],
                                ] as [string, number, string][]).map(([label, val, cls]) => (
                                  <div key={label} className="bg-white rounded-lg border border-violet-100 px-2.5 py-1.5">
                                    <p className="text-gray-400 leading-tight">{label}</p>
                                    <p className={`font-semibold ${cls}`}>{formatCurrency(val)}</p>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold text-gray-800">
                    <tr>
                      <td className="px-4 py-3" colSpan={3}>Combined</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(report.combined.opening)}</td>
                      <td className="px-4 py-3 text-right text-green-700">+{formatCurrency(report.combined.debited)}</td>
                      <td className="px-4 py-3 text-right text-red-700">−{formatCurrency(report.combined.spent)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(report.combined.closing)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
            <p className="text-[11px] text-gray-400">
              Closing = Opening + Debited − Spent. Click any row to open that fund&apos;s ledger. Expand a Digital row (▸ account) for its per-account deposits, transfers, withdrawals and disbursements.
            </p>
          </>
        )}
      </div>
    </AppShell>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<AppShell><div className="py-12 text-center text-gray-400">Loading…</div></AppShell>}>
      <CustodianReportPage />
    </Suspense>
  )
}
