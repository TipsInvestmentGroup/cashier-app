import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/email'
import { roundMoney } from '@/lib/utils'
import { getCompanyConfig } from '@/lib/company-config'
import { DEFAULT_COMPANY_CONFIG, formatAmountLabel } from '@/lib/company-config-shared'
import { startOfDay, endOfDay, parse, isValid, format } from 'date-fns'

// Currency label comes from Company Preferences — set from config at the top
// of sendDailySummary, before any fmt() call.
let cfg = DEFAULT_COMPANY_CONFIG
function fmt(n: number) {
  return formatAmountLabel(cfg, n)
}

/**
 * Computes a one-day cashier summary and emails it to the given recipients
 * (or all active Directors if none). Shared by the manual send route and the
 * scheduled daily job.
 */
export async function sendDailySummary(opts: { date?: string | null; outletId?: string | null; recipients?: string[] }) {
  cfg = await getCompanyConfig()
  const parsed = opts.date ? parse(opts.date, 'yyyy-MM-dd', new Date()) : new Date()
  const day = isValid(parsed) ? parsed : new Date()
  const range = { gte: startOfDay(day), lte: endOfDay(day) }
  const where: Record<string, unknown> = { date: range }
  if (opts.outletId) where.outletId = opts.outletId

  const [collections, signed, paid, cancellations, petty] = await Promise.all([
    prisma.dailyCollection.findMany({ where, select: { cash: true, crdb: true, stanbic: true, mpesa: true, total: true, systemSales: true } }),
    prisma.signedBill.findMany({ where: { ...where, approvalStatus: { not: 'REJECTED' } }, select: { billType: true, amount: true } }),
    prisma.paidBill.findMany({ where, select: { amountPaid: true, paymentMethod: true } }),
    prisma.cancellation.findMany({ where: { date: range, ...(opts.outletId ? { outletId: opts.outletId } : {}), status: { not: 'REJECTED' } }, select: { amount: true } }),
    prisma.pettyCash.findMany({ where: { date: range, ...(opts.outletId ? { outletId: opts.outletId } : {}) }, select: { amount: true, status: true, paymentMethod: true } }),
  ])

  const col = collections.reduce((t, c) => ({
    cash: t.cash + c.cash, crdb: t.crdb + c.crdb, stanbic: t.stanbic + c.stanbic, mpesa: t.mpesa + c.mpesa,
    total: t.total + c.total, systemSales: t.systemSales + (c.systemSales || 0),
  }), { cash: 0, crdb: 0, stanbic: 0, mpesa: 0, total: 0, systemSales: 0 })
  const variance = roundMoney(col.total - col.systemSales)
  const signedTotal = roundMoney(signed.reduce((s, b) => s + b.amount, 0))
  const paidTotal = roundMoney(paid.reduce((s, p) => s + p.amountPaid, 0))
  const paidCash = roundMoney(paid.filter((p) => (p.paymentMethod || '').toUpperCase() === 'CASH').reduce((s, p) => s + p.amountPaid, 0))
  const cancelTotal = roundMoney(cancellations.reduce((s, c) => s + (c.amount || 0), 0))
  const pettyApproved = roundMoney(petty.filter((p) => p.status === 'APPROVED').reduce((s, p) => s + p.amount, 0))
  const cashInHand = roundMoney(col.cash + paidCash - pettyApproved)

  let recipients = opts.recipients
  if (!recipients || recipients.length === 0) {
    const directors = await prisma.user.findMany({ where: { role: 'DIRECTOR', isActive: true }, select: { email: true } })
    recipients = directors.map((d) => d.email).filter(Boolean)
  }
  if (!recipients.length) throw new Error('No director email addresses found. Add directors as users first.')

  const dateLabel = format(day, 'EEEE, dd MMM yyyy')
  const stat = (label: string, value: string, color: string) =>
    `<div style="flex:1;min-width:120px;background:${color};border-radius:8px;padding:12px"><div style="font-size:12px;color:#666">${label}</div><div style="font-size:18px;font-weight:bold;color:#111">${value}</div></div>`
  const row = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:7px 8px;border-bottom:1px solid #eee">${label}</td><td style="padding:7px 8px;border-bottom:1px solid #eee;text-align:right${strong ? ';font-weight:bold' : ''}">${value}</td></tr>`

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#222">
    <h2 style="color:#4f46e5;margin-bottom:2px">Daily Cashier Summary</h2>
    <p style="color:#555;margin-top:0">${dateLabel}${opts.outletId ? '' : ' · All Outlets'}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0">
      ${stat('Total Collected', fmt(col.total), '#eef2ff')}
      ${stat('System Sales', fmt(col.systemSales), '#f1f5f9')}
      ${stat('Cash in Hand', fmt(cashInHand), '#ecfdf5')}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${row('💵 Cash', fmt(col.cash))}
      ${row('🏦 CRDB', fmt(col.crdb))}
      ${row('🏛️ Stanbic', fmt(col.stanbic))}
      ${row('📱 M-PESA', fmt(col.mpesa))}
      ${row('Total Collected', fmt(col.total), true)}
      ${row('Variance (Collected − System)', `<span style="color:${variance < 0 ? '#dc2626' : variance > 0 ? '#16a34a' : '#111'}">${fmt(variance)}</span>`)}
      ${row('🧾 Signed Bills (credit)', fmt(signedTotal))}
      ${row('✅ Paid Bills (recovered)', fmt(paidTotal))}
      ${row('🚫 Cancellations', fmt(cancelTotal))}
      ${row('💸 Petty Cash (approved)', fmt(pettyApproved))}
    </table>
    <p style="color:#888;font-size:12px;margin-top:16px">Generated automatically by the Cashier Sales Management System.</p>
  </div>`

  const result = await sendMail({
    to: recipients,
    subject: `Daily Cashier Summary — ${format(day, 'dd MMM yyyy')} (${fmt(col.total)})`,
    html,
  })
  return { mode: result.mode, recipients, previewUrl: result.previewUrl, total: col.total, date: format(day, 'yyyy-MM-dd') }
}
