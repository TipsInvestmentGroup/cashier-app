import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

/**
 * GET — list credit accounts with their groups, effective limit inputs, and the
 * materialized outstanding balance (CreditAccount.currentBalance, kept fresh by
 * the credit ledger — Phase 4). ADMIN-only; Credit Settings. Supports ?q= name
 * search and ?take= (default 500).
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()
  const take = Math.min(Number(searchParams.get('take')) || 500, 2000)

  const accounts = await prisma.creditAccount.findMany({
    where: q ? { displayName: { contains: q } } : undefined,
    orderBy: { displayName: 'asc' },
    take,
    include: {
      person: { select: { id: true, creditLimit: true, type: true } },
      groupLinks: { include: { group: { select: { id: true, name: true, code: true } } } },
    },
  })

  const result = accounts.map((a) => ({
    id: a.id,
    displayName: a.displayName,
    accountType: a.accountType,
    status: a.status,
    riskRating: a.riskRating,
    currency: a.currency,
    creditLimitOverride: a.creditLimitOverride,
    personId: a.person?.id ?? null,
    personCreditLimit: a.person?.creditLimit ?? 0,
    // Displayed limit: override wins, else the person's legacy limit (0 = none).
    effectiveLimit: a.creditLimitOverride && a.creditLimitOverride > 0 ? a.creditLimitOverride : (a.person?.creditLimit ?? 0),
    // Materialized balance from the credit ledger (Phase 4).
    outstanding: a.currentBalance,
    groups: a.groupLinks.map((l) => ({ id: l.group.id, name: l.group.name, code: l.group.code })),
  }))
  return NextResponse.json(result)
}
