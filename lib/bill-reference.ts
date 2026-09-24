// The Bill Reference System's generation engine. Fully metadata-driven — no
// hardcoded prefixes/date formats/separators/numbering rules. Scope is
// deliberately limited to "bills" (SignedBill, PaidBill, CashReconExcess /
// CollectionExcess, Breakage, ExcessRefund); PO/GRN/Transfer/Booking/PosOrder
// numbering is a separate, untouched system (see lib/stock.ts, lib/bookings.ts).
//
// Every entry point here MUST be called inside the caller's own
// prisma.$transaction — the sequence counter increment + BillReferenceRegistry
// insert must be atomic with the actual bill row's creation, exactly like
// upsertStockLevel in lib/stock.ts is atomic with its StockLedgerEntry write.
import { format } from 'date-fns'
import { DEFAULT_BILL_TYPES, DEFAULT_REFERENCE_COMPONENTS } from './bill-reference-defaults'
import { resolveEffectiveConfig, resolveBusinessDate as resolveEngineBusinessDate } from '@/lib/business-calendar'

// Loose type — works with both the prisma singleton and a $transaction
// client, same convention as lib/stock.ts's `Tx` / lib/collection-excess.ts's `DB`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

export type BillReferenceSourceModel =
  | 'SignedBill'
  | 'PaidBill'
  | 'CashReconExcess'
  | 'CollectionExcess'
  | 'Breakage'
  | 'ExcessRefund'

export interface BillReferenceContext {
  // Pre-generated id (crypto.randomUUID()) — pass the SAME value as the `id`
  // field when you .create() the source row, so the registry's sourceId
  // truly links back to it despite the row not existing yet at this point.
  recordId: string
  sourceModel: BillReferenceSourceModel
  billTypeCode: string // e.g. 'SBC' -> resolves BillTypeConfig
  date?: Date | null
  personId?: string | null
  personCode?: string | null // explicit override; else resolved from Person.code via personId
  outletId?: string | null
  branchCode?: string | null // explicit override; else resolved from Outlet.branchCode / slugified name
  departmentCode?: string | null // caller-supplied — bills have no Department FK today
  counterCode?: string | null // caller-supplied — bills have no PosCounter FK today
}

export interface GeneratedBillReference {
  internalBillId: string
  displayReference: string
  billTypeConfigId: string
  sequenceValue: number
}

const DATE_FORMAT_TOKENS: Record<string, string> = {
  YYMMDD: 'yyMMdd',
  DDMMYY: 'ddMMyy',
  YYYYMMDD: 'yyyyMMdd',
  'DD-MM-YYYY': 'dd-MM-yyyy',
  'MM-YYYY': 'MM-yyyy',
}

const MAX_ATTEMPTS = 5

export function slugifyOutletName(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6)
}

// Named the same as lib/business-date.ts's cutover resolver, but this one now
// actually calls the Business Calendar Engine instead of the raw clock — a
// 2am signed bill's reference date used to be "today", drifting from what
// Collections calls that sale's business date. `ctx.date`, when the caller
// supplies it explicitly, is trusted as-is (some callers pre-resolve it).
async function resolveBusinessDate(ctx: { date?: Date | null; outletId?: string | null }): Promise<Date> {
  if (ctx.date) return ctx.date
  const effective = await resolveEffectiveConfig({ outletId: ctx.outletId })
  return resolveEngineBusinessDate(new Date(), effective)
}

/** Seeds the 15 default bill types once, the first time any of them is needed
 *  — same lazy-seed-on-first-use convention as app/api/payment-channels/route.ts. */
export async function seedBillTypesIfEmpty(tx: Tx): Promise<void> {
  if ((await tx.billTypeConfig.count()) === 0) {
    for (const d of DEFAULT_BILL_TYPES) {
      await tx.billTypeConfig.upsert({ where: { code: d.code }, update: {}, create: d })
    }
  }
}

