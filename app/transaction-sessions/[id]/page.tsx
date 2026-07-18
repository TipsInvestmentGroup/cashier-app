'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { format } from 'date-fns'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, DAILY_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import toast from 'react-hot-toast'

interface Approval { id: string; status: string; approverRole: string; comment: string | null }
interface Txn {
  id: string; category: string; paymentMethod: string | null; amount: number
  receivingAccount: string | null; reference: string | null; status: string; createdAt: string
  staff: { id: string; name: string }; approvals: Approval[]
}
interface SystemSalesRow { id: string; staffId: string | null; staffName: string; amount: number }
interface SessionDetail {
  id: string; date: string; status: string
  outlet: { name: string }
  systemSales: SystemSalesRow[]
  transactions: Txn[]
  validatedCollections: { id: string; staffName: string | null }[]
}

interface StaffSummary {
  staffId: string; staffName: string; systemSales: number
  cash: number; channelTotals: Record<string, number>
  signedBills: number; discounts: number; cancellations: number; creditSales: number
  grandTotal: number; pendingApprovals: number; validated: boolean
  transactions: Txn[]
}

function buildSummaries(session: SessionDetail): StaffSummary[] {
  const byStaff = new Map<string, StaffSummary>()
  const validatedNames = new Set(session.validatedCollections.map((c) => c.staffName))

  const ensure = (staffId: string, staffName: string) => {
    let s = byStaff.get(staffId)
    if (!s) {
      s = { staffId, staffName, systemSales: 0, cash: 0, channelTotals: {}, signedBills: 0, discounts: 0, cancellations: 0, creditSales: 0, grandTotal: 0, pendingApprovals: 0, validated: validatedNames.has(staffName), transactions: [] }
      byStaff.set(staffId, s)
    }
    return s
  }

  for (const row of session.systemSales) {
    if (!row.staffId) continue
    const s = ensure(row.staffId, row.staffName)
    s.systemSales += row.amount
  }

  for (const t of session.transactions) {
    const s = ensure(t.staff.id, t.staff.name)
    s.transactions.push(t)
    if (t.status === 'REJECTED') continue
    if (t.status === 'PENDING_APPROVAL') { s.pendingApprovals += 1; continue }
    if (t.category === 'PAYMENT') {
      if ((t.paymentMethod || 'CASH') === 'CASH') s.cash += t.amount
      else s.channelTotals[t.paymentMethod!] = (s.channelTotals[t.paymentMethod!] || 0) + t.amount
      s.grandTotal += t.amount
    } else if (t.category === 'SIGNED_BILL') { s.signedBills += t.amount; s.grandTotal += t.amount }
    else if (t.category === 'DISCOUNT') { s.discounts += t.amount }
    else if (t.category === 'CANCELLATION') { s.cancellations += t.amount }
    else if (t.category === 'CREDIT_SALE') { s.creditSales += t.amount; s.grandTotal += t.amount }
  }

  return [...byStaff.values()].sort((a, b) => a.staffName.localeCompare(b.staffName))
}

export default function TransactionSessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { request } = useApi()
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setSession(await request(`/api/transaction-sessions/${id}`)) } finally { setLoading(false) }
  }, [request, id])

  useEffect(() => { load() }, [load])

  const summaries = useMemo(() => (session ? buildSummaries(session) : []), [session])

  const decide = async (staffId: string, decision: 'VALIDATE' | 'REJECT') => {
    setActing(staffId)
    try {
      await request(`/api/transaction-sessions/${id}/validate`, { method: 'POST', body: JSON.stringify({ staffId, decision }) })
      toast.success(decision === 'VALIDATE' ? 'Validated — now the official Daily Collection' : 'Rejected')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save decision')
    } finally { setActing(null) }
  }

  if (loading) return <AppShell><SectionTabs tabs={DAILY_TABS} /><div className="py-10 text-center text-gray-400">Loading…</div></AppShell>
  if (!session) return <AppShell><SectionTabs tabs={DAILY_TABS} /><div className="py-10 text-center text-gray-400">Session not found</div></AppShell>

  return (
    <AppShell>
      <SectionTabs tabs={DAILY_TABS} />
      <div className="max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{format(new Date(session.date), 'EEE, dd MMM yyyy')} · {session.outlet.name}</h1>
          <p className="text-gray-500 text-sm">Review each staff member&apos;s summarized declarations and validate — no re-entry needed.</p>
        </div>

        {summaries.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center text-sm text-gray-400">
            No staff yet — import System Sales, then staff can start declaring transactions.
          </div>
        ) : (
          <div className="space-y-3">
            {summaries.map((s) => {
              const isOpen = expanded === s.staffId
              const diff = s.systemSales - s.grandTotal - s.discounts - s.cancellations
              return (
                <div key={s.staffId} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <button onClick={() => setExpanded(isOpen ? null : s.staffId)} className="w-full flex items-center justify-between gap-3 p-4 text-left">
                    <div>
                      <p className="font-semibold text-gray-800">{s.staffName}</p>
                      <p className="text-xs text-gray-400">System Sales {formatCurrency(s.systemSales)} · Declared {formatCurrency(s.grandTotal)}
                        {diff !== 0 && <span className={diff > 0 ? ' text-amber-600' : ' text-red-600'}> · Diff {formatCurrency(diff)}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.pendingApprovals > 0 && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-[11px] font-semibold rounded-full">{s.pendingApprovals} pending</span>}
                      {s.validated ? (
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[11px] font-semibold rounded-full">Validated</span>
                      ) : (
                        <span className="text-sm font-bold text-gray-900">{formatCurrency(s.grandTotal)}</span>
                      )}
                      {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </div>
                  </button>

                  <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <SummaryTile label="Cash" value={s.cash} />
                    {Object.entries(s.channelTotals).map(([code, amt]) => <SummaryTile key={code} label={code} value={amt} />)}
                    <SummaryTile label="Signed Bills" value={s.signedBills} />
                    <SummaryTile label="Discounts" value={s.discounts} />
                    <SummaryTile label="Cancellations" value={s.cancellations} />
                    <SummaryTile label="Credit Sales" value={s.creditSales} />
                  </div>

                  {isOpen && (
                    <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/60">
                      <p className="text-xs font-semibold text-gray-500 mb-2">Transaction detail</p>
                      <div className="divide-y divide-gray-100">
                        {s.transactions.map((t) => (
                          <div key={t.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                            <div>
                              <span className="font-medium text-gray-700">{format(new Date(t.createdAt), 'HH:mm')} · {t.category.replace('_', ' ')}{t.paymentMethod ? ` · ${t.paymentMethod}` : ''}</span>
                              <p className="text-xs text-gray-400">{t.receivingAccount || t.reference || '—'}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-gray-900">{formatCurrency(t.amount)}</span>
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600">{t.status.replace('_', ' ')}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!s.validated && (
                    <div className="flex gap-2 px-4 pb-4">
                      <button disabled={acting === s.staffId || s.pendingApprovals > 0 || s.transactions.length === 0}
                        onClick={() => decide(s.staffId, 'VALIDATE')}
                        className="flex-1 px-3 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-40">
                        Validate
                      </button>
                      <button disabled={acting === s.staffId || s.transactions.length === 0}
                        onClick={() => decide(s.staffId, 'REJECT')}
                        className="px-3 py-2 bg-red-50 text-red-700 text-sm font-semibold rounded-xl hover:bg-red-100 disabled:opacity-40">
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 rounded-lg px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
      <p className="font-semibold text-gray-800">{formatCurrency(value)}</p>
    </div>
  )
}
