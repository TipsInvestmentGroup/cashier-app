import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'

const CASHIER_ROLES = ['CASHIER', 'ACCOUNTANT', 'ADMIN']

/**
 * POST — import the daily System Sales report into this session. Body:
 * { rows: [{ staffName, amount, staffId? }] }. This is what defines the
 * official roster of staff expected to declare transactions this session —
 * replaces (rather than appends to) any prior import for the same staff name.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CASHIER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const session = await prisma.transactionSession.findUnique({ where: { id } })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (user.role === 'CASHIER' && session.outletId !== user.outletId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (session.status !== 'OPEN') return NextResponse.json({ error: 'This session is no longer open for changes' }, { status: 409 })

  const body = await req.json().catch(() => ({}))
  const rawRows: { staffName?: string; amount?: number | string }[] = Array.isArray(body.rows) ? body.rows : []
  const parsedRows = rawRows
    .map((r) => {
      const staffName = String(r.staffName || '').trim()
      const amount = roundMoney(Number(r.amount) || 0)
      if (!staffName) return null
      return { staffName, amount }
    })
    .filter(Boolean) as { staffName: string; amount: number }[]

  if (!parsedRows.length) return NextResponse.json({ error: 'No valid rows found. Each row needs a staff name.' }, { status: 400 })

  // Resolve each name to a real WAITER account (exact, case-insensitive) so
  // the row also seeds the "who's expected to declare" roster — a row with no
  // matching account is still imported (staffId stays null), it just won't
  // auto-link to anyone's declared transactions.
  const waiters = await prisma.user.findMany({ where: { role: 'WAITER' }, select: { id: true, name: true } })
  const byName = new Map(waiters.map((w) => [w.name.trim().toLowerCase(), w.id]))
  const rows = parsedRows.map((r) => ({ ...r, staffId: byName.get(r.staffName.toLowerCase()) || null }))

  await prisma.$transaction(
    rows.map((r) =>
      prisma.systemSalesRecord.upsert({
        where: { sessionId_staffName: { sessionId: id, staffName: r.staffName } },
        update: { amount: r.amount, staffId: r.staffId },
        create: { sessionId: id, staffName: r.staffName, amount: r.amount, staffId: r.staffId },
      }),
    ),
  )

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPLOAD', entity: 'SystemSalesRecord', entityId: id, details: `Imported System Sales for ${rows.length} staff` },
  })

  return NextResponse.json({ ok: true, inserted: rows.length })
}
