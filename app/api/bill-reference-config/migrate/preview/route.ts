import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { generateBillReferenceForBackfill, resolveBillTypeCodeFromLegacy } from '@/lib/bill-reference'

// Bill Reference migration is a deliberate, admin-triggered, one-way data
// backfill (see scripts/backfill-bill-references.ts) — restricted to ADMIN
// only, tighter than the ADMIN/DIRECTOR gate on bill-reference-config/route.ts.
const CAN_MIGRATE = ['ADMIN']

const MODELS = ['SignedBill', 'PaidBill', 'CashReconExcess', 'CollectionExcess', 'Breakage'] as const
type MigrateModel = (typeof MODELS)[number]

const CATEGORY_BY_MODEL: Record<MigrateModel, string> = {
  SignedBill: 'SIGNED_BILL',
  PaidBill: 'PAID_BILL',
  CashReconExcess: 'EXCESS_PAYMENT',
  CollectionExcess: 'EXCESS_PAYMENT',
  Breakage: 'LOSS_RECORD',
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 500

interface NormalizedRow {
  id: string
  date: Date | null
  personId: string | null
  outletId: string | null
  legacyValue: string | null
  oldReferenceValue: string | null
}

// Loose type — works with both the prisma singleton and a $transaction
// client, same convention as lib/bill-reference.ts's `Tx`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

/**
 * Fetches the next `take` not-yet-migrated (internalBillId IS NULL) rows for
 * `model`, normalized to a common shape. Each source model keeps its business
 * date / person / outlet on a different — sometimes indirect, via its parent
 * — field (see prisma/schema.prisma): CashReconExcess/CollectionExcess have
 * no date/outletId of their own, so those come from the parent CashRecon /
 * DailyCollection; Breakage has neither a date nor a personId field at all.
 * Ordered by createdAt so repeated calls (each against a shrinking WHERE, as
 * rows get migrated) walk the table in a stable, resumable order.
 */
async function fetchNextBatch(tx: Tx, model: MigrateModel, take: number): Promise<NormalizedRow[]> {
  switch (model) {
    case 'SignedBill': {
      const rows = await tx.signedBill.findMany({
        where: { internalBillId: null },
        orderBy: { createdAt: 'asc' },
        take,
        select: { id: true, date: true, personId: true, outletId: true, billType: true, voucherNumber: true },
      })
      return rows.map((r: { id: string; date: Date; personId: string | null; outletId: string; billType: string; voucherNumber: string | null }) => ({
        id: r.id, date: r.date, personId: r.personId, outletId: r.outletId,
        legacyValue: r.billType, oldReferenceValue: r.voucherNumber,
      }))
    }
    case 'PaidBill': {
      const rows = await tx.paidBill.findMany({
        where: { internalBillId: null },
        orderBy: { createdAt: 'asc' },
        take,
        select: { id: true, date: true, personId: true, outletId: true, billRef: true, signedBill: { select: { billType: true } } },
      })
      return rows.map((r: { id: string; date: Date; personId: string | null; outletId: string; billRef: string | null; signedBill: { billType: string } | null }) => ({
        id: r.id, date: r.date, personId: r.personId, outletId: r.outletId,
        legacyValue: r.signedBill?.billType ?? null, oldReferenceValue: r.billRef,
      }))
    }
    case 'CashReconExcess': {
      const rows = await tx.cashReconExcess.findMany({
        where: { internalBillId: null },
        orderBy: { createdAt: 'asc' },
        take,
        select: { id: true, personId: true, cashRecon: { select: { date: true, outletId: true } } },
      })
      return rows.map((r: { id: string; personId: string | null; cashRecon: { date: Date; outletId: string | null } | null }) => ({
        id: r.id, date: r.cashRecon?.date ?? null, personId: r.personId, outletId: r.cashRecon?.outletId ?? null,
        legacyValue: null, oldReferenceValue: null,
      }))
    }
    case 'CollectionExcess': {
      const rows = await tx.collectionExcess.findMany({
        where: { internalBillId: null },
        orderBy: { createdAt: 'asc' },
        take,
        select: { id: true, personId: true, collection: { select: { date: true, outletId: true } } },
      })
      return rows.map((r: { id: string; personId: string | null; collection: { date: Date; outletId: string } | null }) => ({
        id: r.id, date: r.collection?.date ?? null, personId: r.personId, outletId: r.collection?.outletId ?? null,
        legacyValue: null, oldReferenceValue: null,
      }))
    }
    case 'Breakage': {
      const rows = await tx.breakage.findMany({
        where: { internalBillId: null },
        orderBy: { createdAt: 'asc' },
        take,
        select: { id: true, createdAt: true, outletId: true },
      })
      return rows.map((r: { id: string; createdAt: Date; outletId: string | null }) => ({
        id: r.id, date: r.createdAt, personId: null, outletId: r.outletId,
        legacyValue: null, oldReferenceValue: null,
      }))
    }
  }
}

/** Thrown deliberately at the end of the preview transaction so Prisma
 *  cleanly discards every write made inside it (the BillSequenceCounter
 *  increments + BillReferenceRegistry inserts that generateBillReference
 *  performs internally) — a preview must NEVER advance a real counter. */
class PreviewRollback extends Error {
  constructor(public readonly results: unknown[]) {
    super('preview-rollback')
  }
}

/**
 * POST /api/bill-reference-config/migrate/preview — ADMIN only.
 * Body: { model, limit? (default 20, capped at 500) }.
 * Computes what the backfill WOULD generate for the next `limit` un-migrated
 * rows of `model`, without writing anything or touching real counters: the
 * real generation logic runs inside a prisma.$transaction that is
 * deliberately rolled back via a thrown error.
 */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CAN_MIGRATE)) {
    return NextResponse.json({ error: 'You are not authorized to preview the Bill Reference migration' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const modelInput = String(body.model || '')
  if (!MODELS.includes(modelInput as MigrateModel)) {
    return NextResponse.json({ error: `Invalid model — must be one of ${MODELS.join(', ')}` }, { status: 400 })
  }
  const model = modelInput as MigrateModel
  const limit = Number.isFinite(Number(body.limit)) && Number(body.limit) > 0
    ? Math.min(Math.floor(Number(body.limit)), MAX_LIMIT)
    : DEFAULT_LIMIT

  const category = CATEGORY_BY_MODEL[model]

  try {
    await prisma.$transaction(async (tx) => {
      const rows = await fetchNextBatch(tx, model, limit)
      const results: unknown[] = []
      for (const row of rows) {
        const billTypeCode = await resolveBillTypeCodeFromLegacy(tx, category, row.legacyValue)
        const gen = await generateBillReferenceForBackfill(tx, {
          recordId: row.id,
          sourceModel: model,
          billTypeCode,
          date: row.date,
          personId: row.personId,
          outletId: row.outletId,
          legacyValue: row.oldReferenceValue,
        })
        results.push({
          id: row.id,
          oldReference: row.oldReferenceValue,
          newInternalBillId: gen.internalBillId,
          newDisplayReference: gen.displayReference,
          billTypeCode,
        })
      }
      // Deliberate rollback — Prisma discards every write made above.
      throw new PreviewRollback(results)
    }, { timeout: 20000 })
    // Unreachable: the transaction above always either throws PreviewRollback
    // (success path) or a real error (failure path), never resolves normally.
    return NextResponse.json({ model, preview: [] })
  } catch (err) {
    if (err instanceof PreviewRollback) {
      return NextResponse.json({ model, preview: err.results })
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Preview failed', model }, { status: 500 })
  }
}
