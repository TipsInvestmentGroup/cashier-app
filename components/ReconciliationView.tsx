'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, RECON_TABS } from '@/components/Layout/SectionTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { useApi } from '@/hooks/useApi'
import { formatCurrency, formatDate } from '@/lib/utils'
import { sourceTypesFor, FUND_CLASS_LABELS, type FundClass } from '@/lib/expense-funds'
import toast from 'react-hot-toast'

// The custodian-facing reconciliation view (brief §1 nav items + §6). Read-only:
// it does not re-enter data the existing Cash Reconciliation / Payment
// Verification flows already own — it reconciles a fund's ledger balance against
// its §5 computed balance and shows where the number comes from, flagging any
// mismatch rather than silently overriding it.
interface FundOption { id: string; name: string; sourceType: string; isActive: boolean; fundClass: FundClass | null }
interface LatestRecon { date: string; closingBalance: number; verifiedAmount: number | null; variance: number | null; verifiedBy: string | null }
type ReconStatus = 'RECONCILED' | 'MISMATCH' | 'UNVERIFIABLE'
interface Recon {
  fundingSourceId: string; name: string; sourceType: string; fundClass: FundClass | null
  computedBalance: number; ledgerBalance: number; status: ReconStatus; statusNote: string; mismatchAmount: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  breakdown: Record<string, any>
}

// Three honest states rather than a green/red boolean: a green tick only when an
// independent figure was actually compared and agrees; red only on a real drift;
// neutral when there is nothing independent to check against (see the endpoint).
const STATUS_STYLE: Record<ReconStatus, { border: string; heading: string; icon: string; label: string }> = {
  RECONCILED: { border: 'border-emerald-200 bg-emerald-50', heading: 'text-emerald-700', icon: '✓', label: 'Reconciled' },
  MISMATCH: { border: 'border-red-200 bg-red-50', heading: 'text-red-700', icon: '⚠', label: 'Needs attention' },
  UNVERIFIABLE: { border: 'border-amber-200 bg-amber-50', heading: 'text-amber-700', icon: 'ℹ', label: 'Not independently verifiable' },
}

// Page wrapper: chrome (AppShell + section tabs) around the read-only body.
export function ReconciliationView({ fundClass, title, blurb }: { fundClass: FundClass; title: string; blurb: string }) {
  return (
    <AppShell>
      <SectionTabs tabs={RECON_TABS} />
      <ReconciliationBody fundClass={fundClass} title={title} blurb={blurb} />
    </AppShell>
  )
}

