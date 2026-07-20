'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, DAILY_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

interface Outlet { id: string; name: string }

interface ReportData {
  date: string
  outletName: string
  generatedBy: string
  collection: { systemSales: number; cash: number; channels: { code: string; label: string; amount: number }[]; total: number; variance: number }
  signed: { byType: Record<string, number>; rows: { type: string; name: string; staff: string; amount: number }[]; total: number }
  paid: { byMethod: { code: string; label: string; amount: number }[]; rows: { name: string; category: string; method: string; amount: number }[]; total: number; cash: number }
  cancellations: { rows: { product: string; staff: string; qty: number; amount: number; reason: string }[]; total: number }
  pettyCash: { rows: { purpose: string; by: string; dept: string; method: string; amount: number; status: string }[]; total: number; approved: number }
  settlementsPaidFromTill?: number
  cashInHand: number
}

const SIGNED_LABELS: Record<string, string> = {
  ADMIN: 'Admin', DIRECTOR: 'Director', CUSTOMER: 'Customer', TIPS: 'Tips', DJ: 'DJ', STAFF_LOSS: 'Staff Loss',
}

export default function DailyReportPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [outletId, setOutletId] = useState('')
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)

  const isCashier = user?.role === 'CASHIER'

  useEffect(() => {
    if (!isCashier) request('/api/outlets').then((o) => setOutlets(o || [])).catch(() => {})
  }, [isCashier, request])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ date })
      if (!isCashier && outletId) qs.set('outletId', outletId)
      const r = await request(`/api/reports/daily-report?${qs.toString()}`)
      setData(r)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load report')
    } finally { setLoading(false) }
  }, [date, outletId, isCashier, request])

  useEffect(() => { load() }, [load])

  const [busy, setBusy] = useState(false)

  // Build a clean one-page PDF (Blob) from the report — mirrors the on-screen layout.
  const buildPdf = async (d: ReportData) => {
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF()
    const W = doc.internal.pageSize.getWidth()
    const n = (v: number) => Number(v).toLocaleString('en-US')

    // Header band
    doc.setFillColor(79, 70, 229); doc.rect(0, 0, W, 28, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(20); doc.setFont('helvetica', 'bold'); doc.text('tips', 14, 14)
    doc.setFontSize(11); doc.setFont('helvetica', 'normal'); doc.text('CASHIER DAILY REPORT', 14, 22)
    doc.setFontSize(10)
    doc.text(d.outletName, W - 14, 12, { align: 'right' })
    doc.text(format(new Date(d.date), 'EEEE, dd MMM yyyy'), W - 14, 18, { align: 'right' })
    doc.text(`By: ${d.generatedBy || '—'}`, W - 14, 24, { align: 'right' })
    doc.setTextColor(31, 41, 55)

    const base = {
      theme: 'grid' as const, styles: { fontSize: 9 },
      headStyles: { fillColor: [79, 70, 229] as [number, number, number] },
      margin: { left: 14, right: 14 }, columnStyles: { 1: { halign: 'right' as const } },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const afterY = () => (doc as any).lastAutoTable.finalY + 5
    const foot = (rgb: [number, number, number], white = false) => ({ fillColor: rgb, textColor: (white ? [255, 255, 255] : [31, 41, 55]) as [number, number, number], fontStyle: 'bold' as const })

    autoTable(doc, {
      ...base, startY: 34,
      head: [['COLLECTION (SALES)', 'TZS']],
      body: [
        ['System Sales', n(d.collection.systemSales)],
        ['Cash', n(d.collection.cash)],
        ...d.collection.channels.map((c) => [c.label, n(c.amount)]),
        ['Variance (Collected − System)', n(d.collection.variance)],
      ],
      foot: [['TOTAL COLLECTED', n(d.collection.total)]], footStyles: foot([238, 242, 255]),
    })
    autoTable(doc, {
      ...base, startY: afterY(),
      head: [['SIGNED BILLS', 'TYPE', 'TZS']], columnStyles: { 2: { halign: 'right' } },
      body: d.signed.rows.length ? d.signed.rows.map((r) => [`${r.name}${r.staff ? ` — ${r.staff}` : ''}`, SIGNED_LABELS[r.type] || r.type, n(r.amount)]) : [['No signed bills', '', '0']],
      foot: [['TOTAL SIGNED BILLS', '', n(d.signed.total)]], footStyles: foot([255, 247, 237]),
    })
    autoTable(doc, {
      ...base, startY: afterY(),
      head: [['PAID BILLS (DEBTS COLLECTED)', 'METHOD', 'TZS']], columnStyles: { 2: { halign: 'right' } },
      body: d.paid.rows.length ? d.paid.rows.map((r) => [`${r.name}${r.category ? ` (${r.category})` : ''}`, r.method, n(r.amount)]) : [['No paid bills', '', '0']],
      foot: [['TOTAL PAID BILLS', '', n(d.paid.total)]], footStyles: foot([236, 253, 245]),
    })
    if (d.cancellations.rows.length) {
      autoTable(doc, {
        ...base, startY: afterY(),
        head: [['CANCELLATIONS', 'QTY', 'TZS']], columnStyles: { 2: { halign: 'right' } },
        body: d.cancellations.rows.map((r) => [`${r.product}${r.staff ? ` — ${r.staff}` : ''}`, String(r.qty), n(r.amount)]),
        foot: [['TOTAL CANCELLATIONS', '', n(d.cancellations.total)]], footStyles: foot([255, 241, 242]),
      })
    }
    autoTable(doc, {
      ...base, startY: afterY(),
      head: [['PETTY CASH / EXPENSES', 'STATUS', 'TZS']], columnStyles: { 2: { halign: 'right' } },
      body: d.pettyCash.rows.length ? d.pettyCash.rows.map((r) => [`${r.purpose}${r.by ? ` — ${r.by}` : ''}`, r.status, n(r.amount)]) : [['No petty cash', '', '0']],
      foot: [['TOTAL PETTY CASH', '', n(d.pettyCash.total)]], footStyles: foot([240, 253, 244]),
    })
    autoTable(doc, {
      ...base, startY: afterY(),
      head: [['SUMMARY', 'TZS']],
      body: [
        ['Approved Petty Cash Paid Out', n(d.pettyCash.approved)],
        ...(d.settlementsPaidFromTill ? [['Cash Settlements Paid From Till', n(d.settlementsPaidFromTill)]] : []),
      ],
      foot: [['CASH IN HAND', n(d.cashInHand)]], footStyles: foot([79, 70, 229], true),
    })
    doc.setFontSize(8); doc.setTextColor(150)
    doc.text(`Generated ${format(new Date(), 'dd MMM yyyy HH:mm')} · tips Cashier Management`, 14, doc.internal.pageSize.getHeight() - 8)
    return doc
  }

  const fileName = (d: ReportData) => `tips-daily-${d.outletName.replace(/\s+/g, '-')}-${format(new Date(d.date), 'yyyy-MM-dd')}.pdf`

  // One-tap share via the phone's native share sheet (→ WhatsApp); falls back to download.
  const shareReport = async () => {
    if (!data) return
    setBusy(true)
    try {
      const doc = await buildPdf(data)
      const blob = doc.output('blob')
      const file = new File([blob], fileName(data), { type: 'application/pdf' })
      const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean }
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: 'tips Daily Report', text: `Daily Report — ${data.outletName}, ${format(new Date(data.date), 'dd MMM yyyy')}` })
      } else {
        doc.save(fileName(data))
        toast.success('PDF downloaded — share it in WhatsApp')
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return // user cancelled the share sheet
      toast.error(err instanceof Error ? err.message : 'Could not share report')
    } finally { setBusy(false) }
  }

  const downloadReport = async () => {
    if (!data) return
    setBusy(true)
    try { (await buildPdf(data)).save(fileName(data)); toast.success('PDF downloaded') }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not build PDF') }
    finally { setBusy(false) }
  }

  const [emailing, setEmailing] = useState(false)
  const emailSummary = async () => {
    setEmailing(true)
    try {
      const qs = new URLSearchParams({ date })
      if (!isCashier && outletId) qs.set('outletId', outletId)
      const r = await request(`/api/daily-summary/send?${qs}`, { method: 'POST' })
      toast.success(`Summary emailed to ${r.recipients?.length || 0} director(s)${r.mode === 'ethereal' ? ' (test inbox)' : ''}.`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not email summary')
    } finally { setEmailing(false) }
  }

  const money = (n: number) => formatCurrency(n)
  const prettyDate = data ? format(new Date(data.date), 'EEEE, dd MMMM yyyy') : ''

  return (
    <AppShell>
      <SectionTabs tabs={DAILY_TABS} />
      <div className="space-y-5">
        {/* Controls (hidden when printing) */}
        <div className="no-print flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Cashier Daily Report</h1>
            <p className="text-gray-500 text-sm">Download a one-page summary to share with directors.</p>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
            </div>
            {!isCashier && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Outlet</label>
                <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
                  className="px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                  <option value="">All Outlets</option>
                  {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            )}
            <button onClick={shareReport} disabled={!data || busy}
              className="px-5 py-2.5 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition shadow disabled:opacity-50">
              {busy ? 'Preparing…' : '📲 Share to WhatsApp'}
            </button>
            <button onClick={downloadReport} disabled={!data || busy}
              className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow disabled:opacity-50">
              📥 PDF
            </button>
            <button onClick={() => window.print()} disabled={!data}
              className="px-4 py-2.5 bg-white border-2 border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition disabled:opacity-50">
              🖨 Print
            </button>
            {!isCashier && (
              <button onClick={emailSummary} disabled={!data || emailing}
                className="px-4 py-2.5 bg-amber-500 text-white rounded-xl font-medium hover:bg-amber-600 transition shadow disabled:opacity-50">
                {emailing ? 'Sending…' : '📧 Email Directors'}
              </button>
            )}
          </div>
        </div>

        <p className="no-print text-xs text-gray-400">
          Tap <b>📲 Share to WhatsApp</b> on your phone to send the PDF straight to the directors&apos; group. On a computer, use <b>📥 PDF</b> to download, or <b>🖨 Print</b> → “Save as PDF”.
        </p>

        {loading && <div className="py-16 text-center text-gray-400">Loading report…</div>}

        {/* The printable report */}
        {data && !loading && (
          <div className="print-area bg-white rounded-2xl shadow-sm border border-gray-200 p-6 md:p-8 max-w-3xl mx-auto">
            {/* Header */}
            <div className="text-center border-b-2 border-gray-200 pb-4 mb-5">
              <div className="text-3xl font-extrabold tracking-wide text-gray-900">tips</div>
              <h2 className="text-lg font-bold text-gray-800 mt-1">Cashier Sales Report — {data.outletName}</h2>
              <p className="text-gray-500 text-sm">{prettyDate}</p>
            </div>

            {/* Collection */}
            <Section title="1 · Collection (Sales)">
              <Row label="System Sales" value={money(data.collection.systemSales)} bold />
              <Row label="Cash" value={money(data.collection.cash)} />
              {data.collection.channels.map((c) => <Row key={c.code} label={c.label} value={money(c.amount)} />)}
              <Row label="Total Collected" value={money(data.collection.total)} bold accent />
              <Row label="Variance (Collected − System)"
                value={money(data.collection.variance)}
                valueClass={data.collection.variance < 0 ? 'text-red-600' : data.collection.variance > 0 ? 'text-green-600' : ''} />
            </Section>

            {/* Signed bills */}
            <Section title="2 · Signed Bills (credit given)">
              {data.signed.rows.length === 0 ? (
                <Empty>No signed bills</Empty>
              ) : (
                <>
                  <MiniTable
                    head={['Type', 'Name', 'Staff', 'Amount']}
                    rows={data.signed.rows.map((r) => [SIGNED_LABELS[r.type] || r.type, r.name, r.staff, money(r.amount)])}
                  />
                  <Row label="Total Signed Bills" value={money(data.signed.total)} bold accent />
                </>
              )}
            </Section>

            {/* Paid bills */}
            <Section title="3 · Paid Bills (debts collected)">
              {data.paid.rows.length === 0 ? (
                <Empty>No paid bills</Empty>
              ) : (
                <>
                  <MiniTable
                    head={['Payer', 'Category', 'Method', 'Amount']}
                    rows={data.paid.rows.map((r) => [r.name, r.category, r.method, money(r.amount)])}
                  />
                  <Row label="Total Paid Bills" value={money(data.paid.total)} bold accent />
                </>
              )}
            </Section>

            {/* Cancellations */}
            <Section title="4 · Cancellations">
              {data.cancellations.rows.length === 0 ? (
                <Empty>No cancellations</Empty>
              ) : (
                <>
                  <MiniTable
                    head={['Product', 'Staff', 'Qty', 'Amount']}
                    rows={data.cancellations.rows.map((r) => [r.product, r.staff, String(r.qty), money(r.amount)])}
                  />
                  <Row label="Total Cancellations" value={money(data.cancellations.total)} bold accent />
                </>
              )}
            </Section>

            {/* Petty cash */}
            <Section title="5 · Petty Cash / Expenses">
              {data.pettyCash.rows.length === 0 ? (
                <Empty>No petty cash</Empty>
              ) : (
                <>
                  <MiniTable
                    head={['Purpose', 'Requested By', 'Status', 'Amount']}
                    rows={data.pettyCash.rows.map((r) => [r.purpose, r.by, r.status, money(r.amount)])}
                  />
                  <Row label="Total Petty Cash" value={money(data.pettyCash.total)} bold accent />
                  <Row label="Approved & Paid Out" value={money(data.pettyCash.approved)} />
                </>
              )}
            </Section>

            {/* Settlements paid from the till (separate from operational collections) */}
            {!!data.settlementsPaidFromTill && data.settlementsPaidFromTill !== 0 && (
              <Section title="6 · SETTLEMENTS PAID FROM TILL">
                <Row label="Excess/reconciliation payouts (cash)" value={money(data.settlementsPaidFromTill)} bold accent />
                <p className="text-xs text-gray-400 mt-1">Cash paid out to settle payable over-collections — reduces cash in hand, not an operational expense.</p>
              </Section>
            )}

            {/* Cash in hand */}
            <div className="mt-6 rounded-xl bg-indigo-50 border-2 border-indigo-200 p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-indigo-900">Cash in Hand</p>
                <p className="text-xs text-indigo-500">Cash collected + cash debts − approved petty cash{data.settlementsPaidFromTill ? ' − cash settlements paid' : ''}</p>
              </div>
              <p className="text-2xl font-extrabold text-indigo-700">{money(data.cashInHand)}</p>
            </div>

            <p className="text-center text-xs text-gray-400 mt-6">
              Generated by {data.generatedBy || '—'} · {format(new Date(), 'dd MMM yyyy HH:mm')} · tips Cashier Management
            </p>
          </div>
        )}
      </div>
    </AppShell>
  )
}

/* ---------- small presentational helpers ---------- */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-sm font-bold uppercase tracking-wide text-indigo-700 border-b border-gray-200 pb-1 mb-2">{title}</h3>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function Row({ label, value, bold, accent, valueClass = '' }: { label: string; value: string; bold?: boolean; accent?: boolean; valueClass?: string }) {
  return (
    <div className={`flex items-center justify-between py-1 text-sm ${accent ? 'bg-yellow-50 px-2 rounded' : ''}`}>
      <span className={`${bold ? 'font-bold text-gray-900' : 'text-gray-600'}`}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-bold text-gray-900' : 'text-gray-800'} ${valueClass}`}>{value}</span>
    </div>
  )
}

function MiniTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full text-xs mb-1">
      <thead>
        <tr className="text-left text-gray-500 border-b border-gray-200">
          {head.map((h, i) => <th key={i} className={`py-1 font-semibold ${i === head.length - 1 ? 'text-right' : ''}`}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-gray-50">
            {r.map((c, ci) => <td key={ci} className={`py-1 ${ci === r.length - 1 ? 'text-right tabular-nums font-medium text-gray-800' : 'text-gray-600'}`}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-400 italic py-1">{children}</p>
}
