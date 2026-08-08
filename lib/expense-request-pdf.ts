// Per-request PDFs for the expense module (spec §3 completed audit trail, §7
// unapproved routing copy). Built client-side with the jspdf already in the
// stack (matches lib/reward-letter-pdf.ts / warning-letter-pdf.ts), fed by the
// frozen snapshot from GET /api/expense/requests/[id]/pdf-data. The routing
// variant is a pure rendering of fetched state — it never writes back to the
// approval workflow (spec §7 hard constraint).
import { formatCurrency, getClientCompanyConfig } from '@/lib/utils'

export interface ExpensePdfSnapshot {
  id: string
  reference: string | null
  status: string
  direction: string
  createdAt: string
  company: string
  outlet: string | null
  requestedBy: string
  transactionType: string
  expenseType: string | null
  category: string
  glAccount: string | null
  purpose: string
  currency: string
  amount: number
  approvedAmount: number
  totalPaid: number
  items: { detail: string; unit: number; unitCost: number; amount: number }[]
  approvals: { approver: string | null; role: string | null; status: string; comment: string | null; resolvedAt: string | null }[]
  approverChain: string[]
  currentApprover: { name?: string | null; role?: string | null } | null
  payments: { amount: number; method: string; payeeName: string | null; reference: string | null; paidAt: string; paidBy: string; fund: string | null; balance: { before: number; after: number } | null }[]
  verifications: { stage: string; verifiedBy: string; verifiedAt: string; note: string | null }[]
}

const GREEN: [number, number, number] = [22, 101, 52]
const INK: [number, number, number] = [31, 41, 55]

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-TZ', { year: 'numeric', month: 'short', day: 'numeric' }) : '—')
const fmtDateTime = (d: string | null) => (d ? new Date(d).toLocaleString('en-TZ', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

/** Status → the corner watermark that makes a filed paper copy unambiguous. */
function watermarkFor(snap: ExpensePdfSnapshot): string {
  switch (snap.status) {
    case 'DRAFT': return 'DRAFT'
    case 'PENDING_APPROVAL': return 'PENDING APPROVAL'
    case 'APPROVED': return 'APPROVED — UNPAID'
    case 'PARTIALLY_PAID': return 'PART-PAID'
    case 'PAID': return snap.direction === 'OUT' && snap.verifications.length === 0 ? 'PENDING RETIREMENT' : 'PAID'
    case 'VERIFIED':
    case 'CLOSED': return 'FULLY RETIRED'
    case 'REJECTED': return 'REJECTED'
    case 'CANCELLED': return 'CANCELLED'
    default: return snap.status
  }
}

export async function loadLogo(): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch('/tips-logo.png')
    if (!res.ok) return null
    const blob = await res.blob()
    const data: string = await new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = reject
      fr.readAsDataURL(blob)
    })
    const dims: { w: number; h: number } = await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => resolve({ w: 1, h: 1 })
      img.src = data
    })
    return { data, w: dims.w, h: dims.h }
  } catch { return null }
}

