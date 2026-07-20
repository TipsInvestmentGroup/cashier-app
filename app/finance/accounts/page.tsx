'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { Card, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import toast from 'react-hot-toast'

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const

interface Account {
  id: string; code: string; name: string; type: string; isActive: boolean; isSystemAccount: boolean
}

export default function ChartOfAccountsPage() {
  const { request } = useApi()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<typeof ACCOUNT_TYPES[number]>('EXPENSE')

  const load = useCallback(async () => {
    setLoading(true)
    try { setAccounts(await request('/api/finance/accounts')) } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!code.trim() || !name.trim()) return toast.error('Code and name are required')
    try {
      await request('/api/finance/accounts', { method: 'POST', body: JSON.stringify({ code: code.trim(), name: name.trim(), type }) })
      toast.success('Account added'); setCode(''); setName(''); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not add account') }
  }

  const toggle = async (a: Account) => {
    try { await request(`/api/finance/accounts/${a.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !a.isActive }) }); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not update') }
  }

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chart of Accounts</h1>
          <p className="text-gray-500 text-sm">Every financial transaction eventually posts to one of these accounts</p>
        </div>

        <Card>
          <CardHeader title="Add an account" />
          <div className="flex flex-wrap gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code (e.g. 6000)"
              className="w-32 px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Account name"
              className="flex-1 min-w-[200px] px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" />
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)}
              className="px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm">
              {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={add} className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Add</button>
          </div>
        </Card>

        <Card>
          {loading ? <div className="py-10 text-center text-gray-400">Loading…</div> : accounts.length === 0 ? (
            <EmptyState icon="📒" title="No accounts yet" />
          ) : (
            ACCOUNT_TYPES.map((t) => {
              const rows = accounts.filter((a) => a.type === t)
              if (!rows.length) return null
              return (
                <div key={t} className="mb-5 last:mb-0">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t}</p>
                  <div className="divide-y divide-gray-50">
                    {rows.map((a) => (
                      <div key={a.id} className="flex items-center gap-3 py-2.5">
                        <span className="font-mono text-xs text-gray-400 w-14">{a.code}</span>
                        <span className={`flex-1 text-sm ${a.isActive ? 'text-gray-800 font-medium' : 'text-gray-400 line-through'}`}>{a.name}</span>
                        {a.isSystemAccount && <Badge tone="indigo">System</Badge>}
                        {!a.isSystemAccount && (
                          <button onClick={() => toggle(a)} className="px-2.5 py-1 bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-100">
                            {a.isActive ? 'Disable' : 'Enable'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </Card>
      </div>
    </AppShell>
  )
}
