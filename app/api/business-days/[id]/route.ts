import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, BUSINESS_DAY_RESOURCES } from '@/lib/rbac'
import { autoLockExpiredBusinessDays } from '@/lib/business-day'

/** GET — single Business Day detail: status + audit log + unlock requests, for the management page. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, BUSINESS_DAY_RESOURCES.VIEW_BUSINESS_DAYS))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  await autoLockExpiredBusinessDays()

  const bd = await prisma.businessDay.findUnique({
    where: { id },
    include: {
      outlet: { select: { id: true, name: true } },
      auditLogs: { orderBy: { createdAt: 'desc' } },
      unlockRequests: { orderBy: { createdAt: 'desc' }, include: { requestedBy: { select: { name: true } }, approver: { select: { name: true } } } },
    },
  })
  if (!bd) return NextResponse.json({ error: 'Business day not found' }, { status: 404 })

  return NextResponse.json({
    ...bd,
    missingItems: bd.missingItems ? JSON.parse(bd.missingItems) : [],
  })
}
