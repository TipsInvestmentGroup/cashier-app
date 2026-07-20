import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance } from '@/lib/finance-access'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'

/** Read-only ledger browser — list posted journal entries with their lines. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  const sourceType = searchParams.get('sourceType')
  if (!companyId) return NextResponse.json([])

  const entries = await prisma.journalEntry.findMany({
    where: { companyId, ...(sourceType ? { sourceType } : {}) },
    include: { lines: { include: { account: true } } },
    orderBy: { entryDate: 'desc' },
    take: 200,
  })
  return NextResponse.json(entries)
}
