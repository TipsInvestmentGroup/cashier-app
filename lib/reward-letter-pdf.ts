export interface RewardItem {
  staff: string
  outlet: string
  achievements: { department: string; unit: string; actual: number; target: number; pct: number }[]
}

const fmt = (v: number, unit: string) => (unit === 'COUNT' ? `${Math.round(v).toLocaleString()} shisha` : 'TSh ' + Math.round(v).toLocaleString('en-US'))

/** One reward-eligibility / commendation letter per qualifying staff. */
export async function generateRewardLetters(items: RewardItem[], periodLabel: string) {
  if (!items.length) return
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const today = new Date().toLocaleDateString('en-TZ', { year: 'numeric', month: 'long', day: 'numeric' })

  let first = true
  for (const it of items) {
    if (!first) doc.addPage()
    first = false

    doc.setFillColor(22, 101, 52); doc.rect(0, 0, W, 22, 'F') // green band
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('tips', 14, 14)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text('TIPS Lounge — Performance Management', W - 14, 14, { align: 'right' })

    doc.setTextColor(31, 41, 55)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text('REWARD ELIGIBILITY — LETTER OF COMMENDATION', 14, 36)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    doc.text(`Date: ${today}`, 14, 44)
    doc.text(`To: ${it.staff}`, 14, 50)
    doc.text(`Outlet: ${it.outlet}`, 14, 56)
    doc.text(`Period: ${periodLabel}`, 14, 62)

    const intro = `Congratulations! Your sales performance for the period above met or exceeded the reward consideration level (80% of target) in the following area(s). You are hereby considered for a performance reward:`
    doc.text(doc.splitTextToSize(intro, W - 28), 14, 72)

    autoTable(doc, {
      startY: 88,
      head: [['Area', 'Target', 'Your Actual', 'Achieved']],
      body: it.achievements.map((a) => [a.department, fmt(a.target, a.unit), fmt(a.actual, a.unit), `${a.pct}%`]),
      styles: { fontSize: 9 }, headStyles: { fillColor: [22, 101, 52] }, margin: { left: 14, right: 14 },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let y = (doc as any).lastAutoTable.finalY + 10
    const closing = `Thank you for your dedication and excellent results. The reward amount will be determined by management. Keep up the great work.`
    doc.text(doc.splitTextToSize(closing, W - 28), 14, y); y += 26

    doc.text('_____________________________', 14, y); doc.text('_____________________________', W - 14, y, { align: 'right' })
    doc.setFontSize(9)
    doc.text('Management (Prepared by)', 14, y + 6); doc.text('Received by (Staff)', W - 14, y + 6, { align: 'right' })
  }

  doc.save(`reward-letters-${new Date().toISOString().slice(0, 10)}.pdf`)
}
