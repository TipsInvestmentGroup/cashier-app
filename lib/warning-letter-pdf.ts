import { formatAmount, getClientCompanyConfig } from '@/lib/utils'

export interface FlaggedItem {
  staff: string
  outlet: string
  department: string
  unit: string // 'TZS' | 'COUNT'
  unitLabel?: string // e.g. "shisha" when unit = COUNT
  actual: number
  target: number
  threshold: number // ⅓ minimum
}

const fmt = (v: number, unit: string, unitLabel?: string) =>
  unit === 'COUNT' ? `${Math.round(v).toLocaleString()} ${unitLabel || 'shisha'}` : formatAmount(v)

/**
 * Generates a multi-page PDF — one performance warning letter per flagged staff
 * (a staff missing several targets gets all of them listed on their letter).
 */
export async function generateWarningLetters(items: FlaggedItem[], periodLabel: string) {
  if (!items.length) return
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()

  // Group by staff (case-insensitive)
  const groups = new Map<string, { staff: string; outlet: string; rows: FlaggedItem[] }>()
  for (const it of items) {
    const k = it.staff.trim().toLowerCase()
    const g = groups.get(k) || { staff: it.staff, outlet: it.outlet, rows: [] }
    g.rows.push(it)
    groups.set(k, g)
  }

  const today = new Date().toLocaleDateString('en-TZ', { year: 'numeric', month: 'long', day: 'numeric' })
  let first = true
  for (const g of groups.values()) {
    if (!first) doc.addPage()
    first = false

    const brand = getClientCompanyConfig()
    doc.setFillColor(31, 41, 55); doc.rect(0, 0, W, 22, 'F')
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(brand.logoText, 14, 14)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(brand.letterheadTitle, W - 14, 14, { align: 'right' })

    doc.setTextColor(31, 41, 55)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text('PERFORMANCE WARNING LETTER', 14, 36)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    doc.text(`Date: ${today}`, 14, 44)
    doc.text(`To: ${g.staff}`, 14, 50)
    doc.text(`Outlet: ${g.outlet}`, 14, 56)
    doc.text(`Period: ${periodLabel}`, 14, 62)

    const intro = `This letter is to formally notify you that your sales performance for the period above fell below the required minimum threshold (one-third of the set target) in the following area(s):`
    doc.text(doc.splitTextToSize(intro, W - 28), 14, 72)

    autoTable(doc, {
      startY: 86,
      head: [['Area', 'Target', 'Minimum (⅓)', 'Your Actual', 'Shortfall']],
      body: g.rows.map((r) => [r.department, fmt(r.target, r.unit, r.unitLabel), fmt(r.threshold, r.unit, r.unitLabel), fmt(r.actual, r.unit, r.unitLabel), fmt(Math.max(0, r.threshold - r.actual), r.unit, r.unitLabel)]),
      styles: { fontSize: 9 }, headStyles: { fillColor: [31, 41, 55] }, margin: { left: 14, right: 14 },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let y = (doc as any).lastAutoTable.finalY + 10
    const closing = `You are required to improve your performance to at least the set target level in the next period. Continued underperformance may result in further action in line with company policy. Please treat this matter with the seriousness it deserves.`
    doc.text(doc.splitTextToSize(closing, W - 28), 14, y); y += 30

    doc.text('_____________________________', 14, y); doc.text('_____________________________', W - 14, y, { align: 'right' })
    doc.setFontSize(9)
    doc.text('Management (Prepared by)', 14, y + 6); doc.text('Acknowledged by (Staff)', W - 14, y + 6, { align: 'right' })
  }

  doc.save(`warning-letters-${new Date().toISOString().slice(0, 10)}.pdf`)
}