/** Loads (or lazily creates) the singleton BillReferenceConfig + its enabled,
 *  ordered components. */
async function loadReferenceConfig(tx: Tx) {
  const existing = await tx.billReferenceConfig.findUnique({
    where: { id: 'default' },
    include: { components: { where: { isEnabled: true }, orderBy: { order: 'asc' } } },
  })
  if (existing) return existing
  try {
    return await tx.billReferenceConfig.create({
      data: { id: 'default', components: { create: DEFAULT_REFERENCE_COMPONENTS } },
      include: { components: { where: { isEnabled: true }, orderBy: { order: 'asc' } } },
    })
  } catch (err) {
    // Concurrent first-ever-use race — recover by re-reading rather than failing.
    if (err instanceof Error && err.message.includes('Unique')) {
      const created = await tx.billReferenceConfig.findUnique({
        where: { id: 'default' },
        include: { components: { where: { isEnabled: true }, orderBy: { order: 'asc' } } },
      })
      if (created) return created
    }
    throw err
  }
}

/** Atomic get-or-create-then-increment counter, keyed by an opaque scopeKey.
 *  Mirrors the recovery pattern in lib/stock.ts's upsertStockLevel: a
 *  concurrent first-ever increment for the same scopeKey can race here, so
 *  a failed create falls back to the update path instead of failing outright. */
async function nextSequenceValue(tx: Tx, scopeKey: string): Promise<number> {
  try {
    const updated = await tx.billSequenceCounter.update({ where: { scopeKey }, data: { lastValue: { increment: 1 } } })
    return updated.lastValue
  } catch {
    try {
      const created = await tx.billSequenceCounter.create({ data: { scopeKey, lastValue: 1 } })
      return created.lastValue
    } catch (createErr) {
      if (createErr instanceof Error && createErr.message.includes('Unique')) {
        const updated = await tx.billSequenceCounter.update({ where: { scopeKey }, data: { lastValue: { increment: 1 } } })
        return updated.lastValue
      }
      throw createErr
    }
  }
}

/** Generic, exported version of the atomic counter above — same primitive,
 *  exposed for other callers that need a collision-safe per-scope sequence
 *  without going through the full bill-reference generation pipeline (e.g.
 *  Person Code assignment via lib/person-code.ts, scopeKey `PERSONCODE:<type>`).
 *  MUST be called inside the caller's own prisma.$transaction, same as every
 *  other entry point in this file. */
export async function nextGenericSequenceValue(tx: Tx, scopeKey: string): Promise<number> {
  return nextSequenceValue(tx, scopeKey)
}

/** Always prefixed by billTypeId — every bill type has its own independent
 *  counter regardless of reset rule (confirmed with the business: "Never"
 *  and "Per Bill Type" are deliberately the same behavior — one ever-growing
 *  counter per type — since per-type scoping is structurally mandatory anyway,
 *  not an accidental omission). */
function resolveScopeKey(rule: string, billTypeId: string, ctx: { date: Date; personId?: string | null; personCode?: string | null }): string {
  const base = `BT:${billTypeId}`
  switch (rule) {
    case 'DAILY': return `${base}:D:${format(ctx.date, 'yyyyMMdd')}`
    case 'MONTHLY': return `${base}:M:${format(ctx.date, 'yyyyMM')}`
    case 'YEARLY': return `${base}:Y:${format(ctx.date, 'yyyy')}`
    case 'PER_PERSON': return `${base}:P:${ctx.personId ?? ctx.personCode ?? 'UNASSIGNED'}`
    default: return `${base}:ALL` // NEVER | PER_BILL_TYPE
  }
}

/** Always "B-YYYYMMDD-NNNNNN" — completely independent of admin config, so it
 *  can never change even if the Display Reference format changes later. */
async function nextInternalBillId(tx: Tx, date: Date): Promise<string> {
  const dayBucket = format(date, 'yyyyMMdd')
  const n = await nextSequenceValue(tx, `INTERNAL:${dayBucket}`)
  return `B-${dayBucket}-${String(n).padStart(6, '0')}`
}

