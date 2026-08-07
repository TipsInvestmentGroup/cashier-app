// Custodian ledger PDF (spec §4) — a running-cashbook export of one funding
// source: Date / Reference / Description / Debit (In) / Credit (Out) / Balance,
// with bold Opening and Closing rows so it stands alone as a physical
// bank-book-style record. Built client-side with the same jspdf + logo/QR-free
// header convention as lib/expense-request-pdf.ts, which loadLogo is shared from.
import { formatCurrency, getClientCompanyConfig } from '@/lib/utils'
import { loadLogo } from '@/lib/expense-request-pdf'

export interface LedgerPdfRow {
  createdAt: string
  type: string
  amount: number // signed: + in, - out
  reference: string | null
  note: string | null
  requestNumber?: string | null
  paymentMethod?: string | null
}

export interface CustodianLedgerPdf {
  fundName: string
  openingBalance: number
  closingBalance: number
  totalReceived: number
  totalPaid: number
  rows: LedgerPdfRow[]
}

const GREEN: [number, number, number] = [22, 101, 52]
const INK: [number, number, number] = [31, 41, 55]

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-TZ', { year: 'numeric', month: 'short', day: 'numeric' }) : '—')

const TYPE_LABEL: Record<string, string> = { OPEN: 'Opening balance', REPLENISH: 'Funds received', PAYMENT: 'Expense paid', ADJUST: 'Adjustment' }

/** One-line description per row: type + linked request # + short note, so an
 *  "Out" row is eyeballable (§4 row rules) without extra columns. */
function describe(r: LedgerPdfRow): string {
  const parts: string[] = [TYPE_LABEL[r.type] || r.type]
  if (r.requestNumber) parts.push(r.requestNumber)
  if (r.note) parts.push(r.note)
  return parts.join(' · ')
}

export async function downloadCustodianLedgerPdf(data: CustodianLedgerPdf) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const cfg = getClientCompanyConfig()
  const logo = await loadLogo()

  // Period = the span the loaded rows actually cover (the ledger view is not
  // date-filtered), stated plainly rather than implying a filter that isn't there.
  const dates = data.rows.map((r) => new Date(r.createdAt).getTime()).filter((n) => !isNaN(n))
  const periodLabel = dates.length
    ? `${fmtDate(new Date(Math.min(...dates)).toISOString())} – ${fmtDate(new Date(Math.max(...dates)).toISOString())}`
    : 'All recorded transactions'

  // ── Header band ──
  doc.setFillColor(...GREEN); doc.rect(0, 0, W, 24, 'F')
  if (logo) {
    const h = 14, w = Math.min(40, (logo.w / logo.h) * h)
    doc.addImage(logo.data, 'PNG', 12, 5, w, h)
  } else {
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(cfg.companyName, 12, 15)
  }
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text('CUSTODIAN LEDGER', W - 12, 11, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text(cfg.companyName, W - 12, 17, { align: 'right' })

  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  doc.text(data.fundName, 12, 34)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120, 120, 120)
  doc.text(`Period: ${periodLabel}   ·   Generated ${fmtDate(new Date().toISOString())}`, 12, 39)

  // ── Cashbook table (opening + rows + closing) ──
  const body: (string | { content: string; styles?: object })[][] = []
  body.push([
    { content: fmtDate(data.rows[0]?.createdAt ?? new Date().toISOString()), styles: { fontStyle: 'bold' } },
    { content: 'Opening balance', styles: { fontStyle: 'bold' } },
    { content: '', styles: {} }, { content: '', styles: {} }, { content: '', styles: {} },
    { content: formatCurrency(data.openingBalance), styles: { fontStyle: 'bold' } },
  ])
  for (const r of data.rows) {
    const isIn = r.amount >= 0
    body.push([
      fmtDate(r.createdAt),
      describe(r),
      r.reference || '—',
      isIn ? formatCurrency(r.amount) : '',
      !isIn ? formatCurrency(-r.amount) : '',
      // runningBalance isn't on LedgerPdfRow; the caller passes rows in the
      // ledger's own order and we recompute the balance column below.
      '',
    ])
  }
  // Recompute the running balance column from opening + signed amounts so the
  // Balance cell is always internally consistent with Debit/Credit.
  let running = data.openingBalance
  for (let i = 0; i < data.rows.length; i++) {
    running = Math.round((running + data.rows[i].amount) * 100) / 100
    body[i + 1][5] = formatCurrency(running)
  }
  body.push([
    { content: fmtDate(data.rows[data.rows.length - 1]?.createdAt ?? new Date().toISOString()), styles: { fontStyle: 'bold' } },
    { content: 'Closing balance', styles: { fontStyle: 'bold' } },
    { content: '', styles: {} }, { content: '', styles: {} }, { content: '', styles: {} },
    { content: formatCurrency(data.closingBalance), styles: { fontStyle: 'bold' } },
  ])

  autoTable(doc, {
    startY: 44,
    head: [['Date', 'Description', 'Reference', 'Debit (In)', 'Credit (Out)', 'Balance']],
    body,
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: GREEN },
    columnStyles: {
      3: { halign: 'right', textColor: [22, 101, 52] },
      4: { halign: 'right', textColor: [185, 28, 28] },
      5: { halign: 'right' },
    },
    margin: { left: 12, right: 12 },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let y = (doc as any).lastAutoTable.finalY + 6

  // ── Totals line ──
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text(`Total in: ${formatCurrency(data.totalReceived)}    Total out: ${formatCurrency(data.totalPaid)}    Closing: ${formatCurrency(data.closingBalance)}`, 12, y)
  y += 10

  // ── Footer signatures (§4: Prepared / Reviewed / Approved) ──
  const sigY = Math.min(Math.max(y + 8, H - 30), H - 26)
  const labels = ['Prepared by', 'Reviewed by', 'Approved by']
  const gap = (W - 24) / labels.length
  doc.setDrawColor(120, 120, 120)
  labels.forEach((label, i) => {
    const x = 12 + gap * i
    doc.line(x, sigY, x + gap - 8, sigY)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(80, 80, 80); doc.text(label, x, sigY + 4)
  })

  doc.save(`custodian-ledger-${data.fundName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`)
}
