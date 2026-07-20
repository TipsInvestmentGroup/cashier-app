import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, writeOutletId } from '@/lib/auth'
import { canVerifyCash } from '@/lib/cash-verify'
import { roundMoney } from '@/lib/utils'
import { getActiveDigitalChannels } from '@/lib/collection-channels'
import { syncFromBankRecon } from '@/lib/payment-verification'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

const ALLOWED = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN']
// Legacy fixed columns — only these 3 channels have a dedicated DailyCollection
// column; used as a fallback for collections recorded before per-channel rows existed.
const LEGACY_COLLECTION_COL: Record<string, 'crdb' | 'stanbic' | 'mpesa'> = { CRDB: 'crdb', STANBIC: 'stanbic', MPESA: 'mpesa' }

/** Active digital channels (everything except CASH). */
const digitalChannels = getActiveDigitalChannels

/** Auto "reported" amount for a channel = collection (per-channel rows, falling
 *  back to the legacy fixed column for pre-migration rows) + paid bills via that channel. */
async function reportedFor(channel: string, dayStart: Date, dayEnd: Date, outletId?: string | null) {
  const range = { gte: dayStart, lte: dayEnd }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f: any = { date: range }
  if (outletId) f.outletId = outletId

  const [channelRows, paid] = await Promise.all([
    prisma.dailyCollectionChannel.aggregate({ where: { channelCode: channel, collection: f }, _sum: { amount: true } }),
    prisma.paidBill.aggregate({ where: { ...f, paymentMethod: channel }, _sum: { amountPaid: true } }),
  ])
  let collAmt = channelRows._sum.amount || 0
  // Fall back to the legacy fixed column only if this channel has no per-channel
  // rows at all in range (i.e. every matching collection predates this table).
  if (!collAmt) {
    const col = LEGACY_COLLECTION_COL[channel]
    if (col) {
      const legacy = await prisma.dailyCollection.aggregate({ where: f, _sum: { [col]: true } })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      collAmt = (legacy._sum as any)[col] || 0
    }
  }
  return roundMoney(collAmt + (paid._sum.amountPaid || 0))
}

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  // Cashiers are strictly locked to their own outlet.
  const outletId = readOutletScope(user, searchParams.get('outletId'))
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
      return {
        code: ch.code, label: ch.label, reported,
        openingBalance: ex?.openingBalance ?? null, closingBalance: ex?.closingBalance ?? null,
        verifiedAmount: ex?.verifiedAmount ?? null, verifiedOpening: ex?.verifiedOpening ?? null, verifiedClosing: ex?.verifiedClosing ?? null,
        reason: ex?.reason || '', verifiedBy: ex?.verifiedBy || '',
      }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channels: any[] = Array.isArray(body.channels) ? body.channels : []
  const day = date ? new Date(date) : new Date()
  // Cashiers always reconcile their own outlet.
  const usedOutletId = writeOutletId(user, outletId)
  const canVerify = await canVerifyCash(user.email)
  const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : roundMoney(v as number))

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
    // Cashier fields
    if (num(entry.openingBalance) !== undefined) data.openingBalance = num(entry.openingBalance)
    if (num(entry.closingBalance) !== undefined) data.closingBalance = num(entry.closingBalance)
    // Officer-verified fields (gated). Verified amount is auto = verified closing − verified opening.
    const wantsVerify = [entry.verifiedOpening, entry.verifiedClosing].some((v) => v !== undefined && v !== null && v !== '')
    if (wantsVerify) {
      if (!canVerify) return NextResponse.json({ error: 'Only an authorized officer can enter verified amounts' }, { status: 403 })
      const vo = num(entry.verifiedOpening) ?? (existing?.verifiedOpening ?? 0)
      const vc = num(entry.verifiedClosing) ?? (existing?.verifiedClosing ?? 0)
      data.verifiedOpening = vo
      data.verifiedClosing = vc
      data.verifiedAmount = roundMoney(vc - vo)
      data.verifiedBy = user.name
    }
    const saved = existing
      ? await prisma.bankRecon.update({ where: { id: existing.id }, data })
      : await prisma.bankRecon.create({ data })

    // Feeds the Reconciliation Workflow Engine's PaymentVerification pilot
    // flow (source=SYSTEM_GENERATED) once an officer has verified this
    // channel — no-op for any company that hasn't enabled the
    // PAYMENT_VERIFICATION check.
    if (wantsVerify) {
      await syncFromBankRecon(saved.id).catch(() => {})
    }
  }

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'BankRecon', entityId: null, details: `Digital recon ${channels.length} channel(s)` },
  })

  return NextResponse.json({ ok: true })
}
