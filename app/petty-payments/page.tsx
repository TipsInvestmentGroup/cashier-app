'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, PETTY_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ExportBar } from '@/components/ExportBar'
import { MoneyInput } from '@/components/MoneyInput'
import { PayModal } from '@/components/petty/PayModal'
import { format, subDays } from 'date-fns'
import toast from 'react-hot-toast'

interface Item {
  id: string; date: string; requestedBy: string; department?: string; functionName?: string; purpose: string
  amount: number; paymentMethod: string; payeeName?: string; payeeAccount?: string; paymentStatus?: string
  approvedBy?: string; status: string; pettyType?: string; paidByName?: string; paidAt?: string; receiptUrl?: string; outletId?: string
}
interface FundTxn { id: string; type: string; amount: number; note?: string; createdByName?: string; createdAt: string }
interface Fund { id: string; name: string; ownerName?: string; openingBalance: number; replenished: number; paidOut: number; balance: number; depositDate?: string; txns: FundTxn[] }
interface Report {
  totals: { requested: number; paid: number; pending: number; approvedUnpaid: number; cashierPaid: number; cashierCash: number; cashierNonCash: number; accountantPaid: number }
  byOutlet: Group[]; byDepartment: Group[]; byRequester: Group[]; byDisburser: Group[]; byType: Group[]
}
interface Group { label: string; count: number; amount: number }