function formatConfiguredDate(config: { dateFormat: string; customDateFormat: string | null }, date: Date): string {
  if (config.dateFormat === 'CUSTOM' && config.customDateFormat) return format(date, config.customDateFormat)
  return format(date, DATE_FORMAT_TOKENS[config.dateFormat] || DATE_FORMAT_TOKENS.YYMMDD)
}

export function resolveOutletCode(explicitBranchCode: string | null | undefined, outlet: { branchCode: string | null; name: string } | null): string {
  if (explicitBranchCode) return explicitBranchCode
  if (outlet?.branchCode) return outlet.branchCode
  if (outlet?.name) return slugifyOutletName(outlet.name)
  return ''
}

function renderDisplayReference(opts: {
  config: { separator: string; numberPadding: number; dateFormat: string; customDateFormat: string | null }
  components: { type: string; staticValue: string | null }[]
  billTypeConfig: { prefix: string }
  ctx: { departmentCode?: string | null; counterCode?: string | null }
  date: Date
  sequenceValue: number
  personCode: string | null
  outletCode: string
}): string {
  const { config, components, billTypeConfig, ctx, date, sequenceValue, personCode, outletCode } = opts
  const parts = components.map((c) => {
    switch (c.type) {
      case 'DATE': return formatConfiguredDate(config, date)
      case 'BILL_TYPE_CODE': return billTypeConfig.prefix
      case 'PERSON_CODE': return personCode || ''
      case 'SEQUENCE': return String(sequenceValue).padStart(config.numberPadding, '0')
      case 'COMPANY_CODE':
      case 'BRANCH_CODE':
      case 'OUTLET_CODE': return outletCode
      case 'DEPARTMENT_CODE': return ctx.departmentCode || ''
      case 'COUNTER_CODE': return ctx.counterCode || ''
      case 'STATIC_TEXT': return c.staticValue || ''
      default: return ''
    }
  })
  const sep = config.separator === 'NONE' ? '' : config.separator
  return parts.filter((p) => p !== '').join(sep)
}

async function resolvePersonCode(tx: Tx, ctx: { personId?: string | null; personCode?: string | null }): Promise<string | null> {
  if (ctx.personCode) return ctx.personCode
  if (!ctx.personId) return null
  const person = await tx.person.findUnique({ where: { id: ctx.personId }, select: { code: true } })
  return person?.code ?? null
}

async function resolveOutletCodeForCtx(tx: Tx, ctx: { branchCode?: string | null; outletId?: string | null }): Promise<string> {
  if (ctx.branchCode) return ctx.branchCode
  if (!ctx.outletId) return ''
  const outlet = await tx.outlet.findUnique({ where: { id: ctx.outletId }, select: { branchCode: true, name: true } })
  return resolveOutletCode(ctx.branchCode, outlet)
}

/**
 * Generates a permanent Internal Bill ID + a configurable Display Reference
 * for a new bill, and reserves both in BillReferenceRegistry (the single
 * cross-table uniqueness/collision point). MUST be called inside the
 * caller's own prisma.$transaction, alongside the actual source row .create().
 */
