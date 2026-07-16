// Standalone CLI runner for the Bill Reference System's one-time backfill
// (see lib/bill-reference.ts, app/api/bill-reference-config/migrate/{preview,run}/route.ts).
// Runs outside the Next.js server, so it bootstraps its own Prisma client
// with the same adapter-selection-by-DATABASE_URL pattern as prisma/seed.ts,
// rather than importing the Next.js route handlers directly.
//
// Usage:
//   npx tsx scripts/backfill-bill-references.ts [--dry-run] [--model=SignedBill]
//
//   --dry-run        Compute and print what WOULD be generated, without
//                     writing anything or touching real counters (same
//                     rollback-transaction trick as the preview API route).
//   --model=<Model>  Restrict to one of SignedBill | PaidBill |
//                     CashReconExcess | CollectionExcess | Breakage.
//                     Omit to process all 5, in that order.
//
// Without --dry-run this performs the REAL, resumable, batched migration
// (same logic as app/api/bill-reference-config/migrate/run/route.ts) — safe
// to re-run; already-migrated rows (internalBillId NOT NULL) are skipped.
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { generateBillReferenceForBackfill, resolveBillTypeCodeFromLegacy } from '../lib/bill-reference'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

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
 * `model`, normalized to a common shape. Kept in lockstep with the identical
 * function in app/api/bill-reference-config/migrate/{preview,run}/route.ts —
 * duplicated here since this script runs outside the Next.js server and
 * can't import route.ts modules (see file header).
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

/** Thrown deliberately at the end of a --dry-run transaction so Prisma
 *  cleanly discards every write (sequence increments + registry inserts). */
class PreviewRollback extends Error {
  constructor(public readonly results: { id: string; oldReference: string | null; newInternalBillId: string; newDisplayReference: string; billTypeCode: string }[]) {
    super('preview-rollback')
  }
}

/**
 * --dry-run for one model. Reads EVERY currently un-migrated row for `model`
 * and computes what it WOULD generate, all inside a single transaction that
 * is always rolled back — deliberately NOT chunked into multiple batches,
 * since (unlike the real run) nothing is ever persisted between batches, so
 * a second chunk would just recompute the same sequence values as the first.
 */
async function previewModel(model: MigrateModel): Promise<{ id: string; oldReference: string | null; newInternalBillId: string; newDisplayReference: string; billTypeCode: string }[]> {
  const category = CATEGORY_BY_MODEL[model]
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await fetchNextBatch(tx, model, 1_000_000)
      const results: { id: string; oldReference: string | null; newInternalBillId: string; newDisplayReference: string; billTypeCode: string }[] = []
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
      throw new PreviewRollback(results)
    }, { timeout: 60000 })
  } catch (err) {
    if (err instanceof PreviewRollback) return err.results
    throw err
  }
  return [] // unreachable
}

/** Real, resumable, batched migration for one model — identical logic to
 *  app/api/bill-reference-config/migrate/run/route.ts. Returns the total
 *  number of rows migrated for this model. */
async function runModel(model: MigrateModel): Promise<number> {
  const category = CATEGORY_BY_MODEL[model]
  let totalMigrated = 0

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

      return rows.length
    }, { timeout: 30000 })

    if (batchCount === 0) break
    totalMigrated += batchCount
    console.log(`  ... migrated ${totalMigrated} ${model} row(s) so far`)
  }

  return totalMigrated
}

function parseArgs(argv: string[]): { dryRun: boolean; models: MigrateModel[] } {
  const dryRun = argv.includes('--dry-run')
  const modelArg = argv.find((a) => a.startsWith('--model='))
  if (!modelArg) return { dryRun, models: [...MODELS] }
  const modelInput = modelArg.slice('--model='.length)
  if (!MODELS.includes(modelInput as MigrateModel)) {
    throw new Error(`Invalid --model "${modelInput}" — must be one of ${MODELS.join(', ')}`)
  }
  return { dryRun, models: [modelInput as MigrateModel] }
}

async function main() {
  const { dryRun, models } = parseArgs(process.argv.slice(2))
  console.log(`Bill Reference backfill — ${dryRun ? 'DRY RUN (no writes)' : 'LIVE RUN'} — model(s): ${models.join(', ')}\n`)

  if (dryRun) {
    let totalPreviewed = 0
    for (const model of models) {
      const results = await previewModel(model)
      console.log(`\n${model}: ${results.length} un-migrated row(s)`)
      if (results.length) console.table(results)
      totalPreviewed += results.length
    }
    console.log(`\nDry run complete — ${totalPreviewed} row(s) previewed across ${models.length} model(s). No writes were made.`)
    return
  }

  let totalMigrated = 0
  for (const model of models) {
    console.log(`\n${model}: starting migration...`)
    const migrated = await runModel(model)
    console.log(`${model}: done — ${migrated} row(s) migrated`)
    totalMigrated += migrated
  }
  console.log(`\nMigration complete — ${totalMigrated} row(s) migrated across ${models.length} model(s).`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