export default function PettyPaymentsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const canManageFunds = ['ACCOUNTANT', 'ADMIN', 'DIRECTOR'].includes(user?.role || '')
  const [view, setView] = useState<'pay' | 'funds' | 'reports'>('pay')
  const [items, setItems] = useState<Item[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [its, fds] = await Promise.all([request('/api/petty-cash'), request('/api/petty-funds').catch(() => [])])
      setItems(its || [])
      setFunds(fds || [])
    } finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  // ---- Payment modal ----
  const [paying, setPaying] = useState<Item | null>(null)

  // ---- Fund create / replenish ----
  const [fundForm, setFundForm] = useState({ amount: '', depositDate: format(new Date(), 'yyyy-MM-dd') })
  const [replen, setReplen] = useState<{ fund: Fund; amount: string; note: string } | null>(null)

  const createFund = async () => {
    if (!fundForm.amount || Number(fundForm.amount) <= 0) return toast.error('Enter the amount deposited')
    try {
      await request('/api/petty-funds', { method: 'POST', body: JSON.stringify({ openingBalance: Number(fundForm.amount), depositDate: fundForm.depositDate }) })
      toast.success('Petty cash recorded'); setFundForm({ amount: '', depositDate: format(new Date(), 'yyyy-MM-dd') }); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Error') }
  }
  const submitReplenish = async () => {
    if (!replen) return
    try {
      await request(`/api/petty-funds/${replen.fund.id}/replenish`, { method: 'POST', body: JSON.stringify({ amount: Number(replen.amount), note: replen.note }) })
      toast.success('Fund replenished'); setReplen(null); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Error') }
  }

  // ---- Reports ----
  const [from, setFrom] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [report, setReport] = useState<Report | null>(null)
  const loadReport = useCallback(async () => {
    try { setReport(await request(`/api/petty-cash/report?from=${from}&to=${to}`)) } catch { /* ignore */ }
  }, [request, from, to])
  useEffect(() => { if (view === 'reports') loadReport() }, [view, loadReport])

  const toPay = items.filter((i) => i.status === 'APPROVED' && i.paymentStatus !== 'PAID')
  const paidHistory = items.filter((i) => i.paymentStatus === 'PAID').slice(0, 50)

  return (
    <AppShell>
      <SectionTabs tabs={PETTY_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Petty Cash Payments</h1>
          <p className="text-gray-500 text-sm">Disburse approved requests, manage accountant funds, and reconcile</p>
        </div>

        <div className="flex gap-2">
          {([['pay', `To Pay (${toPay.length})`], ['funds', 'Accountant Funds'], ['reports', 'Reports & Reconciliation']] as [typeof view, string][]).map(([v, lbl]) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${view === v ? 'bg-indigo-600 text-white shadow' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>{lbl}</button>
          ))}
        </div>

        {/* ===== PAY ===== */}
        {view === 'pay' && (
          <div className="space-y-6">
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800">Approved — awaiting payment</div>
              {loading ? <div className="py-12 text-center text-gray-400">Loading…</div> : toPay.length === 0 ? (
                <EmptyState icon="✅" title="Nothing awaiting payment" hint="Approved requests appear here for disbursement." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide">
                      <tr><th className="px-4 py-2 text-left">Date</th><th className="px-4 py-2 text-left">Requester</th><th className="px-4 py-2 text-left">Purpose</th><th className="px-4 py-2 text-left">Type</th><th className="px-4 py-2 text-right">Amount</th><th className="px-4 py-2 text-right">Action</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {toPay.map((i) => (
                        <tr key={i.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{formatDate(i.date)}</td>
                          <td className="px-4 py-2 font-medium text-gray-800">{i.requestedBy}</td>
                          <td className="px-4 py-2 text-gray-600 max-w-[240px] truncate" title={i.purpose}>{i.purpose}</td>
                          <td className="px-4 py-2"><Badge tone={i.pettyType === 'ACCOUNTANT' ? 'purple' : 'blue'}>{i.pettyType === 'ACCOUNTANT' ? 'Accountant' : 'Cashier'}</Badge></td>
                          <td className="px-4 py-2 text-right font-bold text-gray-900">{formatCurrency(i.amount)}</td>
                          <td className="px-4 py-2 text-right"><button onClick={() => setPaying(i)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700">Pay →</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800">Recently paid</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide">
                    <tr><th className="px-4 py-2 text-left">Paid</th><th className="px-4 py-2 text-left">Requester</th><th className="px-4 py-2 text-left">Purpose</th><th className="px-4 py-2 text-left">Method</th><th className="px-4 py-2 text-left">Source</th><th className="px-4 py-2 text-left">By</th><th className="px-4 py-2 text-right">Amount</th><th className="px-4 py-2 text-center">Receipt</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {paidHistory.map((i) => (
                      <tr key={i.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{i.paidAt ? formatDate(i.paidAt) : '-'}</td>
                        <td className="px-4 py-2 font-medium text-gray-800">{i.requestedBy}</td>
                        <td className="px-4 py-2 text-gray-600 max-w-[200px] truncate" title={i.purpose}>{i.purpose}</td>
                        <td className="px-4 py-2 text-gray-500">{i.paymentMethod}</td>
                        <td className="px-4 py-2 text-gray-500">{i.pettyType === 'ACCOUNTANT' ? 'Fund' : 'Drawer'}</td>
                        <td className="px-4 py-2 text-gray-500">{i.paidByName || '-'}</td>
                        <td className="px-4 py-2 text-right font-bold text-gray-900">{formatCurrency(i.amount)}</td>
                        <td className="px-4 py-2 text-center">{i.receiptUrl ? <a href={i.receiptUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline text-xs">View</a> : <span className="text-gray-300">—</span>}</td>
                      </tr>
                    ))}
                    {paidHistory.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-gray-400">No payments yet</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* ===== FUNDS ===== */}
        {view === 'funds' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {funds.map((f) => (
                <Card key={f.id}>
                  <div className="flex items-start justify-between">
                    <div><div className="font-semibold text-gray-900">{f.name}</div><div className="text-xs text-gray-400">{f.ownerName || '—'}</div></div>
                    {canManageFunds && <button onClick={() => setReplen({ fund: f, amount: '', note: '' })} className="text-xs font-semibold text-indigo-600 hover:underline">+ Replenish</button>}
                  </div>
                  <div className="mt-3 text-2xl font-bold text-gray-900">{formatCurrency(f.balance)}</div>
                  <div className="text-[11px] text-gray-500 mt-1">Deposited {formatCurrency(f.openingBalance)}{f.depositDate ? ` on ${formatDate(f.depositDate)}` : ''} · +{formatCurrency(f.replenished)} replenished · −{formatCurrency(f.paidOut)} paid</div>
                  {f.txns.length > 0 && (
                    <div className="mt-3 border-t border-gray-100 pt-2 space-y-1 max-h-40 overflow-y-auto">
                      {f.txns.slice(0, 8).map((t) => (
                        <div key={t.id} className="flex items-center justify-between text-[11px]">
                          <span className="text-gray-500">{formatDate(t.createdAt)} · {t.type}</span>
                          <span className={t.amount < 0 ? 'text-red-600' : 'text-green-600'}>{t.amount < 0 ? '' : '+'}{formatCurrency(t.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
              {funds.length === 0 && <Card className="md:col-span-2 lg:col-span-3"><EmptyState icon="🏦" title="No accountant funds yet" hint="Create one to start disbursing from an allocated fund." /></Card>}
            </div>

            {canManageFunds && (
              <Card>
                <div className="font-semibold text-gray-800 mb-1">Add petty cash</div>
                <p className="text-xs text-gray-400 mb-3">Recorded under <span className="font-medium text-gray-600">{user?.name || 'you'}</span> as the operating accountant.</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <MoneyInput value={fundForm.amount} onChange={(v) => setFundForm({ ...fundForm, amount: v })} placeholder="Amount deposited" className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none sm:col-span-2" />
                  <input type="date" value={fundForm.depositDate} onChange={(e) => setFundForm({ ...fundForm, depositDate: e.target.value })} className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
                </div>
                <button onClick={createFund} className="mt-3 px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition">Add Petty Cash</button>
              </Card>
            )}
          </div>
        )}

        {/* ===== REPORTS ===== */}
        {view === 'reports' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-600">Period:</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
              <span className="text-gray-400 text-sm">to</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
              {report && <ExportBar rows={[...report.byOutlet.map((g) => ({ Group: 'Outlet', Name: g.label, Count: g.count, Amount: g.amount })), ...report.byDepartment.map((g) => ({ Group: 'Department', Name: g.label, Count: g.count, Amount: g.amount })), ...report.byRequester.map((g) => ({ Group: 'Requester', Name: g.label, Count: g.count, Amount: g.amount }))]} filename="petty-cash-report" title="Petty Cash Report" />}
            </div>

            {!report ? <Card><div className="py-10 text-center text-gray-400">Loading…</div></Card> : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Card><div className="text-xs text-gray-500">Paid (total)</div><div className="text-xl font-bold text-gray-900">{formatCurrency(report.totals.paid)}</div></Card>
                  <Card><div className="text-xs text-gray-500">Approved · unpaid</div><div className="text-xl font-bold text-amber-600">{formatCurrency(report.totals.approvedUnpaid)}</div></Card>
                  <Card><div className="text-xs text-gray-500">Pending approval</div><div className="text-xl font-bold text-gray-700">{formatCurrency(report.totals.pending)}</div></Card>
                  <Card><div className="text-xs text-gray-500">Requested (total)</div><div className="text-xl font-bold text-gray-700">{formatCurrency(report.totals.requested)}</div></Card>
                </div>

                {/* Reconciliation split */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <div className="font-semibold text-gray-800 mb-2">🧾 Cashier petty cash (from drawer)</div>
                    <div className="text-sm space-y-1">
                      <div className="flex justify-between"><span className="text-gray-500">Paid in cash (reduces drawer)</span><span className="font-bold text-gray-900">{formatCurrency(report.totals.cashierCash)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Paid by bank/M-PESA</span><span className="font-medium text-gray-700">{formatCurrency(report.totals.cashierNonCash)}</span></div>
                      <div className="flex justify-between border-t border-gray-100 pt-1"><span className="text-gray-600 font-medium">Total cashier-paid</span><span className="font-bold text-gray-900">{formatCurrency(report.totals.cashierPaid)}</span></div>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-2">Cash payments are included in daily cash reconciliation & end-of-day closing.</p>
                  </Card>
                  <Card>
                    <div className="font-semibold text-gray-800 mb-2">🏦 Accountant petty cash (from fund)</div>
                    <div className="text-sm space-y-1">
                      <div className="flex justify-between"><span className="text-gray-500">Paid from allocated funds</span><span className="font-bold text-gray-900">{formatCurrency(report.totals.accountantPaid)}</span></div>
                      <div className="flex justify-between border-t border-gray-100 pt-1"><span className="text-gray-600 font-medium">Current fund balance (all funds)</span><span className="font-bold text-gray-900">{formatCurrency(funds.reduce((s, f) => s + f.balance, 0))}</span></div>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-2">Tracked against the fund balance, separate from outlet collections.</p>
                  </Card>
                </div>

                {/* Grouped breakdowns */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {([['By outlet', report.byOutlet], ['By department', report.byDepartment], ['By requester', report.byRequester], ['By disburser', report.byDisburser]] as [string, Group[]][]).map(([title, rows]) => (
                    <Card key={title} className="p-0 overflow-hidden">
                      <div className="px-4 py-2 border-b border-gray-100 font-semibold text-gray-800 text-sm">{title}</div>
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-gray-50">
                          {rows.slice(0, 12).map((g) => (
                            <tr key={g.label} className="hover:bg-gray-50">
                              <td className="px-4 py-2 text-gray-700">{g.label}</td>
                              <td className="px-4 py-2 text-right text-gray-400 text-xs">{g.count}</td>
                              <td className="px-4 py-2 text-right font-semibold text-gray-900">{formatCurrency(g.amount)}</td>
                            </tr>
                          ))}
                          {rows.length === 0 && <tr><td className="px-4 py-6 text-center text-gray-400">No data</td></tr>}
                        </tbody>
                      </table>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Payment modal */}
      {paying && (
        <PayModal item={paying} funds={funds} defaultPayer={user?.name || ''}
          onClose={() => setPaying(null)} onPaid={() => { setPaying(null); load() }} />
      )}

      {/* Replenish modal */}
      {replen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setReplen(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900">＋ Replenish — {replen.fund.name}</h3>
              <button onClick={() => setReplen(null)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
            </div>
            <p className="text-sm text-gray-500">Current balance: <span className="font-bold text-gray-800">{formatCurrency(replen.fund.balance)}</span></p>
            <MoneyInput value={replen.amount} onChange={(v) => setReplen({ ...replen, amount: v })} placeholder="Amount to add" className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <input value={replen.note} onChange={(e) => setReplen({ ...replen, note: e.target.value })} placeholder="Note (optional)" className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <button onClick={submitReplenish} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition">Add to fund</button>
          </div>
        </div>
      )}
    </AppShell>
  )
}
