'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { format } from 'date-fns'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { useAuth } from '@/contexts/AuthContext'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
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
interface Txn {
  id: string; category: string; paymentMethod: string | null; amount: number
  receivingAccount: string | null; reference: string | null; personName: string | null; status: string; createdAt: string
}
interface TargetRow {
  department: string; unit: string; unitLabel: string | null
  dailyTarget: number; actual: number; achievementPct: number; remaining: number; status: string
}
interface Dashboard {
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
}

const STATUS_COLOR: Record<string, string> = { BELOW_TARGET: 'bg-red-500', ON_TARGET: 'bg-amber-500', ABOVE_TARGET: 'bg-emerald-500' }
const STATUS_TEXT: Record<string, string> = { BELOW_TARGET: 'Below Target', ON_TARGET: 'On Target', ABOVE_TARGET: 'Above Target' }

export default function MyTransactionsPage() {
  const { user } = useAuth()
  const { request } = useApi()
  const [data, setData] = useState<Dashboard | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

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
            </div>

            {data.signedBillsAfter && (
              <DrillCard
                title="Signed Bills" expandKey="signed" expanded={expanded} setExpanded={setExpanded}
                tiles={[
                  { label: 'Issued', value: data.signedBillsAfter.issuedCount, isCount: true },
                  { label: 'Approved', value: data.signedBillsAfter.approvedCount, isCount: true },
                  { label: 'Pending', value: data.signedBillsAfter.pendingCount, isCount: true },
                  { label: 'Rejected', value: data.signedBillsAfter.rejectedCount, isCount: true },
                  { label: 'Paid', value: data.signedBillsAfter.paidAmount },
                  { label: 'Outstanding', value: data.signedBillsAfter.outstandingAmount },
                ]}
              >
                {data.signedBillsAfter.records.length === 0 ? <EmptyRow /> : data.signedBillsAfter.records.map((r) => (
                  <RecordRow key={r.id} label={r.personName} sub={r.displayReference || undefined} amount={r.amount} status={r.status} />
                ))}
              </DrillCard>
            )}

            {data.discountsAfter && (
              <DrillCard
                title="Discounts" expandKey="discounts" expanded={expanded} setExpanded={setExpanded}
                tiles={[
                  { label: 'Issued', value: data.discountsAfter.count, isCount: true },
                  { label: 'Approved', value: data.discountsAfter.approved, isCount: true },
                  { label: 'Pending', value: data.discountsAfter.pending, isCount: true },
                  { label: 'Rejected', value: data.discountsAfter.rejected, isCount: true },
                ]}
              >
                {data.discountsAfter.records.length === 0 ? <EmptyRow /> : data.discountsAfter.records.map((r) => (
                  <RecordRow key={r.id} label={format(new Date(r.createdAt), 'HH:mm')} sub={r.reference || undefined} amount={r.amount} status={r.status} />
                ))}
              </DrillCard>
            )}

            {data.cancellationsAfter && (
              <DrillCard
                title="Cancellations" expandKey="cancellations" expanded={expanded} setExpanded={setExpanded}
                tiles={[
                  { label: 'Requested', value: data.cancellationsAfter.count, isCount: true },
                  { label: 'Approved', value: data.cancellationsAfter.approved, isCount: true },
                  { label: 'Pending', value: data.cancellationsAfter.pending, isCount: true },
                  { label: 'Rejected', value: data.cancellationsAfter.rejected, isCount: true },
                ]}
              >
                {data.cancellationsAfter.records.length === 0 ? <EmptyRow /> : data.cancellationsAfter.records.map((r) => (
                  <RecordRow key={r.id} label={format(new Date(r.createdAt), 'HH:mm')} sub={r.reference || undefined} amount={r.amount} status={r.status} />
                ))}
              </DrillCard>
            )}

            {data.paidBills && (
              <DrillCard
                title="Paid Bills" expandKey="paidbills" expanded={expanded} setExpanded={setExpanded}
                tiles={[
                  { label: 'Bills Collected', value: data.paidBills.billsCollectedCount, isCount: true },
                  { label: 'Bills Paid', value: data.paidBills.billsPaidAmount },
                  { label: 'Outstanding', value: data.paidBills.outstandingAmount },
                  { label: 'Staff Loss Recovery', value: data.paidBills.staffLossRecoveryAmount },
                ]}
              >
                {data.paidBills.records.length === 0 ? <EmptyRow /> : data.paidBills.records.map((r) => (
                  <RecordRow key={r.id} label={r.payerName} sub={r.paymentMethod} amount={r.amountPaid} />
                ))}
              </DrillCard>
            )}

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

function EmptyRow() {
  return <p className="py-4 text-center text-gray-400 text-xs">Nothing here</p>
}

function RecordRow({ label, sub, amount, status }: { label: string; sub?: string; amount: number; status?: string }) {
  return (
    <div className="py-2 flex items-center justify-between gap-2 text-sm">
      <div>
        <span className="font-medium text-gray-700">{label}</span>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
      <div className="flex items-center gap-2">
        <span className="font-semibold text-gray-900">{formatCurrency(amount)}</span>
        {status && <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLE[status] || 'bg-gray-100 text-gray-600'}`}>{status.replace('_', ' ')}</span>}
      </div>
    </div>
  )
}

function DrillCard({
  title, tiles, children, expandKey, expanded, setExpanded,
}: {
  title: string; tiles: { label: string; value: number; isCount?: boolean }[]; children: React.ReactNode
  expandKey: string; expanded: string | null; setExpanded: (k: string | null) => void
}) {
  const isOpen = expanded === expandKey
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <button onClick={() => setExpanded(isOpen ? null : expandKey)} className="w-full flex items-center justify-between p-5 pb-3 text-left">
        <h2 className="font-semibold text-gray-800">{title}</h2>
        <span className="text-xs text-indigo-600 font-semibold">{isOpen ? 'Hide details' : 'View details'}</span>
      </button>
      <div className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        {tiles.map((t) => (
          <div key={t.label} className="bg-gray-50 rounded-lg px-2.5 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{t.label}</p>
            <p className="font-semibold text-gray-800">{t.isCount ? t.value : formatCurrency(t.value)}</p>
          </div>
        ))}
      </div>
      {isOpen && <div className="border-t border-gray-100 px-5 py-2 bg-gray-50/60 divide-y divide-gray-100">{children}</div>}
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