export async function downloadExpenseRequestPdf(
  snap: ExpensePdfSnapshot,
  opts: { variant: 'audit' | 'routing'; recordUrl: string },
) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const QRCode = (await import('qrcode')).default
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const routing = opts.variant === 'routing'
  // Single display-name source: the company preferences config (same as the
  // sidebar and the reward/warning letters), so every PDF prints one consistent
  // business name regardless of the internal Company table record.
  const company = getClientCompanyConfig().companyName || snap.company || 'TIPS'

  const [logo, qr] = await Promise.all([
    loadLogo(),
    QRCode.toDataURL(opts.recordUrl, { margin: 0, width: 120 }).catch(() => null),
  ])

  // ── Header band ──
  doc.setFillColor(...GREEN); doc.rect(0, 0, W, 24, 'F')
  if (logo) {
    const h = 14, w = Math.min(40, (logo.w / logo.h) * h)
    doc.addImage(logo.data, 'PNG', 12, 5, w, h)
  } else {
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
    doc.text(company, 12, 15)
  }
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text(routing ? 'EXPENSE REQUEST — ROUTING COPY' : 'EXPENSE REQUEST — AUDIT TRAIL', W - 12, 11, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text(company, W - 12, 17, { align: 'right' })
  if (snap.outlet) doc.text(snap.outlet, W - 12, 21, { align: 'right' })

  // Reference + generated time + QR
  doc.setTextColor(...INK)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  doc.text(snap.reference || '(draft — no reference yet)', 12, 34)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120, 120, 120)
  doc.text(`Generated ${fmtDateTime(new Date().toISOString())}`, 12, 39)
  if (qr) { doc.addImage(qr, 'PNG', W - 12 - 20, 28, 20, 20); doc.text('Scan to open', W - 12 - 20, 51, { maxWidth: 20 }) }

  // Status stamp — a small colored badge in the header instead of a diagonal
  // full-page watermark, so it reads at a glance without ever obscuring the
  // tables (the routing variant already carries its own banner).
  let y = 46
  if (!routing) { drawStatusStamp(doc, 12, 42, watermarkFor(snap)); y = 52 }

  // ── Routing banner (§7) ──
  if (routing) {
    doc.setFillColor(180, 83, 9); doc.rect(12, y, W - 24 - 24, 10, 'F')
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    doc.text('NOT YET FULLY APPROVED — FOR PHYSICAL ROUTING ONLY', 15, y + 6.5)
    y += 16
  }

  // ── Section A — Request ──
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('A. Request', 12, y); y += 2
  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 1 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42 }, 2: { fontStyle: 'bold', cellWidth: 42 } },
    body: [
      ['Requested by', snap.requestedBy, 'Date', fmtDate(snap.createdAt)],
      ['Transaction type', snap.transactionType, 'Outlet', snap.outlet || '—'],
      ['Expense category', snap.category, 'GL account', snap.glAccount || '—'],
      ['Amount requested', formatCurrency(snap.amount), 'Approved amount', formatCurrency(snap.approvedAmount)],
    ],
    margin: { left: 12, right: 12 },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 4
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('Purpose:', 12, y)
  doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(snap.purpose || '—', W - 40), 32, y)
  y += Math.max(6, doc.splitTextToSize(snap.purpose || '—', W - 40).length * 4 + 2)

  if (snap.items.length) {
    autoTable(doc, {
      startY: y,
      head: [['Item', 'Qty', 'Unit cost', 'Amount']],
      body: snap.items.map((it) => [it.detail, String(it.unit), formatCurrency(it.unitCost), formatCurrency(it.amount)]),
      styles: { fontSize: 8 }, headStyles: { fillColor: INK }, margin: { left: 12, right: 12 },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6
  }

  if (routing) {
    y = renderRoutingChain(doc, autoTable, snap, y, W)
  } else {
    y = renderApprovalTrail(doc, autoTable, snap, y, W)
    y = renderPayments(doc, autoTable, snap, y, W)
    y = renderRetirement(doc, autoTable, snap, y, W)
  }

  // ── Footer signatures ──
  const sigY = Math.min(Math.max(y + 12, H - 34), H - 30)
  if (!routing) drawSignatureRow(doc, sigY, W, ['Requester', 'Custodian', 'Approver'])
  doc.setFontSize(7); doc.setTextColor(120, 120, 120)
  if (routing) {
    doc.text('Physical signature is for routing purposes only; the request must still be approved in Tips Cashier Manager to proceed to payment.', 12, H - 12, { maxWidth: W - 24 })
  }

  doc.save(`${snap.reference || 'expense-request'}${routing ? '-routing' : ''}.pdf`)
}

/** Small colored status badge drawn in the header. Tone tracks the lifecycle so
 *  a filed paper copy is unambiguous: green = settled, amber = in-flight, gray =
 *  draft, red = dead. */
function drawStatusStamp(doc: import('jspdf').jsPDF, x: number, y: number, label: string) {
  const TONES: Record<string, [number, number, number]> = {
    'FULLY RETIRED': [22, 101, 52], PAID: [22, 101, 52],
    'PENDING RETIREMENT': [180, 83, 9], 'PART-PAID': [180, 83, 9], 'PENDING APPROVAL': [180, 83, 9], 'APPROVED — UNPAID': [180, 83, 9],
    DRAFT: [107, 114, 128],
    REJECTED: [185, 28, 28], CANCELLED: [185, 28, 28],
  }
  const c = TONES[label] || [107, 114, 128]
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  const w = doc.getTextWidth(label) + 8
  doc.setFillColor(c[0], c[1], c[2])
  doc.roundedRect(x, y, w, 7, 1.5, 1.5, 'F')
  doc.setTextColor(255, 255, 255)
  doc.text(label, x + 4, y + 5)
}

function renderApprovalTrail(doc: import('jspdf').jsPDF, autoTable: typeof import('jspdf-autotable').default, snap: ExpensePdfSnapshot, y: number, W: number): number {
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('B. Approval trail', 12, y); y += 2
  const body = snap.approvals.length
    ? snap.approvals.map((a) => [a.approver || `(${a.role || 'approver'})`, a.role || '—', a.status, fmtDateTime(a.resolvedAt), a.comment || '—'])
    : [['—', '—', 'No approval required / none recorded', '—', '—']]
  autoTable(doc, {
    startY: y,
    head: [['Approver', 'Role', 'Decision', 'When', 'Comment']],
    body,
    styles: { fontSize: 8 }, headStyles: { fillColor: GREEN }, margin: { left: 12, right: 12 },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any).lastAutoTable.finalY + 6
}

function renderPayments(doc: import('jspdf').jsPDF, autoTable: typeof import('jspdf-autotable').default, snap: ExpensePdfSnapshot, y: number, W: number): number {
  if (!snap.payments.length) return y
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('C. Payment', 12, y); y += 2
  autoTable(doc, {
    startY: y,
    head: [['Paid by', 'Fund', 'Date', 'Method', 'Ref', 'Amount', 'Bal before', 'Bal after']],
    body: snap.payments.map((p) => [
      p.paidBy, p.fund || '—', fmtDate(p.paidAt), p.method, p.reference || '—',
      formatCurrency(p.amount),
      p.balance ? formatCurrency(p.balance.before) : '—',
      p.balance ? formatCurrency(p.balance.after) : '—',
    ]),
    styles: { fontSize: 8 }, headStyles: { fillColor: GREEN }, margin: { left: 12, right: 12 },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any).lastAutoTable.finalY + 6
}

function renderRetirement(doc: import('jspdf').jsPDF, autoTable: typeof import('jspdf-autotable').default, snap: ExpensePdfSnapshot, y: number, W: number): number {
  if (!snap.verifications.length) return y
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('D. Retirement / verification', 12, y); y += 2
  autoTable(doc, {
    startY: y,
    head: [['Stage', 'By', 'When', 'Note']],
    body: snap.verifications.map((v) => [v.stage.replace(/_/g, ' '), v.verifiedBy, fmtDateTime(v.verifiedAt), v.note || '—']),
    styles: { fontSize: 8 }, headStyles: { fillColor: GREEN }, margin: { left: 12, right: 12 },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any).lastAutoTable.finalY + 6
}

/** §7: the approval chain as a table — steps already approved show name + date
 *  with no blank line; remaining steps show "Approval Needed" with blank
 *  signature/date lines so it's clear whose signature is still outstanding. */
function renderRoutingChain(doc: import('jspdf').jsPDF, autoTable: typeof import('jspdf-autotable').default, snap: ExpensePdfSnapshot, y: number, W: number): number {
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('Approval status', 12, y); y += 2

  const done = snap.approvals.filter((a) => a.status === 'APPROVED')
  const rows: string[][] = done.map((a) => [a.role || '—', a.approver || '—', `Approved in system (${fmtDate(a.resolvedAt)})`, '', ''])
  // Remaining roles in the chain that haven't been approved yet.
  const doneRoles = new Set(done.map((a) => a.role))
  const pending = snap.approverChain.filter((r) => !doneRoles.has(r))
  const pendingRows = pending.length ? pending : (snap.currentApprover?.role ? [snap.currentApprover.role] : ['(pending approver)'])
  pendingRows.forEach((role) => rows.push([role, '(pending)', 'Approval Needed', '____________________', '____________']))

  autoTable(doc, {
    startY: y,
    head: [['Approver role', 'Name', 'Status', 'Signature', 'Date']],
    body: rows,
    styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: GREEN }, margin: { left: 12, right: 12 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 2) {
        if (String(data.cell.raw).startsWith('Approval Needed')) { data.cell.styles.textColor = [180, 83, 9]; data.cell.styles.fontStyle = 'bold' }
        else data.cell.styles.textColor = [22, 101, 52]
      }
    },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any).lastAutoTable.finalY + 6
}

function drawSignatureRow(doc: import('jspdf').jsPDF, y: number, W: number, labels: string[]) {
  const gap = (W - 24) / labels.length
  doc.setDrawColor(120, 120, 120)
  labels.forEach((label, i) => {
    const x = 12 + gap * i
    doc.line(x, y, x + gap - 8, y)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(80, 80, 80)
    doc.text(label, x, y + 4)
  })
}
