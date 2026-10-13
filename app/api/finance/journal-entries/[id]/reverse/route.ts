import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManageFinance } from '@/lib/finance-access'
import { RESOURCES } from '@/lib/rbac'
import { reverseJournalEntry } from '@/lib/ledger'
import { tenantCompanyId } from '@/lib/tenant'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_ACCOUNTS))) {
    return NextResponse.json({ error: 'You are not authorized to reverse journal entries' }, { status: 403 })
  }

  const entry = await prisma.journalEntry.findUnique({ where: { id }, select: { companyId: true } })
  if (!entry || entry.companyId !== (await tenantCompanyId(user))) return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  try {
    const reversal = await reverseJournalEntry(prisma, { journalEntryId: id, userId: user.userId, reason: body.reason })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'REVERSE', entity: 'JournalEntry', entityId: id, details: `Reversed via ${reversal.entryNumber}` } })
    return NextResponse.json(reversal)
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not reverse this entry' }, { status: 400 })
  }
}
