import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { postJournalEntry } from '@/lib/ledger'
import { resolveAccountId, resolveChannelAccountId, resolveDefaultCompanyId } from '@/lib/finance-mapping'

const CAN_WRITE = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR']

/** Approve or reject an Excess Refund. body: { action: 'approve' | 'reject' }
 *  Approval is the terminal disbursement step here (there is no separate pay
 *  screen), so approving pays the customer back and posts to the GL: a customer
 *  overpayment was booked to Sales Revenue at collection, so refunding it
 *  reverses that revenue against cash — Dr Sales Revenue / Cr Cash (D7).
 *  Idempotent: only the first PENDING/REJECTED→APPROVED transition posts. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CAN_WRITE)) return NextResponse.json({ error: 'You are not authorized to approve or reject excess refunds' }, { status: 403 })

  const { id } = await params
  const { action } = await req.json().catch(() => ({}))
  if (action !== 'approve' && action !== 'reject') return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const existing = await prisma.excessRefund.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Excess refund not found' }, { status: 404 })

  const approvalStatus = action === 'approve' ? 'APPROVED' : 'REJECTED'
  // Only post on the first approval — guard re-approval so we never
  // double-reverse revenue / double-reduce cash.
  const postGl = action === 'approve' && existing.approvalStatus !== 'APPROVED'
  const amount = roundMoney(existing.amount)

  const item = await prisma.$transaction(async (tx) => {
    let journalEntryId: string | null = null
    if (postGl) {
      const outlet = await tx.outlet.findUnique({ where: { id: existing.outletId }, select: { companyId: true } })
      const companyId = outlet?.companyId || (await resolveDefaultCompanyId(tx))
      if (companyId) {
        const salesRevenueAccountId = await resolveAccountId(tx, { companyId, key: 'SALES_REVENUE' })
        const cashAccountId = await resolveChannelAccountId(tx, { companyId, channelCode: 'CASH', outletId: existing.outletId })
        const entry = await postJournalEntry(tx, {
          companyId, entryDate: new Date(), sourceModule: 'COLLECTIONS', sourceType: 'ExcessRefund', sourceId: id,
          description: `Customer refund — ${existing.personName} (${existing.reason})`, createdById: user.userId,
          lines: [
            { accountId: salesRevenueAccountId, debit: amount, outletId: existing.outletId },
            { accountId: cashAccountId, credit: amount, outletId: existing.outletId },
          ],
        })
        journalEntryId = entry.id
      }
    }
    return tx.excessRefund.update({
      where: { id },
      data: {
        approvalStatus,
        approvedBy: user.name,
        ...(postGl ? { paidAmount: amount, paidAt: new Date(), journalEntryId } : {}),
      },
    })
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: approvalStatus, entity: 'ExcessRefund', entityId: id, details: `${approvalStatus} excess refund for ${existing.personName} by ${user.name}${postGl ? ' — posted Dr Sales Revenue / Cr Cash' : ''}` },
  })
  return NextResponse.json(item)
}
