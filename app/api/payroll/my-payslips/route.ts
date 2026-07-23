import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Employee Self-Service (Phase 5). Any authenticated user sees ONLY their own
// payslips — resolved from the Employee record linked to their login. Only
// finalized payslips (LOCKED/PAID) are shown; drafts stay internal.
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const employee = await prisma.employee.findFirst({ where: { userId: user.userId }, select: { id: true } })
  if (!employee) return NextResponse.json({ payslips: [] })

  const payslips = await prisma.payslip.findMany({
    // Finalized payslips only, and never those from a run that was reversed —
    // reversing a run leaves the payslip rows LOCKED, so filter on run.status
    // here or a cancelled run would still surface to the employee.
    where: { employeeId: employee.id, status: { in: ['LOCKED', 'PAID'] }, run: { status: { notIn: ['REVERSED'] } } },
    orderBy: { createdAt: 'desc' },
    take: 36,
    include: { lines: { orderBy: { sortOrder: 'asc' } }, run: { select: { periodKey: true, paymentDate: true } } },
  })
  return NextResponse.json({ payslips })
}