export async function generateBillReference(tx: Tx, ctx: BillReferenceContext): Promise<GeneratedBillReference> {
  await seedBillTypesIfEmpty(tx)

  const billTypeConfig = await tx.billTypeConfig.findUnique({ where: { code: ctx.billTypeCode } })
  if (!billTypeConfig) throw new Error(`Unknown bill type "${ctx.billTypeCode}" — check Bill Types settings`)
  if (!billTypeConfig.isActive) throw new Error(`Bill type "${billTypeConfig.name}" is deactivated — reactivate it in Bill Types settings before creating new bills of this type`)

  const config = await loadReferenceConfig(tx)
  const date = await resolveBusinessDate(ctx)
  const personCode = await resolvePersonCode(tx, ctx)
  const outletCode = await resolveOutletCodeForCtx(tx, ctx)

  let lastErr: unknown = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const scopeKey = resolveScopeKey(config.sequenceResetRule, billTypeConfig.id, { date, personId: ctx.personId, personCode })
    const sequenceValue = await nextSequenceValue(tx, scopeKey)
    const internalBillId = await nextInternalBillId(tx, date)
    const displayReference = renderDisplayReference({ config, components: config.components, billTypeConfig, ctx, date, sequenceValue, personCode, outletCode })

    try {
      await tx.billReferenceRegistry.create({
        data: { internalBillId, displayReference, sourceModel: ctx.sourceModel, sourceId: ctx.recordId, billTypeId: billTypeConfig.id },
      })
      return { internalBillId, displayReference, billTypeConfigId: billTypeConfig.id, sequenceValue }
    } catch (err) {
      lastErr = err
      if (err instanceof Error && err.message.includes('Unique')) continue // auto-advance to the next sequence value
      throw err
    }
  }
  throw new Error(
    `Bill Reference Settings layout for "${billTypeConfig.name}" keeps producing duplicate references after ${MAX_ATTEMPTS} attempts — ` +
    `enable more components (e.g. Date or Sequence) in Bill Reference Settings.` + (lastErr instanceof Error ? ` (${lastErr.message})` : '')
  )
}

/** Backfill-only variant — same generation, plus carries the old value
 *  through as legacyReference so it stays searchable after migration. */
export async function generateBillReferenceForBackfill(
  tx: Tx,
  ctx: BillReferenceContext & { legacyValue: string | null }
): Promise<GeneratedBillReference & { legacyReference: string | null }> {
  const generated = await generateBillReference(tx, ctx)
  return { ...generated, legacyReference: ctx.legacyValue }
}

/** Resolves a legacy SignedBill.billType (or category-only fallback) to a
 *  BillTypeConfig.code — used only by the backfill script. */
export async function resolveBillTypeCodeFromLegacy(tx: Tx, category: string, legacyBillTypeCode: string | null): Promise<string> {
  await seedBillTypesIfEmpty(tx)
  if (legacyBillTypeCode) {
    const match = await tx.billTypeConfig.findFirst({ where: { category, legacyBillTypeCode } })
    if (match) return match.code
  }
  // Flows with no clean legacy category (payroll deductions, COL- collection
  // recoveries) default to the closest fit; easily reassigned later via
  // Bill Types settings since billTypeConfigId is just a field, not baked
  // into the already-generated reference.
  if (category === 'PAID_BILL') return 'PBS'
  if (category === 'EXCESS_PAYMENT') return 'EXS'
  if (category === 'LOSS_RECORD') return 'LOS'
  throw new Error(`Cannot resolve a bill type for category ${category} (legacy value: ${legacyBillTypeCode ?? 'none'})`)
}

/** Pure, side-effect-free — never touches real counters/registry. Used by the
 *  Bill Reference Settings page's live preview. */
export async function previewDisplayReference(tx: Tx, sample: Partial<BillReferenceContext> & { billTypeCode: string }): Promise<string> {
  await seedBillTypesIfEmpty(tx)
  const billTypeConfig = await tx.billTypeConfig.findUnique({ where: { code: sample.billTypeCode } })
  if (!billTypeConfig) throw new Error(`Unknown bill type "${sample.billTypeCode}"`)

  const config = await loadReferenceConfig(tx)
  const date = await resolveBusinessDate(sample)
  const personCode = sample.personCode ?? (await resolvePersonCode(tx, sample)) ?? '14'
  let outletCode = await resolveOutletCodeForCtx(tx, sample)
  if (!outletCode) outletCode = 'DSM'

  return renderDisplayReference({ config, components: config.components, billTypeConfig, ctx: sample, date, sequenceValue: 3, personCode, outletCode })
}
