'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'
import { BILL_TYPE_COLORS, BILL_TYPE_LABELS } from '@/lib/utils'
import toast from 'react-hot-toast'
import { format, subMonths } from 'date-fns'

interface Row {
  personName: string; category: string; billType: string
  creditLimit: number; spent: number; deduction: number
}
interface Totals {
  overLimit: number; staffLoss: number; total: number
  exceededCount: number; staffLossCount: number
}
interface Outlet { id: string; name: string }

const CATEGORY_COLORS: Record<string, string> = {
  'Director Over-Limit': 'bg-purple-100 text-purple-800',
  'Admin Over-Limit': 'bg-blue-100 text-blue-800',
  'Staff Loss': 'bg-red-100 text-red-800',
}

export default function PayrollPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const confirm = useConfirm()
  const [running, setRunning] = useState(false)
  const [emailing, setEmailing] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [outletId, setOutletId] = useState('')
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [loading, setLoading] = useState(true)

  // Last 12 months + All Time
  const monthOptions = [
    { value: 'all', label: 'All Time (Outstanding)' },
    ...Array.from({ length: 12 }, (_, i) => {
      const d = subMonths(new Date(), i)
      return { value: format(d, 'yyyy-MM'), label: format(d, 'MMMM yyyy') }
    }),
  ]
  const isMonthly = month !== 'all'
  const periodLabel = monthOptions.find((m) => m.value === month)?.label || month
  const fileSuffix = isMonthly ? month : 'all-time'

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (outletId) params.set('outletId', outletId)
    params.set('month', month)
    const [data, outs] = await Promise.all([
      request(`/api/payroll-deductions?${params}`),
      request('/api/outlets'),
    ])
    setRows(data.rows || [])
    setTotals(data.totals || null)
    setOutlets(outs)
    setLoading(false)
  }, [request, outletId, month])

  useEffect(() => { load() }, [load])

  const canRun = ['ACCOUNTANT', 'ADMIN'].includes(user?.role || '')

  const runDeduction = async () => {
    if (!totals || totals.total <= 0) return toast.error('Nothing to deduct')
    const ok = await confirm({
      title: 'Run payroll deduction',
      message: `Run payroll deduction for ${periodLabel}?\n\nThis will settle ${formatCurrency(totals.total)} across ${rows.length} people by recording PAYROLL payments. These amounts will then clear from receivables.`,
      confirmLabel: 'Run deduction',
    })
    if (!ok) return
    setRunning(true)
    try {
      const res = await request('/api/payroll-deductions/run', {
        method: 'POST',
        body: JSON.stringify({ month, outletId: outletId || undefined }),
      })
      toast.success(`Deducted ${formatCurrency(res.totalDeducted)} from ${res.settledCount} accounts`)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error running deduction')
    } finally {
      setRunning(false)
    }
  }

  const emailReport = () => {
    if (emailing) return
    // Instant feedback: show a loading toast immediately on click, then do the
    // (slower) send in the background so the UI never blocks.
    setEmailing(true)
    const toastId = toast.loading('Sending report to directors…')
    request('/api/payroll-deductions/email', {
      method: 'POST',
      body: JSON.stringify({ month, outletId: outletId || undefined }),
    })
      .then((res) => {
        if (res.mode === 'ethereal' && res.previewUrl) {
          toast.success('Test email sent — opening preview…', { id: toastId, duration: 5000 })
          window.open(res.previewUrl, '_blank')
        } else {
          toast.success(`Report emailed to ${res.recipients.length} director(s)`, { id: toastId })
        }
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Error sending email', { id: toastId })
      })
      .finally(() => setEmailing(false))
  }

  const exportRows = () =>
    rows.map((r) => ({
      Name: r.personName,
      Category: r.category,
      'Credit Limit': r.creditLimit,
      'Amount Spent': r.spent,
      'Payroll Deduction': r.deduction,
    }))

  const exportCSV = () => {
    if (!rows.length) return toast.error('No data to export')
    const data = exportRows()
    const keys = Object.keys(data[0])
    const csv = [keys.join(','), ...data.map((r) => keys.map((k) => `"${(r as Record<string, unknown>)[k] ?? ''}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `payroll-deductions-${fileSuffix}.csv`
    a.click(); URL.revokeObjectURL(url)
    toast.success('CSV exported!')
  }

  const exportExcel = async () => {
    if (!rows.length) return toast.error('No data to export')
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(exportRows())
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Payroll Deductions')
    XLSX.writeFile(wb, `payroll-deductions-${fileSuffix}.xlsx`)
    toast.success('Excel exported!')
  }

  const exportPDF = async () => {
    if (!rows.length) return toast.error('No data to export')
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF()
    doc.setFontSize(16)
    doc.text('Payroll Deduction Report', 14, 18)
    doc.setFontSize(10)
    doc.text(`Period: ${periodLabel}`, 14, 25)
    doc.text(`Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')}`, 14, 31)
    if (totals) {
      doc.text(`Total Deduction: ${formatCurrency(totals.total)}`, 14, 37)
    }
    autoTable(doc, {
      startY: 42,
      head: [['Name', 'Category', 'Credit Limit', 'Amount Spent', 'Deduction']],
      body: rows.map((r) => [
        r.personName, r.category,
        formatCurrency(r.creditLimit), formatCurrency(r.spent), formatCurrency(r.deduction),
      ]),
      foot: totals ? [['', '', '', 'TOTAL', formatCurrency(totals.total)]] : undefined,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [79, 70, 229] },
      footStyles: { fillColor: [243, 244, 246], textColor: 20, fontStyle: 'bold' },
    })
    doc.save(`payroll-deductions-${format(new Date(), 'yyyy-MM-dd')}.pdf`)
    toast.success('PDF exported!')
  }

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Payroll Deduction Report</h1>
            <p className="text-gray-500 text-sm">Over-limit Admin/Director bills + Staff losses to deduct from salaries</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={exportCSV} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition text-sm">📄 CSV</button>
            <button onClick={exportExcel} className="px-4 py-2.5 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition text-sm">📊 Excel</button>
            <button onClick={exportPDF} className="px-4 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition text-sm">📕 PDF</button>
            <button onClick={emailReport} disabled={emailing}
              className="px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition text-sm disabled:opacity-50">
              {emailing ? 'Sending…' : '✉️ Email Directors'}
            </button>
            {canRun && (
              <button onClick={runDeduction} disabled={running || !totals || totals.total <= 0}
                className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition text-sm disabled:opacity-50">
                {running ? 'Running…' : '🧾 Run Payroll Deduction'}
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-600">Period:</span>
            <select value={month} onChange={(e) => setMonth(e.target.value)}
              className="px-4 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              {monthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-600">Outlet:</span>
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
              className="px-4 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">All Outlets</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <span className="text-xs text-gray-500 ml-auto">
            {isMonthly
              ? `Monthly consumption vs monthly credit limit`
              : `All-time outstanding balances`}
          </span>
        </div>

        {/* Summary */}
        {totals && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-5 shadow">
              <p className="text-sm opacity-80">Total Payroll Deduction</p>
              <p className="text-3xl font-bold mt-1">{formatCurrency(totals.total)}</p>
              <p className="text-xs opacity-70 mt-1">{rows.length} staff/personnel</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-sm text-gray-500">⚠️ Over-Limit (Admin + Director)</p>
              <p className="text-2xl font-bold mt-1 text-orange-600">{formatCurrency(totals.overLimit)}</p>
              <p className="text-xs text-gray-400 mt-1">{totals.exceededCount} exceeded limit</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-sm text-gray-500">📉 Staff Losses</p>
              <p className="text-2xl font-bold mt-1 text-red-600">{formatCurrency(totals.staffLoss)}</p>
              <p className="text-xs text-gray-400 mt-1">{totals.staffLossCount} staff</p>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Deduction Schedule</h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold">Credit Limit</th>
                    <th className="px-4 py-3 font-semibold">{isMonthly ? 'Spent (Month)' : 'Spent (Owed)'}</th>
                    <th className="px-4 py-3 font-semibold">Payroll Deduction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((r, i) => (
                    <tr key={`${r.personName}-${r.billType}-${i}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{r.personName}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${CATEGORY_COLORS[r.category] || 'bg-gray-100 text-gray-700'}`}>
                          {r.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{r.creditLimit > 0 ? formatCurrency(r.creditLimit) : '-'}</td>
                      <td className="px-4 py-3 text-gray-700">{formatCurrency(r.spent)}</td>
                      <td className="px-4 py-3 font-bold text-red-600">{formatCurrency(r.deduction)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-12 text-gray-400">No payroll deductions 🎉 — everyone is within limits and no staff losses.</td></tr>
                  )}
                </tbody>
                {rows.length > 0 && totals && (
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr className="font-bold text-gray-900">
                      <td className="px-4 py-3" colSpan={4}>TOTAL DEDUCTION ({rows.length})</td>
                      <td className="px-4 py-3 text-red-700 text-base">{formatCurrency(totals.total)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
