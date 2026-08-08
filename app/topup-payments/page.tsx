'use client'
import { useEffect, useState, useCallback, Suspense, Fragment } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, PETTY_TABS } from '@/components/Layout/SectionTabs'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useApi } from '@/hooks/useApi'
import { formatCurrency, formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'

interface QueueRow {
  id: string; purpose: string; amount: number; currency: string; reference: string | null
  requestedById: string; createdAt: string; fundingSourceId: string | null; fundName: string | null
}
interface Queue { count: number; totalPending: number; rows: QueueRow[] }
interface FundingSource {
  id: string; name: string; sourceType: string; companyPaymentAccountId: string | null
  companyPaymentAccount?: { id: string; accountName: string; bankName: string | null } | null
}

const DIGITAL_TYPES = ['BANK', 'MOBILE_MONEY', 'CARD']

// The Digital Expenses Custodian's "awaiting payment" queue (Spec v2 §2.2): the
// direction=IN sibling of a fund's Ready-to-Pay list. Each row is an approved
// Petty Cash top-up waiting for the custodian to pay it out of a digital account,
// which posts both money-flow sides atomically (execute-topup endpoint).
function TopUpPaymentsPage() {
  const { request } = useApi()
  const [queue, setQueue] = useState<Queue | null>(null)
  const [accounts, setAccounts] = useState<{ id: string; label: string }[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [payingId, setPayingId] = useState('')      // which row's pay panel is open
  const [chosenAccount, setChosenAccount] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadQueue = useCallback(async () => {
    setLoading(true)
    try { setQueue(await request('/api/expense/topup-payments')) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load the queue') }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { loadQueue() }, [loadQueue])

  // Digital accounts the custodian can pay FROM — derived from the digital
  // funding sources (each wraps one CompanyPaymentAccount).
  useEffect(() => {
    request('/api/expense/funding-sources').then((s: FundingSource[] | null) => {
      const opts = (s || [])
        .filter((x) => DIGITAL_TYPES.includes(x.sourceType) && x.companyPaymentAccountId)
        .map((x) => ({ id: x.companyPaymentAccountId as string, label: x.companyPaymentAccount ? `${x.name} — ${x.companyPaymentAccount.accountName}${x.companyPaymentAccount.bankName ? ` (${x.companyPaymentAccount.bankName})` : ''}` : x.name }))
      setAccounts(opts)
    }).catch(() => {})
  }, [request])

  useEffect(() => {
    request('/api/users').then((us: { id: string; name: string }[] | null) => {
      setNames(Object.fromEntries((us || []).map((u) => [u.id, u.name])))
    }).catch(() => {})
  }, [request])

  const openPay = (id: string) => { setPayingId(id); setChosenAccount(accounts[0]?.id || '') }

  const pay = async (row: QueueRow) => {
    if (!chosenAccount) return toast.error('Choose a digital account to pay from')
    setSubmitting(true)
    const t = toast.loading('Paying top-up…')
    try {
      await request(`/api/expense/requests/${row.id}/execute-topup`, { method: 'POST', body: JSON.stringify({ companyPaymentAccountId: chosenAccount }) })
      toast.success('Top-up paid — fund credited and transfer recorded', { id: t })
      setPayingId('')
      loadQueue()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not pay top-up', { id: t }) }
    finally { setSubmitting(false) }
  }

  return (
    <AppShell>
      <SectionTabs tabs={PETTY_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Top-up Payments</h1>
          <p className="text-gray-500 text-sm">Approved Petty Cash top-ups awaiting payment by the Digital Expenses Custodian. Paying one moves money out of a digital account and credits the petty cash float in a single step.</p>
        </div>

        {loading ? <div className="py-16 text-center text-gray-400">Loading…</div> : !queue || queue.rows.length === 0 ? (
          <EmptyState icon="✅" title="Nothing awaiting payment" hint="Approved Petty Cash top-ups that need paying out of a digital account show up here." />
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center">
              <h2 className="font-semibold text-gray-800">Awaiting payment</h2>
              <span className="text-sm text-gray-500">{queue.count} top-up{queue.count === 1 ? '' : 's'} · {formatCurrency(queue.totalPending)} pending</span>
            </div>
            {accounts.length === 0 && (
              <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 text-sm text-amber-800">No digital account is configured to pay from — add one in Expense Settings before paying.</div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr className="text-left text-gray-600">
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Requested By</th>
                  <th className="px-4 py-3 font-semibold">Purpose</th>
                  <th className="px-4 py-3 font-semibold">Petty Cash Fund</th>
                  <th className="px-4 py-3 font-semibold">Reference</th>
                  <th className="px-4 py-3 font-semibold text-right">Amount</th>
                  <th className="px-4 py-3 font-semibold text-right">Action</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {queue.rows.map((r) => (
                    <Fragment key={r.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                      <td className="px-4 py-3 text-gray-700">{names[r.requestedById] || '—'}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-[240px] truncate" title={r.purpose}>{r.purpose}</td>
                      <td className="px-4 py-3 text-gray-600">{r.fundName || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{r.reference || '—'}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">{formatCurrency(r.amount)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {payingId === r.id ? (
                          <button onClick={() => setPayingId('')} className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
                        ) : (
                          <button onClick={() => openPay(r.id)} disabled={accounts.length === 0}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">Pay →</button>
                        )}
                      </td>
                    </tr>
                    {payingId === r.id && (
                      <tr className="bg-indigo-50/40">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <label className="block">
                              <span className="text-xs text-gray-500">Pay from digital account</span>
                              <select value={chosenAccount} onChange={(e) => setChosenAccount(e.target.value)}
                                className="block mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white min-w-[280px]">
                                {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                              </select>
                            </label>
                            <Button onClick={() => pay(r)} disabled={submitting || !chosenAccount}>
                              {submitting ? 'Paying…' : `Confirm — pay ${formatCurrency(r.amount)}`}
                            </Button>
                            <span className="text-[11px] text-gray-400 pb-2">Records a transfer out of the account and credits the fund, linked to this request.</span>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<AppShell><div className="py-12 text-center text-gray-400">Loading…</div></AppShell>}>
      <TopUpPaymentsPage />
    </Suspense>
  )
}
