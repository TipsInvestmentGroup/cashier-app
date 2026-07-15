import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { normalizePersonName } from '@/lib/persons-dedupe'

/** All active persons with their bill counts (for the manual merge picker),
 *  plus groups of 2+ persons that share the same normalized name (auto-detected
 *  exact duplicates, e.g. two "ISACK" records). Name variants that refer to the
 *  same human but don't match exactly (e.g. "ILSE" vs "ILSE MACHA") aren't
 *  auto-detected — those are merged manually via the picker. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const persons = await prisma.person.findMany({
    where: { isActive: true },
    include: { _count: { select: { signedBills: true, paidBills: true } } },
    orderBy: { name: 'asc' },
  })

  const all = persons.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    creditLimit: p.creditLimit,
    billCount: p._count.signedBills + p._count.paidBills,
  }))

  const byKey = new Map<string, typeof all>()
  for (const p of all) {
    const key = normalizePersonName(p.name)
    byKey.set(key, [...(byKey.get(key) || []), p])
  }
  const groups = [...byKey.values()].filter((g) => g.length > 1)

  return NextResponse.json({ all, groups })
}
