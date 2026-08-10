'use client'
import { useCallback, useEffect, useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import { useApi } from '@/hooks/useApi'

// Personal Ledger modal (Spec v2 Task 2). Opened by clicking a person's name in
// the Receivable Summary (or anywhere a <PersonNameLink> is used). Shows one
// business month at a time: a live-computed Opening Balance (clickable to drill
// back to the prior month, recursively), the month's CR/DR entries with a
// running balance, and a bold Closing Balance. Export PDF covers the currently
// viewed month only (Spec v2 §D).

export interface LedgerTarget {
  personId?: string | null
  personName?: string | null
  /** billType of the summary row this was drilled from — scopes the ledger so
   *  its Closing matches that row's Outstanding. */
  category?: string | null
  /** Human label for the category, shown in the header. */
  categoryLabel?: string | null
  /** ISO date within the business month to open on (defaults to current). */
  anchor?: string | null
  /** Optional outlet scope (management cross-outlet views). */
  outletId?: string | null
}

interface LedgerEntry { date: string; reference: string; cr: number; dr: number; balance: number }
interface LedgerData {
  period: { key: string; name: string; rangeLabel: string }
  prevMonthAnchor: string
  ledger: { personId: string | null; name: string; opening: number; entries: LedgerEntry[]; closing: number; hasPrior: boolean }
}

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export function PersonalLedgerModal({ target, onClose }: { target: LedgerTarget | null; onClose: () => void }) {
  const { request } = useApi()
  const [data, setData] = useState<LedgerData | null>(null)
  const [loading, setLoading] = useState(false)
  // Breadcrumb of anchors as the user drills back through prior months.
  const [trail, setTrail] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)

  // Reset drill state whenever a new person is opened.
  useEffect(() => {
    if (!target) { setData(null); setTrail([]); setAnchor(null); return }
    setTrail([])
    setAnchor(target.anchor || null)
  }, [target])

  const load = useCallback(async () => {
    if (!target) return
    setLoading(true)
    const params = new URLSearchParams()
    if (target.personId) params.set('personId', target.personId)
    else if (target.personName) params.set('personName', target.personName)
    if (target.category) params.set('category', target.category)
    if (anchor) params.set('date', anchor)
    if (target.outletId) params.set('outletId', target.outletId)
    try {
      const res = await request(`/api/receivable-summary/ledger?${params}`)
      setData(res)
    } catch { /* surfaced by useApi's toast */ }
    finally { setLoading(false) }
  }, [request, target, anchor])

  useEffect(() => { if (target) load() }, [target, load])

  if (!target) return null

  const drillBack = () => {
    if (!data?.ledger.hasPrior) return
    setTrail((t) => [...t, anchor || new Date().toISOString()])
    setAnchor(data.prevMonthAnchor)
  }
  const goForward = () => {
    setTrail((t) => {
      const next = [...t]
      const prev = next.pop()
      setAnchor(prev || null)
      return next
    })
  }

  const exportPDF = async () => {
    if (!data) return
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF()
    const L = data.ledger
    doc.setFontSize(15); doc.text(`Personal Ledger — ${L.name}`, 14, 16)
    doc.setFontSize(10); doc.setTextColor(100)
    doc.text(`Business month: ${data.period.rangeLabel}`, 14, 23)
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28)
    doc.setTextColor(0)
    const body = [
      ['', 'Opening Balance', '', '', formatCurrency(L.opening)],
      ...L.entries.map((e) => [
        fmtDate(e.date), e.reference,
        e.cr ? formatCurrency(e.cr) : '', e.dr ? formatCurrency(e.dr) : '',
        formatCurrency(e.balance),
      ]),
      ['', 'Closing Balance', '', '', formatCurrency(L.closing)],
    ]
    autoTable(doc, {
      startY: 33,
      head: [['Date', 'Reference', 'Signed (CR)', 'Paid (DR)', 'Balance']],
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [79, 70, 229] },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      didParseCell: (d) => {
        if (d.section === 'body' && (d.row.index === 0 || d.row.index === body.length - 1)) {
          d.cell.styles.fontStyle = 'bold'
          d.cell.styles.fillColor = [243, 244, 246]
        }
      },
    })
    doc.save(`personal-ledger-${L.name.replace(/\s+/g, '-').toLowerCase()}-${data.period.key}.pdf`)
  }

  const L = data?.ledger

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-bold text-gray-900">📇 {L?.name || target.personName || 'Personal Ledger'}</h3>
            {data && <p className="text-xs text-gray-500">{target.categoryLabel ? `${target.categoryLabel} · ` : ''}{data.period.rangeLabel}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportPDF} disabled={!data}
              className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-xl hover:bg-red-700 transition disabled:opacity-50">📕 PDF</button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
          </div>
        </div>

        {/* Breadcrumb when drilled back into prior months */}
        {trail.length > 0 && (
          <div className="px-4 pt-3">
            <button onClick={goForward} className="text-sm text-indigo-600 hover:underline">← Back to later month</button>
          </div>
        )}

        <div className="p-4">
          {loading && <div className="py-12 text-center text-gray-400">Loading…</div>}
          {!loading && L && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Reference</th>
                    <th className="px-3 py-2 font-semibold text-right">Signed (CR)</th>
                    <th className="px-3 py-2 font-semibold text-right">Paid (DR)</th>
                    <th className="px-3 py-2 font-semibold text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {/* Opening balance — clickable to drill to the prior month */}
                  <tr className="bg-gray-50/70">
                    <td className="px-3 py-2 text-gray-400">—</td>
                    <td className="px-3 py-2 font-semibold text-gray-700">
                      {L.hasPrior ? (
                        <button onClick={drillBack} className="text-indigo-600 hover:underline" title="View the previous business month">
                          Opening Balance ↩
                        </button>
                      ) : (
                        <span>Opening Balance</span>
                      )}
                    </td>
                    <td /><td />
                    <td className="px-3 py-2 text-right font-semibold text-gray-800">{formatCurrency(L.opening)}</td>
                  </tr>
                  {L.entries.map((e, i) => (
                    <tr key={i} className="hover:bg-indigo-50/40">
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtDate(e.date)}</td>
                      <td className="px-3 py-2 text-gray-700">{e.reference}</td>
                      <td className="px-3 py-2 text-right text-gray-800">{e.cr ? formatCurrency(e.cr) : '-'}</td>
                      <td className="px-3 py-2 text-right text-green-600">{e.dr ? formatCurrency(e.dr) : '-'}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800">{formatCurrency(e.balance)}</td>
                    </tr>
                  ))}
                  {L.entries.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No activity this month.</td></tr>
                  )}
                  {/* Closing balance */}
                  <tr className="bg-gray-100 border-t-2 border-gray-200">
                    <td /><td className="px-3 py-2 font-bold text-gray-900">Closing Balance</td>
                    <td /><td />
                    <td className="px-3 py-2 text-right font-bold text-red-600">{formatCurrency(L.closing)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * A person's name rendered as a hover-preview + click-to-open affordance
 * (Spec v2 §A.1: hover shows a lightweight card with the outstanding balance,
 * click opens the full Personal Ledger — hover deliberately does NOT open the
 * modal). `outstanding` is passed in from the already-loaded summary row, so
 * the hover card needs no extra request.
 */
export function PersonNameLink({ name, outstanding, onOpen }: {
  name: string
  outstanding?: number | null
  onOpen: () => void
}) {
  return (
    <span className="relative inline-block group">
      <button onClick={onOpen} className="font-medium text-indigo-700 hover:underline text-left">
        {name}
      </button>
      <span className="pointer-events-none absolute left-0 top-full mt-1 z-20 hidden group-hover:block whitespace-nowrap rounded-lg bg-gray-900 text-white text-xs px-3 py-2 shadow-lg">
        <span className="block font-semibold">{name}</span>
        {outstanding != null && (
          <span className="block text-gray-300">Outstanding: {formatCurrency(outstanding)}</span>
        )}
        <span className="block text-gray-400 mt-0.5">Click for full ledger</span>
      </span>
    </span>
  )
}
