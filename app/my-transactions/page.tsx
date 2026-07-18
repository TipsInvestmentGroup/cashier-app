'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { format, parse as parseDate } from 'date-fns'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { useAuth } from '@/contexts/AuthContext'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import { WidgetGrid } from '@/components/widgets/WidgetGrid'
import { MY_TRANSACTIONS_DRILL_WIDGETS } from './widgets'
import toast from 'react-hot-toast'

const NEEDS_PAYER = new Set(['SIGNED_BILL', 'CREDIT_SALE'])
const CATEGORIES = [
  { value: 'PAYMENT', label: 'Payment' },
  { value: 'SIGNED_BILL', label: 'Signed Bill Payment' },
  { value: 'DISCOUNT', label: 'Discount' },
  { value: 'CANCELLATION', label: 'Cancellation' },
  { value: 'CREDIT_SALE', label: 'Credit Sale' },
]
const STATUS_STYLE: Record<string, string> = {
  DECLARED: 'bg-gray-100 text-gray-600',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-700',
}

interface Channel { code: string; label: string }
export interface Txn {
  id: string; category: string; paymentMethod: string | null; amount: number
  receivingAccount: string | null; reference: string | null; personName: string | null; status: string; createdAt: string
}
interface TargetRow {
  department: string; unit: string; unitLabel: string | null
  dailyTarget: number; actual: number; achievementPct: number; remaining: number; status: string
}
export interface Dashboard {
  date: string; outletName: string; mode: 'NO_SESSION' | 'BEFORE' | 'AFTER'
  // BEFORE
  sessionStatus?: string; systemSales?: number; declaredTotal?: number; difference?: number
  cash?: number; bank?: number; mobileMoney?: number; channelTotals?: Record<string, number>
  signedBills?: number; discounts?: number; cancellations?: number; pendingApprovals?: number
  transactions?: Txn[]; readiness?: { ready: boolean; blockers: string[] }
  // AFTER
  collection?: { expectedSales: number; official: number; difference: number; cash: number; bank: number; mobileMoney: number; grandTotal: number }
  signedBillsAfter?: { issuedCount: number; issuedAmount: number; approvedCount: number; pendingCount: number; rejectedCount: number; paidCount: number; paidAmount: number; outstandingAmount: number; records: { id: string; personName: string; amount: number; status: string; displayReference: string | null }[] }
  discountsAfter?: { count: number; amount: number; approved: number; pending: number; rejected: number; records: Txn[] }
  cancellationsAfter?: { count: number; amount: number; approved: number; pending: number; rejected: number; records: Txn[] }
  paidBills?: { billsCollectedCount: number; billsPaidAmount: number; outstandingAmount: number; staffLossRecoveryAmount: number; records: { id: string; payerName: string; amountPaid: number; paymentMethod: string; date: string }[] }
  dailyLoss?: { expectedSales: number; official: number; variance: number; lossPaidToday: number; outstandingLossBalance: number }
  target?: TargetRow[]
  insights?: {
    collection: { text: string; status: 'good' | 'bad' | 'neutral' } | null
    loss: { text: string; recommendation?: string } | null
    target: { text: string } | null
    peakHour: { text: string } | null
  }
}

const STATUS_COLOR: Record<string, string> = { BELOW_TARGET: 'bg-red-500', ON_TARGET: 'bg-amber-500', ABOVE_TARGET: 'bg-emerald-500' }
const STATUS_TEXT: Record<string, string> = { BELOW_TARGET: 'Below Target', ON_TARGET: 'On Target', ABOVE_TARGET: 'Above Target' }

interface HourBucket { hour: number; label: string; amount: number; count: number; avgValue: number }
interface DayFigures { date: string; total: number; validated: boolean; signedBills: number; discounts: number; cancellations: number; dailyLoss: number | null; transactionCount: number; avgTransactionValue: number }
interface DayOverDay {
  today: DayFigures; yesterday: DayFigures
  salesChangePct: number | null; avgTransactionChangePct: number | null
  transactionsServed: number; transactionsServedYesterday: number
  signedBillsChangePct: number | null; discountsChangePct: number | null; cancellationsChangePct: number | null; dailyLossChangePct: number | null
}
interface Trends { series: { date: string; total: number }[]; last7: { average: number; best: { date: string; total: number } | null; lowest: { date: string; total: number } | null }; last30: { average: number; best: { date: string; total: number } | null; lowest: { date: string; total: number } | null } }
interface Analytics { hourly: { buckets: HourBucket[]; peakHour: HourBucket | null; slowHour: HourBucket | null }; dayOverDay: DayOverDay; trends: Trends }

