'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { DailyCashierReport } from '@/components/DailyCashierReport'
import { CashReconReport } from '@/components/CashReconReport'
import { BankReconReport } from '@/components/BankReconReport'
import { useApi } from '@/hooks/useApi'
import { formatCurrency, formatDate } from '@/lib/utils'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import toast from 'react-hot-toast'

interface ReportData {
  period: { start: string; end: string; type: string }
  summary: { totalCollected: number; totalSigned: number; totalPaid: number; totalCancelled: number }
  collections: { id: string; date: string; cash: number; crdb: number; stanbic: number; mpesa: number; total: number; outlet: { name: string }; cashier: { name: string } }[]
  signedBills: { id: string; date: string; voucherNumber: string; billType: string; personName: string; amount: number; status: string; outlet: { name: string } }[]
  paidBills: { id: string; date: string; payerName: string; amountPaid: number; paymentMethod: string; outlet: { name: string } }[]
  cancellations: { id: string; date: string; reason: string; productName: string; sellingPrice: number; quantity: number; amount: number; outletId?: string; collection?: { staffName?: string; outlet?: { name: string } } }[]
  products: { id: string; code: string; name: string; buyingPrice: number; sellingPrice: number; unitMeasure: string; isActive: boolean }[]
  byBillType: Record<string, number>
  byPaymentMethod: Record<string, number>
}
interface Outlet { id: string; name: string }

const PERIOD_TYPES = [
  { value: 'daily', label: 'Today' },
  { value: 'weekly', label: 'This Week' },
  { value: 'monthly', label: 'This Month' },
  { value: 'quarterly', label: 'This Quarter' },
  { value: 'annual', label: 'This Year' },
  { value: 'custom', label: 'Custom Range' },
]

