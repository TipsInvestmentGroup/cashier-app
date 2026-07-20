'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Card, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import toast from 'react-hot-toast'

interface Channel { id: string; code: string; label: string }
interface Outlet { id: string; name: string }
interface CompanyAccount {
  id: string; accountName: string; bankName: string | null; accountNumber: string | null; currency: string
  isDefault: boolean; isActive: boolean; paymentChannel: Channel; outlet: { name: string } | null
  balance?: number
}
interface BankTxn {
  id: string; type: string; amount: number; transactionDate: string; reference: string | null; note: string | null
  fromAccount: { accountName: string } | null; toAccount: { accountName: string } | null
}

const TXN_TYPES = ['TRANSFER', 'DEPOSIT', 'WITHDRAWAL', 'BANK_CHARGE', 'INTEREST'] as const
const TXN_LABELS: Record<string, string> = {
  TRANSFER: 'Transfer between accounts', DEPOSIT: 'Deposit (cash into bank)', WITHDRAWAL: 'Withdrawal (bank to cash)',
  BANK_CHARGE: 'Bank charge', INTEREST: 'Interest received',
}
const NEEDS_FROM: Record<string, boolean> = { TRANSFER: true, DEPOSIT: true, WITHDRAWAL: true, BANK_CHARGE: true, INTEREST: false }
const NEEDS_TO: Record<string, boolean> = { TRANSFER: true, DEPOSIT: true, WITHDRAWAL: true, BANK_CHARGE: false, INTEREST: true }