export default function MyTransactionsPage() {
  const { user } = useAuth()
  const { request } = useApi()
  const [data, setData] = useState<Dashboard | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [category, setCategory] = useState('PAYMENT')
  const [paymentMethod, setPaymentMethod] = useState('CASH')
  const [amount, setAmount] = useState('')
  const [receivingAccount, setReceivingAccount] = useState('')
  const [reference, setReference] = useState('')
  const [personName, setPersonName] = useState('')

  const formRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [showPendingOnly, setShowPendingOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [d, chans] = await Promise.all([request('/api/my-dashboard'), request('/api/payment-channels')])
      setData(d)
      setChannels((chans || []).filter((c: { isActive: boolean }) => c.isActive))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load dashboard')
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  // Loaded separately and lazily — the heavier historical queries (30-day
  // window, yesterday lookup) shouldn't hold up the dashboard's first paint.
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  useEffect(() => {
    if (!data || data.mode === 'NO_SESSION') return
    request('/api/my-dashboard/analytics').then(setAnalytics).catch(() => {})
  }, [data, request])

  // /api/my-dashboard resolves the session server-side but doesn't expose its
  // id (the dashboard payload is deliberately read-model-only) — fetch it
  // once more here so the capture form knows which session to post against.
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)
  useEffect(() => {
    if (data?.mode !== 'BEFORE' || !user?.outlet?.id) return
    const today = format(new Date(), 'yyyy-MM-dd')
    request(`/api/transaction-sessions?outletId=${user.outlet.id}&from=${today}&to=${today}`).then((s) => setOpenSessionId(s?.[0]?.id || null)).catch(() => {})
  }, [data?.mode, request, user?.outlet?.id])

  const submit = async () => {
    if (!openSessionId) return
    const amt = Number(amount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    if (category === 'PAYMENT' && !paymentMethod) return toast.error('Select a payment method')
    if (NEEDS_PAYER.has(category) && !personName.trim()) return toast.error('Enter the payer/customer name')
    setSaving(true)
    try {
      await request('/api/staff-transactions', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: openSessionId, category,
          paymentMethod: category === 'PAYMENT' ? paymentMethod : null,
          amount: amt, receivingAccount: receivingAccount || null, reference: reference || null,
          personName: NEEDS_PAYER.has(category) ? personName.trim() : null,
        }),
      })
      toast.success('Transaction declared')
      setAmount(''); setReceivingAccount(''); setReference(''); setPersonName('')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally { setSaving(false) }
  }

  const remove = async (id: string) => {
    try { await request(`/api/staff-transactions/${id}`, { method: 'DELETE' }); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not delete') }
  }

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  if (loading) return <AppShell><SectionTabs tabs={MYPOS_TABS} /><div className="py-10 text-center text-gray-400">Loading…</div></AppShell>
  if (!data) return <AppShell><SectionTabs tabs={MYPOS_TABS} /><div className="py-10 text-center text-gray-400">Could not load dashboard</div></AppShell>

  return (
    <AppShell>
      <SectionTabs tabs={MYPOS_TABS} />
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Dashboard</h1>
          <p className="text-gray-500 text-sm">{format(new Date(data.date), 'EEE, dd MMM yyyy')} · {data.outletName}</p>
        </div>

        {data.mode === 'NO_SESSION' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center text-sm text-gray-500">
            Today&apos;s session hasn&apos;t been opened yet. Ask your cashier to import System Sales for today first.
          </div>
        )}

        {data.mode === 'BEFORE' && (
          <>
            {/* Readiness banner */}
            <div className={`rounded-2xl p-4 border ${data.readiness?.ready ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
              <p className={`text-sm font-semibold ${data.readiness?.ready ? 'text-emerald-800' : 'text-amber-800'}`}>
                {data.readiness?.ready ? '✅ Ready for cashier validation' : '⏳ Not ready for validation yet'}
              </p>
              {!data.readiness?.ready && (
                <ul className="mt-1 text-xs text-amber-700 list-disc list-inside">
                  {data.readiness?.blockers.map((b) => <li key={b}>{b}</li>)}
                </ul>
              )}
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <QuickAction label="Add Transaction" onClick={() => scrollTo(formRef)} />
              <QuickAction label="Today's Transactions" onClick={() => { setShowPendingOnly(false); scrollTo(listRef) }} />
              <QuickAction label="Submit Missing" onClick={() => scrollTo(formRef)} />
              <QuickAction label="Pending Approvals" onClick={() => { setShowPendingOnly(true); scrollTo(listRef) }} badge={data.pendingApprovals || undefined} />
            </div>

            {/* Summary cards */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800">Working Summary</h2>
                {(data.difference || 0) !== 0 && (
                  <span className={`text-xs font-semibold ${(data.difference || 0) > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                    Diff {formatCurrency(data.difference || 0)}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <Tile label="Expected Sales" value={data.systemSales || 0} />
                <Tile label="Declared Total" value={data.declaredTotal || 0} />
                <Tile label="Cash" value={data.cash || 0} />
                <Tile label="Bank" value={data.bank || 0} />
                <Tile label="Mobile Money" value={data.mobileMoney || 0} />
                <Tile label="Signed Bills" value={data.signedBills || 0} />
                <Tile label="Discounts" value={data.discounts || 0} />
                <Tile label="Cancellations" value={data.cancellations || 0} />
              </div>
            </div>

            {/* Target */}
            {data.target && data.target.length > 0 && <TargetSection target={data.target} />}

            {/* Capture form */}
            <div ref={formRef} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 space-y-3">
              <h2 className="font-semibold text-gray-800">Declare Transaction</h2>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Type</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              {category === 'PAYMENT' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Payment Method</label>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
                    <option value="CASH">Cash</option>
                    {channels.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                </div>
              )}
              {NEEDS_PAYER.has(category) && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Payer / Customer Name</label>
                  <input value={personName} onChange={(e) => setPersonName(e.target.value)}
                    placeholder="e.g. John Customer" className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Amount</label>
                <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
                  placeholder="0" className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-lg font-semibold focus:border-indigo-500 focus:outline-none" />
              </div>
              {category === 'PAYMENT' && paymentMethod !== 'CASH' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Receiving Account / Till</label>
                  <input value={receivingAccount} onChange={(e) => setReceivingAccount(e.target.value)}
                    placeholder="e.g. 0150-XXXX" className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Reference Number (optional)</label>
                <input value={reference} onChange={(e) => setReference(e.target.value)}
                  className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
              </div>
              <button onClick={submit} disabled={saving || !openSessionId}
                className="mt-1 w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50">
                {saving ? 'Saving…' : 'Declare Transaction'}
              </button>
            </div>

            {/* Transactions list */}
            <div ref={listRef} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800">{showPendingOnly ? 'Pending Approval Requests' : "Today's Transactions"}</h2>
                {showPendingOnly && <button onClick={() => setShowPendingOnly(false)} className="text-xs text-indigo-600 font-semibold">Show all</button>}
              </div>
              {(() => {
                const list = (data.transactions || []).filter((t) => !showPendingOnly || t.status === 'PENDING_APPROVAL')
                if (list.length === 0) return <p className="py-6 text-center text-gray-400 text-sm">{showPendingOnly ? 'Nothing pending' : 'No transactions declared yet'}</p>
                return (
                  <div className="divide-y divide-gray-50">
                    {list.map((t) => (
                      <div key={t.id} className="py-2.5 flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-gray-800">
                            {CATEGORIES.find((c) => c.value === t.category)?.label}{t.paymentMethod ? ` · ${t.paymentMethod}` : ''}
                          </p>
                          <p className="text-xs text-gray-400">{format(new Date(t.createdAt), 'HH:mm')} · {t.personName || t.receivingAccount || t.reference || '—'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900">{formatCurrency(t.amount)}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLE[t.status] || 'bg-gray-100 text-gray-600'}`}>{t.status.replace('_', ' ')}</span>
                          {t.status === 'DECLARED' && <button onClick={() => remove(t.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          </>
        )}

        {data.mode === 'AFTER' && data.collection && (
          <>
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
              <p className="text-sm font-semibold text-emerald-800">✅ Validated — this is your official Daily Collection (read-only)</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-800 mb-3">Daily Collection</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <Tile label="Expected Sales" value={data.collection.expectedSales} />
                <Tile label="Official Collection" value={data.collection.official} />
                <Tile label="Difference" value={data.collection.difference} accent={data.collection.difference !== 0} />
                <Tile label="Grand Total" value={data.collection.grandTotal} />
                <Tile label="Cash" value={data.collection.cash} />
                <Tile label="Bank" value={data.collection.bank} />
                <Tile label="Mobile Money" value={data.collection.mobileMoney} />
              </div>
              {data.insights && <InsightStrip insights={data.insights} />}
            </div>

            <WidgetGrid defs={MY_TRANSACTIONS_DRILL_WIDGETS} data={data} role={user?.role || ''} className="space-y-5" />

            {data.dailyLoss && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
                <h2 className="font-semibold text-gray-800 mb-3">Daily Loss Summary</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  <Tile label="Expected Sales" value={data.dailyLoss.expectedSales} />
                  <Tile label="Official Collection" value={data.dailyLoss.official} />
                  <Tile label={data.dailyLoss.variance >= 0 ? 'Daily Loss' : 'Over Collection'} value={Math.abs(data.dailyLoss.variance)} accent={data.dailyLoss.variance !== 0} />
                  <Tile label="Loss Paid Today" value={data.dailyLoss.lossPaidToday} />
                  <Tile label="Outstanding Loss Balance" value={data.dailyLoss.outstandingLossBalance} />
                </div>
              </div>
            )}

            {data.target && data.target.length > 0 && <TargetSection target={data.target} />}
          </>
        )}

        {analytics && data.mode !== 'NO_SESSION' && <AnalyticsSection analytics={analytics} />}
      </div>
    </AppShell>
  )
}

function QuickAction({ label, onClick, badge }: { label: string; onClick: () => void; badge?: number }) {
  return (
    <button onClick={onClick} className="relative px-3 py-3 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 transition-all">
      {label}
      {!!badge && <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">{badge}</span>}
    </button>
  )
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-gray-50 rounded-lg px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
      <p className={`font-semibold ${accent ? 'text-amber-700' : 'text-gray-800'}`}>{formatCurrency(value)}</p>
    </div>
  )
}

/** BI-layer insight lines under the Daily Collection card — additive, no layout change if absent. */
function InsightStrip({ insights }: { insights: NonNullable<Dashboard['insights']> }) {
  const lines = [
    insights.collection && { text: insights.collection.text, tone: insights.collection.status },
    insights.target && { text: insights.target.text, tone: 'neutral' as const },
    insights.peakHour && { text: insights.peakHour.text, tone: 'neutral' as const },
    insights.loss && { text: insights.loss.recommendation ? `${insights.loss.text} — ${insights.loss.recommendation}` : insights.loss.text, tone: insights.loss.recommendation ? 'bad' as const : 'neutral' as const },
  ].filter(Boolean) as { text: string; tone: 'good' | 'bad' | 'neutral' }[]
  if (!lines.length) return null
  const toneClass = { good: 'text-emerald-700', bad: 'text-red-600', neutral: 'text-gray-500' }
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
      {lines.map((l, i) => <p key={i} className={`text-xs font-medium ${toneClass[l.tone]}`}>{l.text}</p>)}
    </div>
  )
}

function TargetSection({ target }: { target: TargetRow[] }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 space-y-4">
      <h2 className="font-semibold text-gray-800">Sales Target Performance</h2>
      {target.map((t) => (
        <div key={t.department}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-medium text-gray-700">{t.department}</span>
            <span className={`font-semibold ${t.status === 'BELOW_TARGET' ? 'text-red-600' : t.status === 'ON_TARGET' ? 'text-amber-600' : 'text-emerald-600'}`}>{STATUS_TEXT[t.status]} · {t.achievementPct}%</span>
          </div>
          <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${STATUS_COLOR[t.status]}`} style={{ width: `${Math.min(100, t.achievementPct)}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-gray-400 mt-1">
            <span>{t.unit === 'COUNT' ? `${t.actual} / ${t.dailyTarget} ${t.unitLabel || ''}` : `${formatCurrency(t.actual)} / ${formatCurrency(t.dailyTarget)}`}</span>
            <span>Remaining: {t.unit === 'COUNT' ? `${t.remaining} ${t.unitLabel || ''}` : formatCurrency(t.remaining)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function ChangeIndicator({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-400 text-xs font-semibold">➖ n/a</span>
  if (pct > 0) return <span className="text-emerald-600 text-xs font-semibold">▲ {pct}%</span>
  if (pct < 0) return <span className="text-red-600 text-xs font-semibold">▼ {Math.abs(pct)}%</span>
  return <span className="text-gray-400 text-xs font-semibold">➖ 0%</span>
}

function AnalyticsSection({ analytics }: { analytics: Analytics }) {
  const [trendWindow, setTrendWindow] = useState<7 | 30>(7)
  const { hourly, dayOverDay, trends } = analytics
  const chartData = trendWindow === 7 ? trends.series.slice(-7) : trends.series
  const summary = trendWindow === 7 ? trends.last7 : trends.last30

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-gray-900 pt-2">Insights &amp; Analytics</h2>

      {/* Time vs Time */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-1">Time vs Time (Today)</h3>
        <p className="text-xs text-gray-400 mb-3">Sales and Collections are the same figure until MyPOS provides a separate per-period system-sales feed.</p>
        {hourly.buckets.length === 0 ? (
          <p className="py-6 text-center text-gray-400 text-sm">No transactions declared yet today</p>
        ) : (
          <div className="space-y-2">
            {hourly.buckets.map((b) => {
              const isPeak = hourly.peakHour?.hour === b.hour
              const isSlow = hourly.slowHour?.hour === b.hour && hourly.buckets.length > 1
              const maxAmount = hourly.peakHour?.amount || 1
              return (
                <div key={b.hour} className={`rounded-xl p-2.5 ${isPeak ? 'bg-emerald-50 border border-emerald-200' : isSlow ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}`}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold text-gray-700">{b.label}{isPeak && ' · Peak'}{isSlow && ' · Slowest'}</span>
                    <span className="text-gray-500">{b.count} txn{b.count !== 1 ? 's' : ''} · avg {formatCurrency(b.avgValue)}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${isPeak ? 'bg-emerald-500' : isSlow ? 'bg-amber-500' : 'bg-indigo-400'}`} style={{ width: `${Math.max(4, (b.amount / maxAmount) * 100)}%` }} />
                  </div>
                  <p className="text-right text-xs font-semibold text-gray-800 mt-1">{formatCurrency(b.amount)}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Day-over-Day */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-3">Day-over-Day (vs Yesterday)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <DoDTile label="Sales" pct={dayOverDay.salesChangePct} value={formatCurrency(dayOverDay.today.total)} />
          <DoDTile label="Avg Transaction" pct={dayOverDay.avgTransactionChangePct} value={formatCurrency(dayOverDay.today.avgTransactionValue)} />
          <DoDTile label="Transactions Served" pct={null} value={`${dayOverDay.transactionsServed} (was ${dayOverDay.transactionsServedYesterday})`} />
          <DoDTile label="Signed Bills" pct={dayOverDay.signedBillsChangePct} value={formatCurrency(dayOverDay.today.signedBills)} />
          <DoDTile label="Discounts" pct={dayOverDay.discountsChangePct} value={formatCurrency(dayOverDay.today.discounts)} />
          <DoDTile label="Cancellations" pct={dayOverDay.cancellationsChangePct} value={formatCurrency(dayOverDay.today.cancellations)} />
          {dayOverDay.today.dailyLoss !== null && (
            <DoDTile label="Daily Loss" pct={dayOverDay.dailyLossChangePct} value={formatCurrency(dayOverDay.today.dailyLoss)} />
          )}
        </div>
      </div>

      {/* Performance Trends */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">Performance Trends</h3>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {([7, 30] as const).map((w) => (
              <button key={w} onClick={() => setTrendWindow(w)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md ${trendWindow === w ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}>
                {w} Days
              </button>
            ))}
          </div>
        </div>
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">No validated days yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorStaffTrend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => format(parseDate(d, 'yyyy-MM-dd', new Date()), 'dd MMM')} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} labelFormatter={(d) => format(parseDate(d, 'yyyy-MM-dd', new Date()), 'dd MMM yyyy')} />
              <Area type="monotone" dataKey="total" stroke="#6366f1" fill="url(#colorStaffTrend)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
        <div className="grid grid-cols-3 gap-2 text-xs mt-3">
          <Tile label={`Avg (${trendWindow}d)`} value={summary.average} />
          <Tile label="Best Day" value={summary.best?.total || 0} />
          <Tile label="Lowest Day" value={summary.lowest?.total || 0} />
        </div>
      </div>
    </div>
  )
}

function DoDTile({ label, pct, value }: { label: string; pct: number | null; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-0.5">{label}</p>
      <p className="font-semibold text-gray-800">{value}</p>
      <ChangeIndicator pct={pct} />
    </div>
  )
}