// The read-only custodian view itself (no chrome), so it can be embedded under
// the editable form on the standalone reconciliation pages as well as rendered
// on its own by ReconciliationView above.
export function ReconciliationBody({ fundClass, title, blurb }: { fundClass: FundClass; title: string; blurb: string }) {
  const { request } = useApi()
  const [sources, setSources] = useState<FundOption[]>([])
  const [selected, setSelected] = useState('')
  const [recon, setRecon] = useState<Recon | null>(null)
  const [loading, setLoading] = useState(true)

  const loadSources = useCallback(async () => {
    try {
      const s: FundOption[] = await request('/api/expense/funding-sources')
      const allowed = sourceTypesFor(fundClass) as readonly string[]
      const active = (s || []).filter((x) => x.isActive && allowed.includes(x.sourceType))
      setSources(active)
      setSelected(active.length ? active[0].id : '')
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load funds') }
  }, [request, fundClass])
  useEffect(() => { loadSources() }, [loadSources])

  const loadRecon = useCallback(async () => {
    if (!selected) { setRecon(null); setLoading(false); return }
    setLoading(true)
    try { setRecon(await request(`/api/expense/funding-sources/${selected}/reconciliation`)) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load reconciliation') }
    finally { setLoading(false) }
  }, [request, selected])
  useEffect(() => { loadRecon() }, [loadRecon])

  return (
    <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-gray-500 text-sm">{blurb}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <label className="block max-w-sm">
            <span className="text-xs text-gray-500">{FUND_CLASS_LABELS[fundClass]} fund</span>
            {sources.length ? (
              <select value={selected} onChange={(e) => setSelected(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : (
              <p className="mt-1 text-sm text-gray-400">No {FUND_CLASS_LABELS[fundClass]} fund configured yet — add one in Expense Settings.</p>
            )}
          </label>
        </div>

        {loading ? <div className="py-16 text-center text-gray-400">Loading…</div> : !recon ? (
          <EmptyState icon="⚖️" title="Nothing to reconcile" hint="Select a fund above." />
        ) : (
          <>
            {/* §6: ledger vs computed, mismatch flagged not hidden. */}
            {(() => {
              const s = STATUS_STYLE[recon.status]
              const showDiff = recon.status === 'MISMATCH'
              return (
                <div className={`rounded-2xl p-5 shadow-sm border ${s.border}`}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className={`text-sm font-semibold ${s.heading}`}>{s.icon} {s.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {showDiff && recon.mismatchAmount !== 0 ? `Off by ${formatCurrency(Math.abs(recon.mismatchAmount))}. ` : ''}{recon.statusNote}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Available balance</p>
                      <p className="text-xl font-bold text-gray-900">{formatCurrency(recon.computedBalance)}</p>
                    </div>
                  </div>
                  {/* Only show the ledger-vs-computed comparison when an independent
                      ledger figure actually exists; otherwise it is just the same
                      number twice, which reads as a check that didn't happen. */}
                  {recon.status !== 'UNVERIFIABLE' && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                      <Stat label="Ledger balance" value={recon.ledgerBalance} />
                      <Stat label="Computed (§5)" value={recon.computedBalance} />
                      <Stat label="Difference" value={recon.mismatchAmount} tone={showDiff ? 'red' : undefined} />
                    </div>
                  )}
                </div>
              )
            })()}

            {recon.fundClass === 'CASHIER_CASH' && <CashierBreakdown recon={recon} />}
            {recon.fundClass === 'DIGITAL' && <DigitalBreakdown recon={recon} />}
            {(recon.fundClass === 'PETTY_CASH' || recon.fundClass === null) && <LedgerBreakdown recon={recon} />}
          </>
        )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'red' }) {
  return (
    <div className="bg-white/70 rounded-xl p-3 border border-gray-100">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`text-base font-bold mt-0.5 ${tone === 'red' ? 'text-red-600' : 'text-gray-800'}`}>{formatCurrency(value)}</p>
    </div>
  )
}

function CashierBreakdown({ recon }: { recon: Recon }) {
  const b = recon.breakdown
  const latest: LatestRecon | null = b.latestRecon
  return (
    <>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-800 mb-3">Today&apos;s cash position</h2>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-50">
            <Row label="Opening (yesterday's close)" value={b.opening} />
            <Row label="+ Cash collected from staff today" value={b.cashCollected} />
            <Row label="+ Cash received on paid bills" value={b.paidBillsCash} />
            <Row label="− Cash disbursed today" value={-b.cashExpenses} />
            <Row label="= Available now" value={recon.computedBalance} strong />
          </tbody>
        </table>
        <p className="text-[11px] text-gray-400 mt-2">This is the physical cash the cashier should hold — not the Sales Import total, which is system sales.</p>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-800 mb-1">Last physical count</h2>
        {latest ? (
          latest.verifiedAmount == null ? (
            <p className="text-sm text-gray-500">Recon on {formatDate(latest.date)} closed at {formatCurrency(latest.closingBalance)}, not yet verified against a physical count.</p>
          ) : (
            <p className="text-sm text-gray-600">
              On {formatDate(latest.date)}, counted {formatCurrency(latest.verifiedAmount)} against a computed {formatCurrency(latest.closingBalance)} —{' '}
              <span className={`font-semibold ${(latest.variance ?? 0) === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {(latest.variance ?? 0) === 0 ? 'exact' : `${(latest.variance ?? 0) > 0 ? 'over' : 'short'} by ${formatCurrency(Math.abs(latest.variance ?? 0))}`}
              </span>
              {latest.verifiedBy ? ` (${latest.verifiedBy})` : ''}.
            </p>
          )
        ) : <p className="text-sm text-gray-400">No cash reconciliation recorded for this outlet yet.</p>}
        <p className="text-[11px] text-gray-400 mt-2">Record a physical count in the Cash Reconciliation flow on the Daily screen.</p>
      </div>
    </>
  )
}

function DigitalBreakdown({ recon }: { recon: Recon }) {
  const b = recon.breakdown
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h2 className="font-semibold text-gray-800 mb-3">Digital payments</h2>
      {b.account ? (
        <p className="text-sm text-gray-600 mb-3">Linked account: <span className="font-medium">{b.account.accountName}{b.account.bankName ? ` · ${b.account.bankName}` : ''}</span>. Balance is read live from its GL, so it ties out to the bank statement directly.</p>
      ) : <p className="text-sm text-amber-600 mb-3">No bank account linked — this fund has no external balance to reconcile against.</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total paid" value={b.totalPaid} />
        <div className="bg-white/70 rounded-xl p-3 border border-gray-100"><p className="text-[11px] text-gray-500">Payments</p><p className="text-base font-bold mt-0.5 text-gray-800">{b.paymentCount}</p></div>
        <div className="bg-white/70 rounded-xl p-3 border border-gray-100"><p className="text-[11px] text-gray-500">Verified</p><p className="text-base font-bold mt-0.5 text-emerald-600">{b.verifiedCount}</p></div>
        <div className="bg-white/70 rounded-xl p-3 border border-gray-100"><p className="text-[11px] text-gray-500">Unverified</p><p className={`text-base font-bold mt-0.5 ${b.unverifiedCount > 0 ? 'text-amber-600' : 'text-gray-800'}`}>{b.unverifiedCount}</p></div>
      </div>
      {b.unverifiedCount > 0 && <p className="text-[11px] text-amber-600 mt-2">{b.unverifiedCount} digital payment{b.unverifiedCount === 1 ? '' : 's'} without proof of payment — verify them under Finance → Payment Verifications.</p>}
    </div>
  )
}

function LedgerBreakdown({ recon }: { recon: Recon }) {
  const b = recon.breakdown
  // When the opening predates ledger tracking (seeded fund), the recorded
  // movements don't sum to the total on their own — show that gap explicitly as
  // an opening line rather than letting the arithmetic look wrong.
  const openingLine = b.anchored ? 0 : (b.preLedgerOpening ?? 0)
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h2 className="font-semibold text-gray-800 mb-3">Fund movement</h2>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-50">
          {!b.anchored && <Row label="Opening (before ledger tracking)" value={openingLine} />}
          <Row label="+ Received (allocations)" value={b.received} />
          <Row label="− Paid (disbursements)" value={-b.paid} />
          <Row label="= Closing" value={b.closing} strong />
        </tbody>
      </table>
      {b.anchored && <p className="text-[11px] text-gray-400 mt-2">Every movement since this fund was opened is journaled, so the ledger sums to the balance.</p>}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <tr>
      <td className={`py-2 ${strong ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>{label}</td>
      <td className={`py-2 text-right ${strong ? 'font-bold text-gray-900' : 'text-gray-700'}`}>{formatCurrency(value)}</td>
    </tr>
  )
}
