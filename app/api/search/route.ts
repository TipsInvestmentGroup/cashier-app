import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { formatCurrency } from '@/lib/utils'

type Hit = { type: string; label: string; sub?: string; href: string }

/**
 * Global search across people, signed bills (incl. voucher), cash requests and
 * products. Cashier-scoped to their own outlet for outlet-bound records.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()
  if (q.length < 2) return NextResponse.json({ results: [] })

  const scoped = readOutletScope(user, null) // cashier → own outlet; others → all
  const outletWhere = scoped ? { outletId: scoped } : {}
  const like = { contains: q, mode: 'insensitive' as const }

  // Resilient: one failing query (e.g. local SQLite without insensitive mode)
  // shouldn't kill the whole search.
  const safe = async <T,>(p: Promise<T>, fb: T): Promise<T> => { try { return await p } catch { return fb } }

  const [persons, bills, petty, products] = await Promise.all([
    safe(prisma.person.findMany({ where: { name: like }, take: 5, select: { id: true, name: true, type: true } }), []),
    safe(prisma.signedBill.findMany({
      where: { ...outletWhere, OR: [{ personName: like }, { voucherNumber: like }] },
      take: 6, orderBy: { date: 'desc' },
      select: { id: true, personName: true, billType: true, amount: true, status: true },
    }), []),
    safe(prisma.pettyCash.findMany({
      where: { ...outletWhere, OR: [{ purpose: like }, { requestedBy: like }] },
      take: 5, orderBy: { date: 'desc' },
      select: { id: true, purpose: true, requestedBy: true, amount: true },
    }), []),
    safe(prisma.product.findMany({ where: { OR: [{ name: like }, { code: like }] }, take: 5, select: { id: true, name: true, code: true } }), []),
  ])

  const results: Hit[] = [
    ...persons.map((p) => ({ type: 'Person', label: p.name, sub: p.type, href: '/persons' })),
    ...bills.map((b) => ({ type: 'Signed Bill', label: `${b.personName} — ${formatCurrency(b.amount)}`, sub: `${b.billType} · ${b.status}`, href: '/receivables' })),
    ...petty.map((p) => ({ type: 'Cash Request', label: p.purpose, sub: `${p.requestedBy} · ${formatCurrency(p.amount)}`, href: '/petty-cash' })),
    ...products.map((p) => ({ type: 'Product', label: p.name, sub: p.code, href: '/products' })),
  ]

  return NextResponse.json({ results })
}
