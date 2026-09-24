'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, BILLS_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'
import { StatCard } from '@/components/ui/StatCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { PersonalLedgerModal, PersonNameLink, type LedgerTarget } from '@/components/PersonalLedgerModal'
import { TrendingUp, TrendingDown, Wallet, ChevronDown, ChevronRight } from 'lucide-react'

interface PersonRow {
  key: string; personId: string | null; name: string; creditLimit: number | null
  opening: number; totalSigned: number; totalPaid: number; outstanding: number
}
interface Category {
  code: string; label: string; hasCreditLimit: boolean
  rows: PersonRow[]
  subtotal: { totalSigned: number; totalPaid: number; outstanding: number }
}
interface SummaryResp {
  period: { key: string; name: string; rangeLabel: string; full: boolean }
  months: { key: string; name: string; rangeLabel: string; anchor: string }[]
  outletId: string | null
  summary: { categories: Category[]; grandTotal: { totalSigned: number; totalPaid: number; outstanding: number } }
}

export default function ReceivableSummaryPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const isManagement = !!user && !['CASHIER', 'WAITER'].includes(user.role)

  const [data, setData] = useState<SummaryResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [anchor, setAnchor] = useState<string | null>(null) // selected business month
  const [outletId, setOutletId] = useState<string>('')
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [ledgerTarget, setLedgerTarget] = useState<LedgerTarget | null>(null)

  useEffect(() => {
    if (!isManagement) return
    request('/api/outlets').then((o) => setOutlets(o || [])).catch(() => {})
  }, [request, isManagement])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (anchor) params.set('date', anchor)
    if (outletId) params.set('outletId', outletId)
    try {
      const res: SummaryResp = await request(`/api/receivable-summary?${params}`)
      setData(res)
    } catch { /* toast via useApi */ }
    finally { setLoading(false) }
  }, [request, anchor, outletId])

  useEffect(() => { load() }, [load])

  const toggle = (code: string) => setCollapsed((s) => {
    const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n
  })

  const openLedger = (r: PersonRow, c: Category) => setLedgerTarget({
    personId: r.personId, personName: r.name, category: c.code, categoryLabel: c.label,
    anchor, outletId: outletId || null,
  })

  // ---- Export helpers (Spec v2 §B.5) ----
  const flatRows = useMemo(() => {
    if (!data) return []
    return data.summary.categories.flatMap((c) =>
      c.rows.map((r) => ({
        Category: c.label,
        Name: r.name,
        'Credit Limit': c.hasCreditLimit ? (r.creditLimit ?? 0) : '',
        'Total Signed': r.totalSigned,
        'Total Paid': r.totalPaid,
        Outstanding: r.outstanding,
      })),
    )
  }, [data])

  const periodLabel = data?.period.rangeLabel || ''

  const exportCSV = () => {
    if (!flatRows.length) return
    const keys = Object.keys(flatRows[0])
    const csv = [keys.join(','), ...flatRows.map((r) => keys.map((k) => `"${(r as Record<string, unknown>)[k] ?? ''}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `receivable-summary-${data?.period.key}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  const exportExcel = async () => {
    if (!data) return
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    // One sheet per category (with a subtotal row), then a Summary sheet.
    for (const c of data.summary.categories) {
      if (!c.rows.length) continue
      const rows = c.rows.map((r) => ({
        Name: r.name,
        'Credit Limit': c.hasCreditLimit ? (r.creditLimit ?? 0) : '',
        'Total Signed (CR)': r.totalSigned,
        'Total Paid (DR)': r.totalPaid,
        'Outstanding Balance': r.outstanding,
      }))
      rows.push({ Name: 'SUBTOTAL', 'Credit Limit': '', 'Total Signed (CR)': c.subtotal.totalSigned, 'Total Paid (DR)': c.subtotal.totalPaid, 'Outstanding Balance': c.subtotal.outstanding })
      const ws = XLSX.utils.json_to_sheet(rows)
      XLSX.utils.book_append_sheet(wb, ws, c.label.slice(0, 31))
    }
    const summaryRows = data.summary.categories.map((c) => ({
      Category: c.label,
      'Total Signed': c.subtotal.totalSigned,
      'Total Paid': c.subtotal.totalPaid,
      Outstanding: c.subtotal.outstanding,
    }))
    summaryRows.push({ Category: 'GRAND TOTAL', 'Total Signed': data.summary.grandTotal.totalSigned, 'Total Paid': data.summary.grandTotal.totalPaid, Outstanding: data.summary.grandTotal.outstanding })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary')
    XLSX.writeFile(wb, `receivable-summary-${data.period.key}.xlsx`)
  }

  const exportPDF = async (payload?: SummaryResp) => {
    const d = payload || data
    if (!d) return
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF()
    doc.setFontSize(15); doc.text('Daily Receivable Summary', 14, 16)
    doc.setFontSize(10); doc.setTextColor(100)
    doc.text(d.period.full ? 'Full history' : `Business month: ${d.period.rangeLabel}`, 14, 23)
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28)
    doc.setTextColor(0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let y = 33
    for (const c of d.summary.categories) {
      if (!c.rows.length) continue
      doc.setFontSize(11); doc.setTextColor(79, 70, 229); doc.text(c.label, 14, y); doc.setTextColor(0)
      const body = c.rows.map((r) => [
        r.name,
        c.hasCreditLimit ? (r.creditLimit ? formatCurrency(r.creditLimit) : '-') : '-',
        formatCurrency(r.totalSigned), formatCurrency(r.totalPaid), formatCurrency(r.outstanding),
      ])
      body.push(['SUBTOTAL', '', formatCurrency(c.subtotal.totalSigned), formatCurrency(c.subtotal.totalPaid), formatCurrency(c.subtotal.outstanding)])
      autoTable(doc, {
        startY: y + 3,
        head: [['Name', 'Credit Limit', 'Total Signed', 'Total Paid', 'Outstanding']],
        body,
        styles: { fontSize: 8 }, headStyles: { fillColor: [79, 70, 229] },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
        didParseCell: (cell) => { if (cell.section === 'body' && cell.row.index === body.length - 1) cell.cell.styles.fontStyle = 'bold' },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable.finalY + 8
      if (y > 260) { doc.addPage(); y = 16 }
    }
    doc.setFontSize(12); doc.text(
      `GRAND TOTAL   Signed ${formatCurrency(d.summary.grandTotal.totalSigned)}   Paid ${formatCurrency(d.summary.grandTotal.totalPaid)}   Outstanding ${formatCurrency(d.summary.grandTotal.outstanding)}`,
      14, y,
    )
    doc.save(`receivable-summary-${d.period.key}.pdf`)
  }

  const exportFullHistory = async () => {
    const params = new URLSearchParams()
    params.set('full', '1')
    if (outletId) params.set('outletId', outletId)
    const res: SummaryResp = await request(`/api/receivable-summary?${params}`)
    await exportPDF(res)
  }

  const gt = data?.summary.grandTotal

  return (
    <AppShell>
      <SectionTabs tabs={BILLS_TABS} />
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Receivable Summary</h1>
            <p className="text-gray-500 text-sm">
              Per-person outstanding by category{data && !data.period.full ? ` · ${data.period.rangeLabel}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isManagement && outlets.length > 0 && (
              <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
                className="px-3 py-2 rounded-xl text-sm border-2 border-gray-200 bg-white focus:border-indigo-500 focus:outline-none">
                <option value="">🏢 All Outlets</option>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            {data && (
              <select value={anchor ?? data.months[0]?.anchor ?? ''} onChange={(e) => setAnchor(e.target.value)}
                className="px-3 py-2 rounded-xl text-sm border-2 border-gray-200 bg-white focus:border-indigo-500 focus:outline-none">
                {data.months.map((m) => <option key={m.key} value={m.anchor}>{m.name} ({m.rangeLabel})</option>)}
              </select>
            )}
            <button onClick={exportCSV} className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-xl hover:bg-gray-200 transition">📄 CSV</button>
            <button onClick={exportExcel} className="px-3 py-2 bg-green-600 text-white text-sm rounded-xl hover:bg-green-700 transition">📊 Excel</button>
            <button onClick={() => exportPDF()} className="px-3 py-2 bg-red-600 text-white text-sm rounded-xl hover:bg-red-700 transition">📕 PDF</button>
            <button onClick={exportFullHistory} title="Export the full-history report (heavier)"
              className="px-3 py-2 bg-white border-2 border-gray-200 text-gray-700 text-sm rounded-xl hover:border-gray-300 transition">🗄️ Full History</button>
          </div>
        </div>

        {gt && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard icon={TrendingUp} tone="indigo" label="Total Signed (CR)" value={formatCurrency(gt.totalSigned)} sub="This period" />
            <StatCard icon={Wallet} tone="green" label="Total Paid (DR)" value={formatCurrency(gt.totalPaid)} sub="This period" />
            <StatCard icon={TrendingDown} tone="red" label="Total Outstanding" value={formatCurrency(gt.outstanding)} sub="Balance at period end" />
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">Loading…</div>
        ) : !data || data.summary.categories.every((c) => c.rows.length === 0) ? (
          <EmptyState icon="🎉" title="No receivables this period" hint="No signed or paid bills fall in the selected business month." />
        ) : (
          <div className="space-y-4">
            {data.summary.categories.map((c) => {
              if (!c.rows.length) return null
              const open = !collapsed.has(c.code)
              return (
                <div key={c.code} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <button onClick={() => toggle(c.code)}
                    className="w-full flex items-center justify-between p-4 border-b border-gray-100 hover:bg-gray-50 transition">
                    <div className="flex items-center gap-2">
                      {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                      <h2 className="font-semibold text-gray-800">{c.label}</h2>
                      <span className="text-xs text-gray-400">({c.rows.length})</span>
                    </div>
                    <span className="text-sm text-gray-500">
                      Outstanding: <strong className="text-red-600">{formatCurrency(c.subtotal.outstanding)}</strong>
                    </span>
                  </button>
                  {open && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr className="text-left text-gray-600">
                            <th className="px-4 py-2.5 font-semibold">Name</th>
                            {c.hasCreditLimit && <th className="px-4 py-2.5 font-semibold text-right">Credit Limit</th>}
                            <th className="px-4 py-2.5 font-semibold text-right">Total Signed (CR)</th>
                            <th className="px-4 py-2.5 font-semibold text-right">Total Paid (DR)</th>
                            <th className="px-4 py-2.5 font-semibold text-right">Outstanding</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {c.rows.map((r) => (
                            <tr key={r.key} className="hover:bg-indigo-50/40">
                              <td className="px-4 py-2.5">
                                <PersonNameLink name={r.name} outstanding={r.outstanding} onOpen={() => openLedger(r, c)} />
                              </td>
                              {c.hasCreditLimit && (
                                <td className="px-4 py-2.5 text-right text-gray-600">{r.creditLimit ? formatCurrency(r.creditLimit) : '—'}</td>
                              )}
                              <td className="px-4 py-2.5 text-right text-gray-800">{formatCurrency(r.totalSigned)}</td>
                              <td className="px-4 py-2.5 text-right text-green-600">{r.totalPaid ? formatCurrency(r.totalPaid) : '-'}</td>
                              <td className="px-4 py-2.5 text-right font-semibold text-red-600">{formatCurrency(r.outstanding)}</td>
                            </tr>
                          ))}
                          <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold text-gray-800">
                            <td className="px-4 py-2.5">Subtotal</td>
                            {c.hasCreditLimit && <td />}
                            <td className="px-4 py-2.5 text-right">{formatCurrency(c.subtotal.totalSigned)}</td>
                            <td className="px-4 py-2.5 text-right">{formatCurrency(c.subtotal.totalPaid)}</td>
                            <td className="px-4 py-2.5 text-right text-red-600">{formatCurrency(c.subtotal.outstanding)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Grand total (Excel "SUMMARY" block) */}
            {gt && (
              <div className="bg-indigo-600 text-white rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
                <span className="font-bold text-lg">Grand Total</span>
                <div className="flex flex-wrap gap-6 text-sm">
                  <span>Signed: <strong>{formatCurrency(gt.totalSigned)}</strong></span>
                  <span>Paid: <strong>{formatCurrency(gt.totalPaid)}</strong></span>
                  <span>Outstanding: <strong>{formatCurrency(gt.outstanding)}</strong></span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <PersonalLedgerModal target={ledgerTarget} onClose={() => setLedgerTarget(null)} />
    </AppShell>
  )
}
