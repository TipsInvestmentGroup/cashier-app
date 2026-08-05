'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
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
  signed: {
    byType: Record<string, number>
    rows: { type: string; name: string; staff: string; amount: number }[]
    byCategory: { key: string; label: string; total: number; people: { name: string; total: number; details: { who: string; amt: number }[] }[] }[]
    total: number
  }
  paid: {
    byMethod: { code: string; label: string; amount: number }[]
    rows: { name: string; category: string; method: string; amount: number }[]
    byCategory: { key: string; label: string; total: number; payers: { name: string; amount: number; method: string }[] }[]
    total: number; cash: number
  }
  cancellations: { rows: { product: string; staff: string; qty: number; amount: number; reason: string }[]; total: number }
  pettyCash: { rows: { purpose: string; by: string; dept: string; method: string; amount: number; status: string }[]; total: number; approved: number }
  settlementsPaidFromTill?: number
  cashInHand: number
}

const CATEGORY_COLORS: Record<string, string> = {
  DIRECTOR: '#5b4fd6', ADMIN: '#6b7386', CUSTOMER: '#2f9e83', TIPS: '#c9822f', STAFF_LOSS: '#c0392b',
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
  const printRef = useRef<HTMLDivElement>(null)

  // Build the PDF (Blob) by snapshotting the actual rendered report — so the
  // PDF is a pixel match of the on-screen neumorphism design, not a separately
  // drawn table. Renders a fixed-width (760px) clone off-screen so the PDF looks
  // the same regardless of the viewport it was triggered from (mobile vs desktop).
  const buildPdf = async () => {
    const node = printRef.current
    if (!node) throw new Error('Report not ready')
    const html2canvas = (await import('html2canvas')).default
    const { jsPDF } = await import('jspdf')

    const wrapper = document.createElement('div')
    wrapper.style.position = 'fixed'
    wrapper.style.top = '0'
    wrapper.style.left = '-9999px'
    wrapper.style.width = '760px'
    const clone = node.cloneNode(true) as HTMLElement
    clone.removeAttribute('id')
    // Flatten the neumorphic box-shadows to borders for the snapshot — html2canvas
    // renders screen media (not @media print) and peels shadow+radius corners.
    clone.classList.add('cdr-flat')
    clone.style.width = '760px'
    clone.style.maxWidth = '760px'
    clone.style.margin = '0'
    wrapper.appendChild(clone)
    document.body.appendChild(wrapper)

    try {
      const scale = 2
      // Record every row-like element's vertical span (in canvas px) BEFORE
      // rendering, so page breaks can be nudged to a gap between rows instead
      // of slicing straight through one — html2canvas pagination is just
      // pixel-cropping and has no concept of "don't break inside this row"
      // the way a real browser print does.
      const rootTop = clone.getBoundingClientRect().top
      const unsafeSelector = '.cdr-row, .cdr-ledger-item, .cdr-collection-grid .cdr-cell, .cdr-total-row, .cdr-ref-line, .cdr-variance-row, .cdr-category-title'
      const unsafeRanges = Array.from(clone.querySelectorAll(unsafeSelector))
        .map((el) => {
          const r = el.getBoundingClientRect()
          return [(r.top - rootTop) * scale, (r.bottom - rootTop) * scale] as [number, number]
        })
        .sort((a, b) => a[0] - b[0])

      const canvas = await html2canvas(clone, { scale, backgroundColor: '#e9edf3', useCORS: true })

      // If an ideal page-break y falls inside a row's span, back it up to
      // that row's top — unless that would leave the page nearly empty
      // (a pathological single-row-taller-than-a-page case), in which case
      // just allow the cut through it as a last resort.
      const adjustBreak = (idealY: number, pageStartY: number) => {
        for (const [start, end] of unsafeRanges) {
          if (idealY > start && idealY < end) {
            return start - pageStartY >= (idealY - pageStartY) * 0.3 ? start : idealY
          }
        }
        return idealY
      }

      const pageWidthMm = 210
      const pageHeightMm = 297
      const marginMm = 10
      const usableWidthMm = pageWidthMm - marginMm * 2
      const usableHeightMm = pageHeightMm - marginMm * 2
      let pxPerMm = canvas.width / usableWidthMm
      let pageHeightPx = Math.floor(usableHeightMm * pxPerMm)

      // If the content only slightly overflows one page (e.g. a light day whose
      // last line is just the footer), shrink it a little to fit on a single
      // page rather than spilling one line onto an almost-blank second page.
      const OVERFLOW_TOLERANCE = 1.12
      if (canvas.height > pageHeightPx && canvas.height <= pageHeightPx * OVERFLOW_TOLERANCE) {
        pxPerMm = canvas.height / usableHeightMm
        pageHeightPx = canvas.height
      }

      // Width in mm the image is actually drawn at — equals usableWidthMm unless
      // the shrink-to-fit branch above rescaled by height instead of width.
      const drawWidthMm = canvas.width / pxPerMm
      const xOffsetMm = marginMm + (usableWidthMm - drawWidthMm) / 2

      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      let renderedPx = 0
      let firstPage = true
      while (renderedPx < canvas.height) {
        let idealEnd = Math.min(renderedPx + pageHeightPx, canvas.height)
        if (idealEnd < canvas.height) idealEnd = adjustBreak(idealEnd, renderedPx)
        const sliceHeightPx = Math.max(idealEnd - renderedPx, 1)
        const sliceCanvas = document.createElement('canvas')
        sliceCanvas.width = canvas.width
        sliceCanvas.height = sliceHeightPx
        const ctx = sliceCanvas.getContext('2d')
        if (!ctx) break
        ctx.drawImage(canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx)
        if (!firstPage) doc.addPage()
        // JPEG, not PNG: this design has no transparency, and lossless PNG
        // compresses the soft box-shadow gradients (pressed/raised rows,
        // dozens per report) very poorly — JPEG's DCT compression handles
        // smooth gradients far better, cutting file size drastically with
        // no visible loss on this mostly-flat UI content.
        doc.addImage(sliceCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', xOffsetMm, marginMm, drawWidthMm, sliceHeightPx / pxPerMm)
        renderedPx += sliceHeightPx
        firstPage = false
      }
      return doc
    } finally {
      document.body.removeChild(wrapper)
    }
  }

  const fileName = (d: ReportData) => `tips-daily-${d.outletName.replace(/\s+/g, '-')}-${format(new Date(d.date), 'yyyy-MM-dd')}.pdf`

  // One-tap share via the phone's native share sheet (→ WhatsApp); falls back to download.
  const shareReport = async () => {
    if (!data) return
    setBusy(true)
    try {
      const doc = await buildPdf()
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
    try { (await buildPdf()).save(fileName(data)); toast.success('PDF downloaded') }
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

  // ── Draft / finalize lifecycle ──
  const [savedReport, setSavedReport] = useState<{ status: string; needsReview: boolean; reviewReason?: string; savedByName?: string; finalizedByName?: string; finalizedAt?: string } | null>(null)
  const [draftBusy, setDraftBusy] = useState(false)
  const loadSaved = useCallback(async () => {
    try { const qs = new URLSearchParams({ date }); if (!isCashier && outletId) qs.set('outletId', outletId); const r = await request(`/api/daily-reports?${qs}`); setSavedReport(r.report) }
    catch { setSavedReport(null) }
  }, [date, outletId, isCashier, request])
  useEffect(() => { loadSaved() }, [loadSaved])

  const canFinalize = isCashier || !!outletId // mgmt must pick a specific outlet
  const submitReport = async (mode: 'draft' | 'finalize' | 'reopen') => {
    if (mode !== 'reopen' && !data) return
    if (!isCashier && !outletId) return toast.error('Select a specific outlet to save or finalize.')
    setDraftBusy(true)
    try {
      const bodyBase = { date, outletId: isCashier ? undefined : outletId, data }
      if (mode === 'draft') { await request('/api/daily-reports', { method: 'POST', body: JSON.stringify(bodyBase) }); toast.success('Saved as draft — you can keep editing.') }
      else if (mode === 'finalize') { await request('/api/daily-reports', { method: 'PATCH', body: JSON.stringify({ ...bodyBase, action: 'finalize' }) }); toast.success('Report finalized.') }
      else { await request('/api/daily-reports', { method: 'PATCH', body: JSON.stringify({ date, outletId: isCashier ? undefined : outletId, action: 'reopen' }) }); toast.success('Report reopened for editing.') }
      loadSaved()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setDraftBusy(false) }
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
            {savedReport?.status !== 'FINALIZED' && (
              <button onClick={() => submitReport('draft')} disabled={!data || draftBusy}
                className="px-4 py-2.5 bg-white border-2 border-indigo-200 text-indigo-700 rounded-xl font-medium hover:bg-indigo-50 transition disabled:opacity-50">
                💾 Save Draft
              </button>
            )}
            {savedReport?.status === 'FINALIZED' ? (
              <button onClick={() => submitReport('reopen')} disabled={draftBusy}
                className="px-4 py-2.5 bg-white border-2 border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition disabled:opacity-50">
                🔓 Reopen
              </button>
            ) : (
              <button onClick={() => submitReport('finalize')} disabled={!data || draftBusy || !canFinalize}
                className="px-4 py-2.5 bg-green-700 text-white rounded-xl font-medium hover:bg-green-800 transition shadow disabled:opacity-50">
                {draftBusy ? 'Saving…' : '✅ Finalize'}
              </button>
            )}
            {!isCashier && (
              <button onClick={emailSummary} disabled={!data || emailing}
                className="px-4 py-2.5 bg-amber-500 text-white rounded-xl font-medium hover:bg-amber-600 transition shadow disabled:opacity-50">
                {emailing ? 'Sending…' : '📧 Email Directors'}
              </button>
            )}
          </div>
        </div>

        <p className="no-print text-xs text-gray-400">
          Tap <b>📲 Share to WhatsApp</b> on your phone to send the PDF straight to the directors&apos; group. On a computer, use <b>📥 PDF</b> to download, or <b>🖨 Print</b> → “Save as PDF”. Save a <b>Draft</b> while imported sales await approval, then <b>Finalize</b> once the figures are confirmed — only finalized reports are used for reconciliation & finance.
        </p>

        {/* Draft / finalize status banner (hidden when printing) */}
        {savedReport && (
          <div className={`no-print rounded-xl px-4 py-3 text-sm border flex items-center gap-2 ${
            savedReport.needsReview ? 'bg-amber-50 border-amber-200 text-amber-800'
            : savedReport.status === 'FINALIZED' ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-indigo-50 border-indigo-200 text-indigo-800'}`}>
            {savedReport.needsReview ? (
              <span>⚠ <b>Needs review:</b> {savedReport.reviewReason || 'Sales changed after this report was saved.'} The figures below are refreshed — review and <b>Finalize</b>.</span>
            ) : savedReport.status === 'FINALIZED' ? (
              <span>✅ <b>Finalized</b>{savedReport.finalizedByName ? ` by ${savedReport.finalizedByName}` : ''}{savedReport.finalizedAt ? ` on ${format(new Date(savedReport.finalizedAt), 'dd MMM yyyy HH:mm')}` : ''}. This report is authoritative for reconciliation & finance.</span>
            ) : (
              <span>📝 <b>Draft saved</b>{savedReport.savedByName ? ` by ${savedReport.savedByName}` : ''}. Keep editing, then Finalize when confirmed.</span>
            )}
          </div>
        )}

        {loading && <div className="py-16 text-center text-gray-400">Loading report…</div>}

        {/* The printable report */}
        {data && !loading && (
          <div ref={printRef} id="reportPrintArea" className="print-area cdr-panel max-w-3xl mx-auto">
            {/* Header */}
            <div className="cdr-header">
              <div className="cdr-header-top" style={{ justifyContent: 'center', textAlign: 'center', flexDirection: 'column' }}>
                <div className="cdr-logo-badge">tips</div>
                <div>
                  <div className="cdr-company-name">Tips Investment Limited</div>
                  <div className="cdr-company-addr">{data.outletName}</div>
                </div>
              </div>
              <div className="cdr-meta">
                <div>
                  <h1 className="cdr-title">Cashier daily report</h1>
                  <div className="cdr-sub">By {data.generatedBy || '—'}</div>
                </div>
                <div className="cdr-right">
                  <span>{data.outletName}</span><br />
                  <span>{prettyDate}</span>
                </div>
              </div>
            </div>

            {/* Collection */}
            <section className="cdr-section">
              <h2 className="cdr-section-title"><span>Collection (sales)</span><span>TSh</span></h2>
              <div className="cdr-ref-line"><span>System sales (per POS, for comparison only)</span><b>{money(data.collection.systemSales)}</b></div>
              <div className="cdr-collection-grid">
                <div className="cdr-cell"><div className="cdr-label">Cash</div><div className="cdr-amount">{money(data.collection.cash)}</div></div>
                {data.collection.channels.map((c) => (
                  <div key={c.code} className="cdr-cell"><div className="cdr-label">{c.label}</div><div className="cdr-amount">{money(c.amount)}</div></div>
                ))}
              </div>
              <div className="cdr-total-row"><span>Total collected</span><span>{money(data.collection.total)}</span></div>
              <div className="cdr-variance-row">
                <span>Variance (collected − system sales)</span>
                <span className={`cdr-amount ${data.collection.variance < 0 ? 'cdr-neg' : ''}`}>{money(data.collection.variance)}</span>
              </div>
            </section>

            {/* Signed bills — grouped by category, then by signer */}
            <section className="cdr-section">
              <h2 className="cdr-section-title"><span>Signed bills — by category, then by person</span><span>TSh</span></h2>
              {data.signed.byCategory.length === 0 ? (
                <div className="cdr-row"><span className="cdr-label">No signed bills</span><span className="cdr-amount">{money(0)}</span></div>
              ) : (
                data.signed.byCategory.map((cat) => (
                  <div key={cat.key} className="cdr-category">
                    <div className="cdr-category-title">
                      <span className="cdr-name"><span className="cdr-dot" style={{ background: CATEGORY_COLORS[cat.key] || '#6b7386' }} />{cat.label}</span>
                      <span className="cdr-subtotal">{money(cat.total)}</span>
                    </div>
                    <div className="cdr-ledger-cols">
                      {cat.people.map((p) => (
                        <div key={p.name} className="cdr-ledger-item">
                          <span className="cdr-lname">{p.name}{p.details.length > 1 && <span className="cdr-multi">({p.details.length} bills)</span>}</span>
                          <span className="cdr-lamt">{money(p.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
              <div className="cdr-total-row">
                <span>Total signed bills ({data.signed.byCategory.reduce((s, c) => s + c.people.length, 0)} people)</span>
                <span>{money(data.signed.total)}</span>
              </div>
              {(() => {
                const multi = data.signed.byCategory.flatMap((c) => c.people.filter((p) => p.details.length > 1))
                return multi.length > 0 ? (
                  <div className="cdr-appendix">
                    <div className="cdr-a-title">Multi-recipient breakdown</div>
                    {multi.map((p) => (
                      <div key={p.name} className="cdr-a-entry"><b>{p.name}:</b> {p.details.map((d) => `${d.who} ${money(d.amt)}`).join(' · ')}</div>
                    ))}
                  </div>
                ) : null
              })()}
            </section>

            {/* Paid bills — grouped by category, then by payer */}
            <section className="cdr-section">
              <h2 className="cdr-section-title"><span>Paid bills (debts collected)</span><span>TSh</span></h2>
              {data.paid.byCategory.length === 0 ? (
                <div className="cdr-row"><span className="cdr-label">No paid bills</span><span className="cdr-amount">{money(0)}</span></div>
              ) : (
                data.paid.byCategory.map((cat) => (
                  <div key={cat.key} className="cdr-category">
                    <div className="cdr-category-title">
                      <span className="cdr-name"><span className="cdr-dot" style={{ background: CATEGORY_COLORS[cat.key] || '#6b7386' }} />{cat.label}</span>
                      <span className="cdr-subtotal">{money(cat.total)}</span>
                    </div>
                    <div className="cdr-ledger-cols">
                      {cat.payers.map((p) => (
                        <div key={p.name} className="cdr-ledger-item">
                          <span className="cdr-lname">{p.name}<span className="cdr-multi">{p.method}</span></span>
                          <span className="cdr-lamt">{money(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
              <div className="cdr-total-row"><span>Total paid bills</span><span>{money(data.paid.total)}</span></div>
            </section>

            {/* Cancellations */}
            <section className="cdr-section">
              <h2 className="cdr-section-title"><span>Cancellations</span><span>TSh</span></h2>
              {data.cancellations.rows.length === 0 ? (
                <div className="cdr-row"><span className="cdr-label">No cancellations</span><span className="cdr-amount">{money(0)}</span></div>
              ) : (
                <div className="cdr-ledger-cols">
                  {data.cancellations.rows.map((r, i) => (
                    <div key={i} className="cdr-ledger-item">
                      <span className="cdr-lname">
                        {r.product}
                        {r.staff && <span className="cdr-multi">{r.staff}</span>}
                        <span className="cdr-multi">qty {r.qty}</span>
                      </span>
                      <span className="cdr-lamt">{money(r.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="cdr-total-row"><span>Total cancellations</span><span>{money(data.cancellations.total)}</span></div>
            </section>

            {/* Petty cash */}
            <section className="cdr-section">
              <h2 className="cdr-section-title"><span>Petty cash / expenses</span><span>TSh</span></h2>
              {data.pettyCash.rows.length === 0 ? (
                <div className="cdr-row"><span className="cdr-label">No petty cash</span><span className="cdr-amount">{money(0)}</span></div>
              ) : (
                <div className="cdr-ledger-cols">
                  {data.pettyCash.rows.map((r, i) => (
                    <div key={i} className="cdr-ledger-item">
                      <span className="cdr-lname">
                        {r.purpose}
                        {r.by && <span className="cdr-multi">{r.by}</span>}
                        <span className="cdr-multi">{r.status}</span>
                      </span>
                      <span className="cdr-lamt">{money(r.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="cdr-total-row"><span>Total petty cash</span><span>{money(data.pettyCash.total)}</span></div>
            </section>

            {/* Settlements paid from the till (separate from operational collections) */}
            {!!data.settlementsPaidFromTill && data.settlementsPaidFromTill !== 0 && (
              <section className="cdr-section">
                <h2 className="cdr-section-title"><span>Settlements paid from till</span><span>TSh</span></h2>
                <div className="cdr-total-row"><span>Excess/reconciliation payouts (cash)</span><span>{money(data.settlementsPaidFromTill)}</span></div>
                <p style={{ fontSize: '11px', color: 'var(--cdr-ink-soft)', marginTop: '6px' }}>Cash paid out to settle payable over-collections — reduces cash in hand, not an operational expense.</p>
              </section>
            )}

            {/* Cash in hand */}
            <section className="cdr-section">
              <div className="cdr-row" style={{ marginBottom: '5px' }}>
                <span className="cdr-label">Approved petty cash paid out</span>
                <span className="cdr-amount">{money(data.pettyCash.approved)}</span>
              </div>
              <div className="cdr-total-row cdr-grand">
                <span>Cash in hand</span>
                <span>{money(data.cashInHand)}</span>
              </div>
            </section>

            <div className="cdr-footer">
              Generated by {data.generatedBy || '—'} · {format(new Date(), 'dd MMM yyyy HH:mm')} · Tips Cashier Management
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
