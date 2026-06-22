import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'

const APPROVERS = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

/** Counts of items awaiting approval, for the header bell. Approvers only. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, APPROVERS)) return NextResponse.json({ total: 0, items: [] })

  const [customer, tipsdj, cancellations, petty] = await Promise.all([
    prisma.signedBill.count({ where: { billType: 'CUSTOMER', approvalStatus: 'PENDING' } }),
    prisma.signedBill.count({ where: { billType: { in: ['TIPS', 'DJ'] }, approvalStatus: 'PENDING' } }),
    prisma.cancellation.count({ where: { status: 'PENDING' } }),
    prisma.pettyCash.count({ where: { status: 'PENDING' } }),
  ])

  const items = [
    { key: 'customer', label: 'Customer bills', count: customer, href: '/customer-bills' },
    { key: 'tipsdj', label: 'Tips & DJ bills', count: tipsdj, href: '/tips-dj-bills' },
    { key: 'cancellations', label: 'Cancellations', count: cancellations, href: '/cancellations' },
    { key: 'petty', label: 'Cash requests', count: petty, href: '/approvals' },
  ].filter((i) => i.count > 0)

  return NextResponse.json({ total: items.reduce((s, i) => s + i.count, 0), items })
}
