import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { REQUEST_BILL_TYPE_GROUPS } from '@/lib/bill-types'

const APPROVERS = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

/** Counts of items awaiting approval, for the header bell. Approvers only. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, APPROVERS)) return NextResponse.json({ total: 0, items: [] })

  const [groupCounts, cancellations, petty] = await Promise.all([
    Promise.all(REQUEST_BILL_TYPE_GROUPS.map((g) =>
      prisma.signedBill.count({ where: { billType: g.types.length === 1 ? g.types[0] : { in: g.types }, approvalStatus: 'PENDING' } })
    )),
    prisma.cancellation.count({ where: { status: 'PENDING' } }),
    prisma.pettyCash.count({ where: { status: 'PENDING' } }),
  ])

  const items = [
    ...REQUEST_BILL_TYPE_GROUPS.map((g, i) => ({ key: g.key, label: g.label, count: groupCounts[i], href: g.href })),
    { key: 'cancellations', label: 'Cancellations', count: cancellations, href: '/cancellations' },
    { key: 'petty', label: 'Cash requests', count: petty, href: '/approvals' },
  ].filter((i) => i.count > 0)

  return NextResponse.json({ total: items.reduce((s, i) => s + i.count, 0), items })
}
