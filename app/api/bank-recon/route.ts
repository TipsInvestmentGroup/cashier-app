import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canVerifyCash } from '@/lib/cash-verify'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

const ALLOWED = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN']
// Daily-collection columns that map to fixed digital channels
const COLLECTION_COL: Record<string, 'crdb' | 'stanbic' | 'mpesa'> = { CRDB: 'crdb', STANBIC: 'stanbic', MPESA: 'mpesa' }

/** Active digital channels (everything except CASH). */
async function digitalChannels() {
  const all = await prisma.paymentChannel.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } })
  const list = all.filter((c) => c.code !== 'CASH')
  if (list.length === 0) return [{ code: 'CRDB', label: 'CRDB' }, { code: 'STANBIC', label: 'Stanbic' }, { code: 'MPESA', label: 'M-PESA' }]
  return list.map((c) => ({ code: c.code, label: c.label }))
}

/** Auto "reported" amount for a channel = collection (if a fixed column) + paid bills via that channel. */
async function reportedFor(channel: string, dayStart: Date, dayEnd: Date, outletId?: string | null) {
  const range = { gte: dayStart, lte: dayEnd }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f: any = { date: range }
  if (outletId) f.outletId = outletId
  const col = COLLECTION_COL[channel]
  const [coll, paid] = await Promise.all([
    col ? prisma.dailyCollection.aggregate({ where: f, _sum: { [col]: true } }) : Promise.resolve({ _sum: {} as Record<string, number> }),
    prisma.paidBill.aggregate({ where: { ...f, paymentMethod: channel }, _sum: { amountPaid: true } }),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collAmt = col ? ((coll as any)._sum[col] || 0) : 0
  return collAmt + (paid._sum.amountPaid || 0)
}

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId')
  const dateParam = searchParams.get('date')

  if (dateParam) {
    const parsed = parse(dateParam, 'yyyy-MM-dd', new Date())
    const day = isValid(parsed) ? parsed : new Date()
    const chans = await digitalChannels()
    const existingRecs = await prisma.bankRecon.findMany({
      where: { date: { gte: startOfDay(day), lte: endOfDay(day) }, ...(outletId ? { outletId } : {}) },
    })
    const byChannel = new Map(existingRecs.filter((r) => r.channel).map((r) => [r.channel as string, r]))
    const rows = await Promise.all(chans.map(async (ch) => {
      const reported = await reportedFor(ch.code, startOfDay(day), endOfDay(day), outletId)
      const ex = byChannel.get(ch.code)
      return { code: ch.code, label: ch.label, reported, verifiedAmount: ex?.verifiedAmount ?? null, reason: ex?.reason || '', verifiedBy: ex?.verifiedBy || '' }
    }))
    return NextResponse.json({ rows, canVerify: await canVerifyCash(user.email) })
  }

  const items = await prisma.bankRecon.findMany({ where: outletId ? { outletId } : {}, orderBy: { date: 'desc' }, take: 400 })
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { date, outletId } = body
  const channels: { channel: string; verifiedAmount?: number | string; reason?: string }[] = Array.isArray(body.channels) ? body.channels : []
  const day = date ? new Date(date) : new Date()
  const usedOutletId = outletId || user.outletId || null
  const canVerify = await canVerifyCash(user.email)

  for (const entry of channels) {
    if (!entry.channel) continue
    const reported = await reportedFor(entry.channel, startOfDay(day), endOfDay(day), usedOutletId)
    const existing = await prisma.bankRecon.findFirst({
      where: { date: { gte: startOfDay(day), lte: endOfDay(day) }, outletId: usedOutletId, channel: entry.channel },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {
      date: day, outletId: usedOutletId, channel: entry.channel,
      reportedAmount: reported, reason: entry.reason || null,
      reportedBy: user.name, cashierId: user.userId,
    }
    if (entry.verifiedAmount !== undefined && entry.verifiedAmount !== null && entry.verifiedAmount !== '') {
      if (!canVerify) return NextResponse.json({ error: 'Only an authorized officer can enter the verified amount' }, { status: 403 })
      data.verifiedAmount = Number(entry.verifiedAmount) || 0
      data.verifiedBy = user.name
    }
    if (existing) await prisma.bankRecon.update({ where: { id: existing.id }, data })
    else await prisma.bankRecon.create({ data })
  }

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'BankRecon', entityId: null, details: `Digital recon ${channels.length} channel(s)` },
  })

  return NextResponse.json({ ok: true })
}