export default function ReportsPage() {
  const { request } = useApi()
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [periodType, setPeriodType] = useState('daily')
  const [outletId, setOutletId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [activeTab, setActiveTab] = useState('summary')
  const [reportView, setReportView] = useState('summary')

  useEffect(() => {
    request('/api/outlets').then(setOutlets).catch(console.error)
  }, [request])

  const loadReport = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ type: periodType })
    if (outletId) params.set('outletId', outletId)
    if (periodType === 'custom' && startDate && endDate) {
      params.set('startDate', startDate)
      params.set('endDate', endDate)
    }
    try {
      const res = await request(`/api/reports?${params}`)
      setData(res)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error loading report')
    } finally {
      setLoading(false)
    }
  }, [request, periodType, outletId, startDate, endDate])

  useEffect(() => { loadReport() }, [loadReport])

  const exportCSV = (rows: Record<string, unknown>[], filename: string) => {
    if (!rows.length) return toast.error('No data to export')
    const keys = Object.keys(rows[0])
    const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => `"${r[k] ?? ''}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
    toast.success('CSV exported!')
  }

  const exportExcel = async (rows: Record<string, unknown>[], filename: string) => {
    if (!rows.length) return toast.error('No data to export')
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Report')
    XLSX.writeFile(wb, `${filename}-${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast.success('Excel exported!')
  }

  const exportPDF = async (rows: Record<string, unknown>[], filename: string, title: string) => {
    if (!rows.length) return toast.error('No data to export')
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const keys = Object.keys(rows[0])
    const doc = new jsPDF()
    doc.setFontSize(14); doc.text(title, 14, 16)
    doc.setFontSize(9); doc.text(`Generated ${new Date().toLocaleString()}`, 14, 22)
    autoTable(doc, { startY: 26, head: [keys], body: rows.map((r) => keys.map((k) => String(r[k] ?? ''))), styles: { fontSize: 8 }, headStyles: { fillColor: [79, 70, 229] } })
    doc.save(`${filename}-${new Date().toISOString().slice(0, 10)}.pdf`)
    toast.success('PDF exported!')
  }

  const ExportBtns = ({ rows, filename, title }: { rows: Record<string, unknown>[]; filename: string; title: string }) => (
    <div className="flex gap-2">
      <button onClick={() => exportCSV(rows, filename)} className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-xl hover:bg-gray-200 transition">📄 CSV</button>
      <button onClick={() => exportExcel(rows, filename)} className="px-3 py-2 bg-green-600 text-white text-sm rounded-xl hover:bg-green-700 transition">📊 Excel</button>
      <button onClick={() => exportPDF(rows, filename, title)} className="px-3 py-2 bg-red-600 text-white text-sm rounded-xl hover:bg-red-700 transition">📕 PDF</button>
    </div>
  )

  const billTypeChartData = data ? Object.entries(data.byBillType).map(([k, v]) => ({ name: k, amount: v })) : []
  const pmChartData = data ? Object.entries(data.byPaymentMethod).map(([k, v]) => ({ name: k, amount: v })) : []

  const tabs = ['summary', 'collections', 'signed', 'paid', 'cancellations', 'products']

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 text-sm">Generate and export financial reports</p>
        </div>

        {/* Report type switcher */}
        <div className="flex flex-wrap gap-2">
          {[{ k: 'summary', label: '📊 Financial Summary' }, { k: 'daily-cashier', label: '🧾 Daily Cashier Report' }, { k: 'cash-recon', label: '💰 Cash Reconciliation' }, { k: 'bank-recon', label: '📲 Digital Payment Reconciliation' }].map((v) => (
            <button key={v.k} onClick={() => setReportView(v.k)}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition ${reportView === v.k ? 'bg-indigo-600 text-white shadow' : 'bg-white border-2 border-gray-200 text-gray-700 hover:border-gray-300'}`}>
              {v.label}
            </button>
          ))}
        </div>

        {reportView === 'daily-cashier' && <DailyCashierReport outlets={outlets} request={request} />}
        {reportView === 'cash-recon' && <CashReconReport outlets={outlets} request={request} />}
        {reportView === 'bank-recon' && <BankReconReport outlets={outlets} request={request} />}

        {reportView === 'summary' && (
        <>
        {/* Controls */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex flex-wrap gap-2 mb-4">
            {PERIOD_TYPES.map((pt) => (
              <button key={pt.value} onClick={() => setPeriodType(pt.value)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition ${periodType === pt.value ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                {pt.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Outlet</label>
              <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
                className="px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm">
                <option value="">All Outlets</option>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            {periodType === 'custom' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">From</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                    className="px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">To</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                    className="px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" />
                </div>
              </>
            )}
          </div>
        </div>

        {loading && <div className="flex items-center justify-center py-12 text-indigo-500 font-medium">Generating report...</div>}

        {data && !loading && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white rounded-2xl p-6 shadow-sm">
                <p className="text-sm opacity-80">Total Collected</p>
                <p className="text-3xl font-bold mt-1">{formatCurrency(data.summary.totalCollected)}</p>
                <p className="text-xs opacity-70 mt-1">{data.collections.length} entries</p>
              </div>
              <div className="bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-2xl p-6 shadow-sm">
                <p className="text-sm opacity-80">Signed (Unpaid Sales)</p>
                <p className="text-3xl font-bold mt-1">{formatCurrency(data.summary.totalSigned)}</p>
                <p className="text-xs opacity-70 mt-1">{data.signedBills.length} vouchers</p>
              </div>
              <div className="bg-gradient-to-br from-green-500 to-green-600 text-white rounded-2xl p-6 shadow-sm">
                <p className="text-sm opacity-80">Debt Recovered</p>
                <p className="text-3xl font-bold mt-1">{formatCurrency(data.summary.totalPaid)}</p>
                <p className="text-xs opacity-70 mt-1">{data.paidBills.length} payments</p>
              </div>
            </div>

            {/* Charts */}
            {(billTypeChartData.length > 0 || pmChartData.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                  <h3 className="font-semibold text-gray-800 mb-4">Signed Bills by Type</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={billTypeChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: unknown) => formatCurrency(v as number)} />
                      <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                  <h3 className="font-semibold text-gray-800 mb-4">Payments by Method</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={pmChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: unknown) => formatCurrency(v as number)} />
                      <Bar dataKey="amount" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Tabs */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="flex border-b border-gray-100">
                {tabs.map((tab) => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-3 text-sm font-medium capitalize transition ${activeTab === tab ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : 'text-gray-600 hover:bg-gray-50'}`}>
                    {tab === 'signed' ? 'Signed Bills' : tab === 'paid' ? 'Paid Bills' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              <div className="p-4">
                {activeTab === 'collections' && (
                  <div>
                    <div className="flex justify-end mb-3">
                      <ExportBtns rows={data.collections.map((c) => ({ Date: formatDate(c.date), Outlet: c.outlet.name, Cash: c.cash, CRDB: c.crdb, Stanbic: c.stanbic, MPESA: c.mpesa, Total: c.total }))} filename="collections" title="Collections Report" />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr className="text-left text-gray-600">
                            <th className="px-4 py-3 font-semibold">Date</th>
                            <th className="px-4 py-3 font-semibold">Outlet</th>
                            <th className="px-4 py-3 font-semibold">Cash</th>
                            <th className="px-4 py-3 font-semibold">CRDB</th>
                            <th className="px-4 py-3 font-semibold">Stanbic</th>
                            <th className="px-4 py-3 font-semibold">M-PESA</th>
                            <th className="px-4 py-3 font-semibold">Total</th>
                            <th className="px-4 py-3 font-semibold">By</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {data.collections.map((c) => (
                            <tr key={c.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3">{formatDate(c.date)}</td>
                              <td className="px-4 py-3">{c.outlet.name}</td>
                              <td className="px-4 py-3">{formatCurrency(c.cash)}</td>
                              <td className="px-4 py-3">{formatCurrency(c.crdb)}</td>
                              <td className="px-4 py-3">{formatCurrency(c.stanbic)}</td>
                              <td className="px-4 py-3">{formatCurrency(c.mpesa)}</td>
                              <td className="px-4 py-3 font-bold">{formatCurrency(c.total)}</td>
                              <td className="px-4 py-3 text-gray-500">{c.cashier.name}</td>
                            </tr>
                          ))}
                          {data.collections.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-gray-400">No data</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'signed' && (
                  <div>
                    <div className="flex justify-end mb-3">
                      <ExportBtns rows={data.signedBills.map((b) => ({ Date: formatDate(b.date), Voucher: b.voucherNumber, Type: b.billType, Person: b.personName, Amount: b.amount, Status: b.status, Outlet: b.outlet.name }))} filename="signed-bills" title="Signed Bills Report" />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr className="text-left text-gray-600">
                            <th className="px-4 py-3 font-semibold">Date</th>
                            <th className="px-4 py-3 font-semibold">Type</th>
                            <th className="px-4 py-3 font-semibold">Person</th>
                            <th className="px-4 py-3 font-semibold">Amount</th>
                            <th className="px-4 py-3 font-semibold">Status</th>
                            <th className="px-4 py-3 font-semibold">Outlet</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {data.signedBills.map((b) => (
                            <tr key={b.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3">{formatDate(b.date)}</td>
                              <td className="px-4 py-3"><span className="px-2 py-1 rounded-lg text-xs font-semibold bg-indigo-100 text-indigo-700">{b.billType}</span></td>
                              <td className="px-4 py-3 font-medium">{b.personName}</td>
                              <td className="px-4 py-3 font-bold">{formatCurrency(b.amount)}</td>
                              <td className="px-4 py-3"><span className={`px-2 py-1 rounded-lg text-xs font-semibold ${b.status === 'PAID' ? 'bg-green-100 text-green-700' : b.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{b.status}</span></td>
                              <td className="px-4 py-3 text-gray-500">{b.outlet.name}</td>
                            </tr>
                          ))}
                          {data.signedBills.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-400">No data</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'paid' && (
                  <div>
                    <div className="flex justify-end mb-3">
                      <ExportBtns rows={data.paidBills.map((p) => ({ Date: formatDate(p.date), Payer: p.payerName, Amount: p.amountPaid, Method: p.paymentMethod, Outlet: p.outlet.name }))} filename="paid-bills" title="Paid Bills Report" />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr className="text-left text-gray-600">
                            <th className="px-4 py-3 font-semibold">Date</th>
                            <th className="px-4 py-3 font-semibold">Payer</th>
                            <th className="px-4 py-3 font-semibold">Amount</th>
                            <th className="px-4 py-3 font-semibold">Method</th>
                            <th className="px-4 py-3 font-semibold">Outlet</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {data.paidBills.map((p) => (
                            <tr key={p.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3">{formatDate(p.date)}</td>
                              <td className="px-4 py-3 font-medium">{p.payerName}</td>
                              <td className="px-4 py-3 font-bold text-green-700">{formatCurrency(p.amountPaid)}</td>
                              <td className="px-4 py-3"><span className="px-2 py-1 rounded-lg text-xs font-semibold bg-blue-100 text-blue-700">{p.paymentMethod}</span></td>
                              <td className="px-4 py-3 text-gray-500">{p.outlet.name}</td>
                            </tr>
                          ))}
                          {data.paidBills.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-gray-400">No data</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'cancellations' && (
                  <div>
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <p className="text-sm text-gray-500">Total cancelled: <strong className="text-rose-700">{formatCurrency(data.summary.totalCancelled)}</strong> · {data.cancellations.length} entries</p>
                      <ExportBtns rows={data.cancellations.map((c) => ({ Date: formatDate(c.date), Staff: c.collection?.staffName || '', Outlet: c.collection?.outlet?.name || '', Reason: c.reason, Product: c.productName, 'Selling Price': c.sellingPrice, Qty: c.quantity, Amount: c.amount }))} filename="cancellations" title="Cancellations Report" />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr className="text-left text-gray-600">
                            <th className="px-4 py-3 font-semibold">Date</th>
                            <th className="px-4 py-3 font-semibold">Staff</th>
                            <th className="px-4 py-3 font-semibold">Reason</th>
                            <th className="px-4 py-3 font-semibold">Product</th>
                            <th className="px-4 py-3 font-semibold">Selling Price</th>
                            <th className="px-4 py-3 font-semibold">Qty</th>
                            <th className="px-4 py-3 font-semibold">Amount</th>
                            <th className="px-4 py-3 font-semibold">Outlet</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {data.cancellations.map((c) => (
                            <tr key={c.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3">{formatDate(c.date)}</td>
                              <td className="px-4 py-3 text-gray-600">{c.collection?.staffName || '-'}</td>
                              <td className="px-4 py-3"><span className="px-2 py-1 rounded-lg text-xs font-semibold bg-rose-100 text-rose-700">{c.reason}</span></td>
                              <td className="px-4 py-3 font-medium">{c.productName}</td>
                              <td className="px-4 py-3">{formatCurrency(c.sellingPrice)}</td>
                              <td className="px-4 py-3">{c.quantity}</td>
                              <td className="px-4 py-3 font-bold text-rose-700">{formatCurrency(c.amount)}</td>
                              <td className="px-4 py-3 text-gray-500">{c.collection?.outlet?.name || '-'}</td>
                            </tr>
                          ))}
                          {data.cancellations.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-gray-400">No cancellations in this period</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'products' && (
                  <div>
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <p className="text-sm text-gray-500">{data.products.length} products in catalogue</p>
                      <ExportBtns rows={data.products.map((p) => ({ Code: p.code, Product: p.name, Unit: p.unitMeasure, 'Buying Price': p.buyingPrice, 'Selling Price': p.sellingPrice, Status: p.isActive ? 'Active' : 'Disabled' }))} filename="products" title="Products Report" />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr className="text-left text-gray-600">
                            <th className="px-4 py-3 font-semibold">Code</th>
                            <th className="px-4 py-3 font-semibold">Product</th>
                            <th className="px-4 py-3 font-semibold">Unit</th>
                            <th className="px-4 py-3 font-semibold">Buying</th>
                            <th className="px-4 py-3 font-semibold">Selling</th>
                            <th className="px-4 py-3 font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {data.products.map((p) => (
                            <tr key={p.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 font-mono text-indigo-700 font-semibold">{p.code}</td>
                              <td className={`px-4 py-3 font-medium ${p.isActive ? '' : 'text-gray-400 line-through'}`}>{p.name}</td>
                              <td className="px-4 py-3 text-gray-500">{p.unitMeasure}</td>
                              <td className="px-4 py-3">{formatCurrency(p.buyingPrice)}</td>
                              <td className="px-4 py-3 font-bold">{formatCurrency(p.sellingPrice)}</td>
                              <td className="px-4 py-3"><span className={`px-2 py-1 rounded-lg text-xs font-semibold ${p.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{p.isActive ? 'Active' : 'Disabled'}</span></td>
                            </tr>
                          ))}
                          {data.products.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-400">No products yet</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'summary' && (
                  <div className="space-y-4 py-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="bg-indigo-50 rounded-xl p-4">
                        <p className="text-sm text-indigo-700 font-semibold">Report Period</p>
                        <p className="text-base font-bold text-indigo-900 mt-1">
                          {formatDate(data.period.start)} — {formatDate(data.period.end)}
                        </p>
                      </div>
                      <div className="bg-green-50 rounded-xl p-4">
                        <p className="text-sm text-green-700 font-semibold">Net Position</p>
                        <p className="text-base font-bold text-green-900 mt-1">
                          {formatCurrency(data.summary.totalCollected + data.summary.totalPaid)}
                        </p>
                      </div>
                      <div className="bg-orange-50 rounded-xl p-4">
                        <p className="text-sm text-orange-700 font-semibold">Uncollected</p>
                        <p className="text-base font-bold text-orange-900 mt-1">
                          {formatCurrency(Math.max(0, data.summary.totalSigned - data.summary.totalPaid))}
                        </p>
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-xl p-4">
                      <h4 className="font-semibold text-gray-700 mb-3">Signed Bills Breakdown by Type</h4>
                      {Object.entries(data.byBillType).length > 0 ? (
                        <div className="space-y-2">
                          {Object.entries(data.byBillType).map(([type, amount]) => (
                            <div key={type} className="flex items-center gap-3">
                              <span className="text-sm font-medium text-gray-600 w-28">{type}</span>
                              <div className="flex-1 h-3 bg-gray-200 rounded-full">
                                <div className="h-3 bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, (amount / data.summary.totalSigned) * 100)}%` }} />
                              </div>
                              <span className="text-sm font-bold text-gray-800">{formatCurrency(amount)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-gray-400 text-sm">No signed bills in this period</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
        </>
        )}
      </div>
    </AppShell>
  )
}
