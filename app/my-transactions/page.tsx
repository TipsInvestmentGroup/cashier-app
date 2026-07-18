'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { format } from 'date-fns'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { useAuth } from '@/contexts/AuthContext'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import toast from 'react-hot-toast'

interface Channel { code: string; label: string }
interface TxSession { id: string; status: string; date: string }
interface Approval { status: string; comment: string | null }
interface Txn {
  id: string; category: string; paymentMethod: string | null; amount: number
  receivingAccount: string | null; reference: string | null; status: string; approvals: Approval[]
}

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

export default function MyTransactionsPage() {
  const { user } = useAuth()
  const { request } = useApi()
  const [session, setSession] = useState<TxSession | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [txns, setTxns] = useState<Txn[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [category, setCategory] = useState('PAYMENT')
  const [paymentMethod, setPaymentMethod] = useState('CASH')
  const [amount, setAmount] = useState('')
  const [receivingAccount, setReceivingAccount] = useState('')
  const [reference, setReference] = useState('')

  const today = format(new Date(), 'yyyy-MM-dd')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sessions, chans] = await Promise.all([
        request(`/api/transaction-sessions?from=${today}&to=${today}`),
        request('/api/payment-channels'),
      ])
      setChannels((chans || []).filter((c: { isActive: boolean }) => c.isActive))
      const s: TxSession | undefined = (sessions || [])[0]
      setSession(s || null)
      if (s) setTxns((await request(`/api/staff-transactions?sessionId=${s.id}`)) || [])
      else setTxns([])
    } catch {
      // best-effort — errors surface via the empty-state below
    } finally { setLoading(false) }
  }, [request, today])

  useEffect(() => { load() }, [load])

  const submit = async () => {
    if (!session) return
    const amt = Number(amount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    if (category === 'PAYMENT' && !paymentMethod) return toast.error('Select a payment method')
    setSaving(true)
    try {
      await request('/api/staff-transactions', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: session.id,
          category,
          paymentMethod: category === 'PAYMENT' ? paymentMethod : null,
          amount: amt,
          receivingAccount: receivingAccount || null,
          reference: reference || null,
        }),
      })
      toast.success('Transaction declared')
      setAmount(''); setReceivingAccount(''); setReference('')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally { setSaving(false) }
  }

  const remove = async (id: string) => {
    try {
      await request(`/api/staff-transactions/${id}`, { method: 'DELETE' })
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  const total = useMemo(() => txns.filter((t) => t.status !== 'REJECTED').reduce((s, t) => s + t.amount, 0), [txns])

  return (
    <AppShell>
      <SectionTabs tabs={MYPOS_TABS} />
      <div className="max-w-md mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Transactions</h1>
          <p className="text-gray-500 text-sm">Declare the payments you personally received today — {user?.outlet?.name}.</p>
        </div>

        {loading ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : !session ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center text-sm text-gray-500">
            Today&apos;s session hasn&apos;t been opened yet. Ask your cashier to import System Sales for today first.
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 space-y-3">
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

              <button onClick={submit} disabled={saving}
                className="mt-1 w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50">
                {saving ? 'Saving…' : 'Declare Transaction'}
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800">Today&apos;s Declarations</h2>
                <span className="text-sm font-bold text-gray-900">{formatCurrency(total)}</span>
              </div>
              {txns.length === 0 ? (
                <p className="py-6 text-center text-gray-400 text-sm">No transactions declared yet</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {txns.map((t) => (
                    <div key={t.id} className="py-2.5 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-gray-800">
                          {CATEGORIES.find((c) => c.value === t.category)?.label}
                          {t.paymentMethod ? ` · ${t.paymentMethod}` : ''}
                        </p>
                        <p className="text-xs text-gray-400">{t.receivingAccount || t.reference || '—'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">{formatCurrency(t.amount)}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLE[t.status] || 'bg-gray-100 text-gray-600'}`}>{t.status.replace('_', ' ')}</span>
                        {t.status === 'DECLARED' && (
                          <button onClick={() => remove(t.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