export default function BankingPage() {
  const { request } = useApi()
  const [accounts, setAccounts] = useState<CompanyAccount[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [txns, setTxns] = useState<BankTxn[]>([])
  const [loading, setLoading] = useState(true)

  const [channelId, setChannelId] = useState('')
  const [accountName, setAccountName] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [currency, setCurrency] = useState('TZS')
  const [outletId, setOutletId] = useState('')

  const [txnType, setTxnType] = useState<typeof TXN_TYPES[number]>('TRANSFER')
  const [txnFrom, setTxnFrom] = useState('')
  const [txnTo, setTxnTo] = useState('')
  const [txnAmount, setTxnAmount] = useState('')
  const [txnReference, setTxnReference] = useState('')
  const [txnNote, setTxnNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [acc, ch, outs, tx] = await Promise.all([
        request('/api/finance/company-accounts'),
        request('/api/payment-channels'),
        request('/api/outlets'),
        request('/api/finance/bank-transactions'),
      ])
      const accountsWithBalances = await Promise.all((acc || []).map(async (a: CompanyAccount) => {
        const { balance } = await request(`/api/finance/company-accounts/${a.id}`)
        return { ...a, balance }
      }))
      setAccounts(accountsWithBalances)
      setChannels(ch || []); setOutlets(outs || []); setTxns(tx || [])
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const addAccount = async () => {
    if (!channelId || !accountName.trim()) return toast.error('Channel and account name are required')
    try {
      await request('/api/finance/company-accounts', {
        method: 'POST',
        body: JSON.stringify({ paymentChannelId: channelId, accountName, bankName: bankName || null, accountNumber: accountNumber || null, currency, outletId: outletId || null }),
      })
      toast.success('Account added'); setAccountName(''); setBankName(''); setAccountNumber(''); setOutletId(''); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not add account') }
  }

  const setDefault = async (a: CompanyAccount) => {
    try { await request(`/api/finance/company-accounts/${a.id}`, { method: 'PATCH', body: JSON.stringify({ isDefault: true }) }); toast.success('Set as default'); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not set default') }
  }

  const toggleActive = async (a: CompanyAccount) => {
    try { await request(`/api/finance/company-accounts/${a.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !a.isActive }) }); load() }
    catch { toast.error('Could not update') }
  }

  const submitTxn = async () => {
    const amount = Number(txnAmount)
    if (!(amount > 0)) return toast.error('Enter a positive amount')
    if (NEEDS_FROM[txnType] && !txnFrom) return toast.error('Select the from-account')
    if (NEEDS_TO[txnType] && !txnTo) return toast.error('Select the to-account')
    try {
      await request('/api/finance/bank-transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: txnType, fromAccountId: NEEDS_FROM[txnType] ? txnFrom : null, toAccountId: NEEDS_TO[txnType] ? txnTo : null,
          amount, transactionDate: new Date().toISOString(), reference: txnReference || null, note: txnNote || null,
        }),
      })
      toast.success('Transaction recorded'); setTxnAmount(''); setTxnReference(''); setTxnNote(''); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not record transaction') }
  }

  const activeAccounts = accounts.filter((a) => a.isActive)

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Banking</h1>
          <p className="text-gray-500 text-sm">Company bank/mobile-money/cash accounts and cash-management movements</p>
        </div>

        <Card>
          <CardHeader title="Add a company payment account" subtitle="One or more real accounts under each Payment Channel type" />
          <div className="flex flex-wrap gap-2">
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)} className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">Channel…</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Account name (e.g. Operating Account)"
              className="flex-1 min-w-[180px] px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Bank (optional)"
              className="w-40 px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="Account # (optional)"
              className="w-40 px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="TZS"
              className="w-20 px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">Company-wide</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button onClick={addAccount} className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Add</button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Company payment accounts" />
          {loading ? <div className="py-6 text-center text-gray-400">Loading…</div> : accounts.length === 0 ? (
            <EmptyState icon="🏦" title="No company payment accounts yet" hint="Add one above so channel-based payments and collections know exactly which account to post to." />
          ) : (
            <div className="divide-y divide-gray-50">
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center gap-3 py-2.5">
                  <Badge tone="indigo">{a.paymentChannel.label}</Badge>
                  <span className={`flex-1 text-sm ${a.isActive ? 'text-gray-800 font-medium' : 'text-gray-400 line-through'}`}>
                    {a.accountName}{a.bankName ? ` — ${a.bankName}` : ''}{a.accountNumber ? ` (${a.accountNumber})` : ''}
                  </span>
                  {a.outlet && <span className="text-xs text-gray-400">{a.outlet.name}</span>}
                  <span className="text-sm font-semibold text-gray-700">{formatCurrency(a.balance || 0)} {a.currency}</span>
                  {a.isDefault ? <Badge tone="green">Default</Badge> : (
                    <button onClick={() => setDefault(a)} className="px-2.5 py-1 bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-100">Set Default</button>
                  )}
                  <button onClick={() => toggleActive(a)} className="px-2.5 py-1 bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-100">
                    {a.isActive ? 'Disable' : 'Enable'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Record a transaction" subtitle="Transfer, deposit, withdrawal, bank charge, or interest" />
          <div className="flex flex-wrap gap-2 mb-3">
            {TXN_TYPES.map((t) => (
              <button key={t} onClick={() => setTxnType(t)}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition ${txnType === t ? 'bg-indigo-600 text-white' : 'bg-white border-2 border-gray-200 text-gray-700'}`}>
                {TXN_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {NEEDS_FROM[txnType] && (
              <select value={txnFrom} onChange={(e) => setTxnFrom(e.target.value)} className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
                <option value="">From account…</option>
                {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.accountName}</option>)}
              </select>
            )}
            {NEEDS_TO[txnType] && (
              <select value={txnTo} onChange={(e) => setTxnTo(e.target.value)} className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
                <option value="">To account…</option>
                {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.accountName}</option>)}
              </select>
            )}
            <input type="number" value={txnAmount} onChange={(e) => setTxnAmount(e.target.value)} placeholder="Amount"
              className="w-32 px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <input value={txnReference} onChange={(e) => setTxnReference(e.target.value)} placeholder="Reference (optional)"
              className="w-40 px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <input value={txnNote} onChange={(e) => setTxnNote(e.target.value)} placeholder="Note (optional)"
              className="flex-1 min-w-[160px] px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <button onClick={submitTxn} className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Record</button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent transactions" />
          {txns.length === 0 ? <EmptyState icon="🧾" title="No transactions yet" /> : (
            <div className="divide-y divide-gray-50">
              {txns.map((t) => (
                <div key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="text-xs text-gray-400 w-24">{formatDate(t.transactionDate)}</span>
                  <Badge tone="gray">{TXN_LABELS[t.type] || t.type}</Badge>
                  <span className="flex-1 text-gray-600">
                    {t.fromAccount ? t.fromAccount.accountName : '—'} → {t.toAccount ? t.toAccount.accountName : '—'}
                    {t.note ? <span className="text-gray-400"> · {t.note}</span> : null}
                  </span>
                  <span className="font-semibold text-gray-800">{formatCurrency(t.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
