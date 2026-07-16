import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { generateBillReferenceForBackfill, resolveBillTypeCodeFromLegacy } from '@/lib/bill-reference'

// Same ADMIN-only gate as migrate/preview — this route performs the real,
// irreversible-in-practice write (real bills already carry the OLD
// voucherNumber on paper, so nothing regenerates without an explicit confirm).
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

const BATCH_SIZE = 500
const SL_PREFIX_RE = /^SL-(.+)$/

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
 * `model`, normalized to a common shape. Kept identical to the twin function
 * in migrate/preview/route.ts (see that file for the per-model date/person/
 * outlet resolution rationale) — duplicated rather than cross-imported so
 * each route.ts stays a self-contained Next.js route module.
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

function getDelegate(tx: Tx, model: MigrateModel) {
  switch (model) {
    case 'SignedBill': return tx.signedBill
    case 'PaidBill': return tx.paidBill
    case 'CashReconExcess': return tx.cashReconExcess
    case 'CollectionExcess': return tx.collectionExcess
    case 'Breakage': return tx.breakage
  }
}

/**
 * POST /api/bill-reference-config/migrate/run — ADMIN only.
 * Body: { model, confirm: true }. 400 if confirm isn't exactly true.
 * Idempotent/resumable: repeatedly processes the next batch of up to 500
 * un-migrated (internalBillId IS NULL) rows for `model`, each batch in its
 * own prisma.$transaction (real writes this time, no rollback), looping
 * until a batch comes back empty. Safe to re-run after a partial failure —
 * already-migrated rows drop out of the WHERE clause, so it always resumes
 * from wherever it left off.
 */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CAN_MIGRATE)) {
    return NextResponse.json({ error: 'You are not authorized to run the Bill Reference migration' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const modelInput = String(body.model || '')
  if (!MODELS.includes(modelInput as MigrateModel)) {
    return NextResponse.json({ error: `Invalid model — must be one of ${MODELS.join(', ')}` }, { status: 400 })
  }
  const model = modelInput as MigrateModel
  if (body.confirm !== true) {
    return NextResponse.json({ error: 'confirm must be exactly true to run the migration' }, { status: 400 })
  }

  const category = CATEGORY_BY_MODEL[model]
  let totalMigrated = 0

  try {
    for (;;) {
      const batchCount: number = await prisma.$transaction(async (tx) => {
        const rows = await fetchNextBatch(tx, model, BATCH_SIZE)
        if (rows.length === 0) return 0

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

          const updateData: Record<string, unknown> = {
            internalBillId: gen.internalBillId,
            displayReference: gen.displayReference,
            billTypeConfigId: gen.billTypeConfigId,
          }
          if (model === 'SignedBill' || model === 'PaidBill') {
            updateData.legacyReference = gen.legacyReference
          }
          if (model === 'SignedBill') {
            const m = row.oldReferenceValue?.match(SL_PREFIX_RE)
            if (m) updateData.autoSourceCollectionId = m[1]
          }

          await getDelegate(tx, model).update({ where: { id: row.id }, data: updateData })
        }

        await tx.auditLog.create({
          data: {
            userId: user.userId,
            action: 'MIGRATE',
            entity: 'BillReferenceMigration',
            entityId: model,
            details: `Backfilled ${rows.length} ${model} row(s) with Bill References (offset ${totalMigrated})`,
          },
        })

        return rows.length
      }, { timeout: 30000 })

      if (batchCount === 0) break
      totalMigrated += batchCount
    }
  } catch (err) {
    // Each batch is its own transaction, so everything committed before the
    // failing batch stays migrated — re-POSTing the same body resumes cleanly
    // once the underlying issue (e.g. an unmappable legacy bill type) is fixed.
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Migration failed',
      model,
      migrated: totalMigrated,
    }, { status: 500 })
  }

  return NextResponse.json({ model, migrated: totalMigrated })
}
