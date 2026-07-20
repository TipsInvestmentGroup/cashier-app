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

interface Account { id: string; code: string; name: string; type: string }
interface Outlet { id: string; name: string }
interface Department { id: string; name: string }
interface BudgetRow {
  id: string; periodType: string; periodStart: string; periodEnd: string
  account: Account; outlet: { name: string } | null; department: { name: string } | null
  budgetAmount: number; actual: number; variance: number; variancePercent: number | null; forecast: number
}

const PERIOD_TYPES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const

export default function BudgetsPage() {
  const { request } = useApi()
  const [budgets, setBudgets] = useState<BudgetRow[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)

  const [accountId, setAccountId] = useState('')
  const [outletId, setOutletId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [periodType, setPeriodType] = useState<typeof PERIOD_TYPES[number]>('MONTHLY')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [amount, setAmount] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [b, acc, outs, deps] = await Promise.all([
        request('/api/finance/budgets'), request('/api/finance/accounts'), request('/api/outlets'), request('/api/departments'),
      ])
      setBudgets(b || []); setAccounts(acc || []); setOutlets(outs || []); setDepartments(deps || [])
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const addBudget = async () => {
    if (!accountId || !periodStart || !periodEnd || !(Number(amount) > 0)) return toast.error('Account, period, and a positive amount are required')
    try {
      await request('/api/finance/budgets', {
        method: 'POST',
        body: JSON.stringify({ accountId, outletId: outletId || null, departmentId: departmentId || null, periodType, periodStart, periodEnd, amount: Number(amount) }),
      })
      toast.success('Budget added'); setAmount(''); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not add budget') }
  }

  const removeBudget = async (id: string) => {
    if (!confirm('Delete this budget?')) return
    try { await request(`/api/finance/budgets/${id}`, { method: 'DELETE' }); toast.success('Deleted'); load() }
    catch { toast.error('Could not delete') }
  }

  const varianceTone = (b: BudgetRow): 'green' | 'red' | 'gray' => {
    if (b.variance === 0) return 'gray'
    const favorable = b.account.type === 'INCOME' ? b.variance > 0 : b.variance < 0
    return favorable ? 'green' : 'red'
  }

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Budgets</h1>
          <p className="text-gray-500 text-sm">Budget vs Actual vs Variance vs Forecast, by account and branch</p>
        </div>

        <Card>
          <CardHeader title="Add a budget" subtitle="One GL account, one period, optionally scoped to a branch/department" />
          <div className="flex flex-wrap gap-2">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">Account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">Company-wide</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">No department</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={periodType} onChange={(e) => setPeriodType(e.target.value as typeof periodType)} className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              {PERIOD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Budget amount"
              className="w-40 px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <button onClick={addBudget} className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Add</button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Budget vs Actual" />
          {loading ? <div className="py-6 text-center text-gray-400">Loading…</div> : budgets.length === 0 ? (
            <EmptyState icon="🎯" title="No budgets yet" hint="Add one above to start tracking budget vs actual for an account" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-3 py-2 font-semibold">Account</th>
                    <th className="px-3 py-2 font-semibold">Scope</th>
                    <th className="px-3 py-2 font-semibold">Period</th>
                    <th className="px-3 py-2 font-semibold text-right">Budget</th>
                    <th className="px-3 py-2 font-semibold text-right">Actual</th>
                    <th className="px-3 py-2 font-semibold text-right">Variance</th>
                    <th className="px-3 py-2 font-semibold text-right">Variance %</th>
                    <th className="px-3 py-2 font-semibold text-right">Forecast</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {budgets.map((b) => (
                    <tr key={b.id}>
                      <td className="px-3 py-2 text-gray-800">{b.account.code} {b.account.name}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{b.outlet?.name || 'Company-wide'}{b.department ? ` · ${b.department.name}` : ''}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">
                        <Badge tone="gray">{b.periodType}</Badge> {formatDate(b.periodStart)}–{formatDate(b.periodEnd)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(b.budgetAmount)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-800">{formatCurrency(b.actual)}</td>
                      <td className="px-3 py-2 text-right"><Badge tone={varianceTone(b)}>{formatCurrency(b.variance)}</Badge></td>
                      <td className="px-3 py-2 text-right text-gray-500">{b.variancePercent !== null ? `${b.variancePercent}%` : '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{formatCurrency(b.forecast)}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => removeBudget(b.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
