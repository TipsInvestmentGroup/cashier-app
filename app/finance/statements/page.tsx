'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'

const STATEMENTS = ['Trial Balance', 'Income Statement', 'Balance Sheet', 'Cash Flow'] as const

interface TBRow { accountId: string; code: string; name: string; type: string; debit: number; credit: number; balance: number }
interface StatementLine { accountId: string; code: string; name: string; amount: number }
interface BSLine { accountId: string; code: string; name: string; amount: number }

export default function StatementsPage() {
  const { request } = useApi()
  const [active, setActive] = useState<typeof STATEMENTS[number]>('Trial Balance')
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [periodStart, setPeriodStart] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10))
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10))

  const [trialBalance, setTrialBalance] = useState<{ rows: TBRow[]; totalDebit: number; totalCredit: number } | null>(null)
  const [incomeStatement, setIncomeStatement] = useState<{ revenue: StatementLine[]; expenses: StatementLine[]; totalRevenue: number; totalExpenses: number; netProfit: number } | null>(null)
  const [balanceSheet, setBalanceSheet] = useState<{ assets: BSLine[]; totalAssets: number; liabilities: BSLine[]; totalLiabilities: number; equity: BSLine[]; totalEquity: number; balanced: boolean } | null>(null)
  const [cashFlow, setCashFlow] = useState<{ openingBalance: number; closingBalance: number; inflows: { sourceModule: string; amount: number }[]; outflows: { sourceModule: string; amount: number }[]; netChange: number } | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (active === 'Trial Balance') setTrialBalance(await request(`/api/finance/statements/trial-balance?asOfDate=${asOfDate}`))
      if (active === 'Income Statement') setIncomeStatement(await request(`/api/finance/statements/income-statement?periodStart=${periodStart}&periodEnd=${periodEnd}`))
      if (active === 'Balance Sheet') setBalanceSheet(await request(`/api/finance/statements/balance-sheet?asOfDate=${asOfDate}`))
      if (active === 'Cash Flow') setCashFlow(await request(`/api/finance/statements/cash-flow?periodStart=${periodStart}&periodEnd=${periodEnd}`))
    } finally { setLoading(false) }
  }, [request, active, asOfDate, periodStart, periodEnd])

  useEffect(() => { load() }, [load])

  const usesAsOfDate = active === 'Trial Balance' || active === 'Balance Sheet'

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Financial Statements</h1>
          <p className="text-gray-500 text-sm">Computed live from posted journal entries — nothing here is a stored snapshot</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {STATEMENTS.map((s) => (
            <button key={s} onClick={() => setActive(s)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${active === s ? 'bg-indigo-600 text-white' : 'bg-white border-2 border-gray-200 text-gray-700'}`}>
              {s}
            </button>
          ))}
        </div>

        <Card>
          <div className="flex flex-wrap gap-2 mb-4">
            {usesAsOfDate ? (
              <>
                <label className="text-sm text-gray-500 self-center">As of</label>
                <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
              </>
            ) : (
              <>
                <label className="text-sm text-gray-500 self-center">Period</label>
                <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
                <span className="self-center text-gray-400">–</span>
                <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
              </>
            )}
          </div>

          {loading && <div className="py-6 text-center text-gray-400">Loading…</div>}

          {!loading && active === 'Trial Balance' && trialBalance && (
            <div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-600 border-b border-gray-100"><th className="py-2">Account</th><th className="py-2 text-right">Debit</th><th className="py-2 text-right">Credit</th><th className="py-2 text-right">Balance</th></tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {trialBalance.rows.map((r) => (
                    <tr key={r.accountId}>
                      <td className="py-2 text-gray-700">{r.code} {r.name}</td>
                      <td className="py-2 text-right">{r.debit > 0 ? formatCurrency(r.debit) : ''}</td>
                      <td className="py-2 text-right">{r.credit > 0 ? formatCurrency(r.credit) : ''}</td>
                      <td className="py-2 text-right font-semibold">{formatCurrency(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-gray-200 font-bold"><td className="py-2">Total</td><td className="py-2 text-right">{formatCurrency(trialBalance.totalDebit)}</td><td className="py-2 text-right">{formatCurrency(trialBalance.totalCredit)}</td><td></td></tr></tfoot>
              </table>
              <div className="mt-3"><Badge tone={trialBalance.totalDebit === trialBalance.totalCredit ? 'green' : 'red'}>{trialBalance.totalDebit === trialBalance.totalCredit ? 'Balanced' : 'Out of balance'}</Badge></div>
            </div>
          )}

          {!loading && active === 'Income Statement' && incomeStatement && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Revenue</p>
                {incomeStatement.revenue.map((r) => <div key={r.accountId} className="flex justify-between text-sm py-1"><span>{r.code} {r.name}</span><span>{formatCurrency(r.amount)}</span></div>)}
                <div className="flex justify-between text-sm font-bold border-t border-gray-100 pt-1 mt-1"><span>Total Revenue</span><span>{formatCurrency(incomeStatement.totalRevenue)}</span></div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Expenses</p>
                {incomeStatement.expenses.map((r) => <div key={r.accountId} className="flex justify-between text-sm py-1"><span>{r.code} {r.name}</span><span>{formatCurrency(r.amount)}</span></div>)}
                <div className="flex justify-between text-sm font-bold border-t border-gray-100 pt-1 mt-1"><span>Total Expenses</span><span>{formatCurrency(incomeStatement.totalExpenses)}</span></div>
              </div>
              <div className={`rounded-xl p-4 flex justify-between items-center font-bold ${incomeStatement.netProfit >= 0 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                <span>Net {incomeStatement.netProfit >= 0 ? 'Profit' : 'Loss'}</span><span>{formatCurrency(Math.abs(incomeStatement.netProfit))}</span>
              </div>
            </div>
          )}

          {!loading && active === 'Balance Sheet' && balanceSheet && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Assets</p>
                {balanceSheet.assets.map((a) => <div key={a.accountId} className="flex justify-between text-sm py-1"><span>{a.code} {a.name}</span><span>{formatCurrency(a.amount)}</span></div>)}
                <div className="flex justify-between text-sm font-bold border-t border-gray-100 pt-1 mt-1"><span>Total Assets</span><span>{formatCurrency(balanceSheet.totalAssets)}</span></div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Liabilities</p>
                {balanceSheet.liabilities.map((a) => <div key={a.accountId} className="flex justify-between text-sm py-1"><span>{a.code} {a.name}</span><span>{formatCurrency(a.amount)}</span></div>)}
                <div className="flex justify-between text-sm font-bold border-t border-gray-100 pt-1 mt-1"><span>Total Liabilities</span><span>{formatCurrency(balanceSheet.totalLiabilities)}</span></div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Equity</p>
                {balanceSheet.equity.map((a) => <div key={a.accountId} className="flex justify-between text-sm py-1"><span>{a.code} {a.name}</span><span>{formatCurrency(a.amount)}</span></div>)}
                <div className="flex justify-between text-sm font-bold border-t border-gray-100 pt-1 mt-1"><span>Total Equity</span><span>{formatCurrency(balanceSheet.totalEquity)}</span></div>
              </div>
              <Badge tone={balanceSheet.balanced ? 'green' : 'red'}>{balanceSheet.balanced ? 'Assets = Liabilities + Equity ✓' : 'Out of balance'}</Badge>
            </div>
          )}

          {!loading && active === 'Cash Flow' && cashFlow && (
            <div className="space-y-4">
              <div className="flex justify-between text-sm"><span>Opening Cash Balance</span><span className="font-semibold">{formatCurrency(cashFlow.openingBalance)}</span></div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Cash In (by source)</p>
                {cashFlow.inflows.map((f) => <div key={f.sourceModule} className="flex justify-between text-sm py-1"><span>{f.sourceModule}</span><span>{formatCurrency(f.amount)}</span></div>)}
                {cashFlow.inflows.length === 0 && <p className="text-sm text-gray-400">None</p>}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Cash Out (by source)</p>
                {cashFlow.outflows.map((f) => <div key={f.sourceModule} className="flex justify-between text-sm py-1"><span>{f.sourceModule}</span><span>{formatCurrency(f.amount)}</span></div>)}
                {cashFlow.outflows.length === 0 && <p className="text-sm text-gray-400">None</p>}
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-gray-100 pt-1"><span>Net Change in Cash</span><span>{formatCurrency(cashFlow.netChange)}</span></div>
              <div className="rounded-xl bg-indigo-50 p-4 flex justify-between items-center font-bold text-indigo-800"><span>Closing Cash Balance</span><span>{formatCurrency(cashFlow.closingBalance)}</span></div>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
