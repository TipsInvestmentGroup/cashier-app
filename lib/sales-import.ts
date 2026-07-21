// Sales Import Center — core resolution & commit engine.
//
// Pipeline: Upload → Data Cleaning → Validation → Mapping → Preview → Approval → Import.
// This module owns the server side of Clean/Validate/Map (resolveLines) and the
// Import step (commitImport). It is deliberately generic across ALL product
// categories — nothing here is hardcoded to Shisha/Food.
//
// Compatibility contract: on commit we still write SalesMetric rows (SHISHA as a
// count, FOOD as an amount) exactly the way lib/target-actuals.ts classifies
// them, so Targets/actuals and day-close keep working unchanged. The full
// item-level detail lives in SalesImportLine, which powers product analytics.

import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'
import { startOfDay, format } from 'date-fns'
import { normalizeName, bestMatch } from '@/lib/fuzzy-match'
import { resolvePrices } from '@/lib/pricing'
import { createNotification } from '@/lib/notifications'

// SalesImport* client types are generated on deploy; assert to avoid local drift.
const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

export type ImportStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'IMPORTED'

// Confidence above which a fuzzy match is auto-applied (but still flagged for
// review as low-confidence). Below it, the row is left unmatched with a
// suggestion the user can accept.
const FUZZY_AUTO = 0.85
const FUZZY_SUGGEST = 0.55
const PRICE_TOLERANCE = 0.01 // 1% — ignore rounding noise

export type IssueCode =
  | 'UNKNOWN_STAFF'
  | 'UNKNOWN_PRODUCT'
  | 'LOW_CONFIDENCE_STAFF'
  | 'LOW_CONFIDENCE_PRODUCT'
  | 'PRICE_MISMATCH'
  | 'MISSING_VALUE'
  | 'MISSING_STAFF'
  | 'DUPLICATE'

/** A raw parsed row from the uploaded sheet (item-level). */
export interface RawLine {
  date?: string // yyyy-MM-dd; falls back to the batch default date
  staffRaw: string
  productRaw: string
  qty: number
  amount: number
}

export interface ResolvedLine {
  date: string
  rawStaffName: string
  staffName: string
  staffMatched: boolean
  staffSuggestion: { name: string; score: number } | null
  rawProductName: string
  productId: string | null
  productName: string
  productMatched: boolean
  productSuggestion: { id: string; name: string; score: number } | null
  categoryId: string | null
  categoryName: string | null
  qty: number
  amount: number
  unitPriceUploaded: number | null
  unitPriceMaster: number | null // expected unit price (Price List Engine)
  priceListId: string | null // which price list supplied the expected price
  priceMismatch: boolean
  issues: IssueCode[]
}

export interface MasterData {
  persons: { id: string; name: string }[]
  products: { id: string; name: string; sellingPrice: number; categoryId: string | null; categoryName: string | null }[]
  staffAliases: Map<string, { staffName: string; personId: string | null }>
  productAliases: Map<string, { productId: string; productName: string }>
}

/** Load everything resolveLines needs to reconcile a batch against master data. */
export async function loadMasterData(companyId = ''): Promise<MasterData> {
  const [persons, products, sAliases, pAliases] = await Promise.all([
    prisma.person.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sellingPrice: true, categoryId: true, category: true, productCategory: { select: { label: true } } },
    }),
    db.salesStaffAlias.findMany({ where: { companyId }, select: { alias: true, staffName: true, personId: true } }),
    db.salesProductAlias.findMany({ where: { companyId }, select: { alias: true, productId: true, productName: true } }),
  ])

  const staffAliases = new Map<string, { staffName: string; personId: string | null }>()
  for (const a of sAliases as { alias: string; staffName: string; personId: string | null }[]) staffAliases.set(a.alias, { staffName: a.staffName, personId: a.personId })
  const productAliases = new Map<string, { productId: string; productName: string }>()
  for (const a of pAliases as { alias: string; productId: string; productName: string }[]) productAliases.set(a.alias, { productId: a.productId, productName: a.productName })

  return {
    persons,
    products: (products as { id: string; name: string; sellingPrice: number; categoryId: string | null; category: string | null; productCategory: { label: string } | null }[]).map((p) => ({
      id: p.id,
      name: p.name,
      sellingPrice: p.sellingPrice,
      categoryId: p.categoryId,
      categoryName: p.productCategory?.label || p.category || null,
    })),
    staffAliases,
    productAliases,
  }
}

/**
 * SalesMetric compatibility bucket for a line — mirrors lib/target-actuals.ts:
 * name/category containing "shisha" → SHISHA (measured as a count/qty),
 * "food" → FOOD (measured as an amount). Everything else has no legacy bucket
 * (it still lives in SalesImportLine for analytics).
 */
export function classifyDept(categoryName: string | null | undefined, productName: string | null | undefined): 'SHISHA' | 'FOOD' | null {
  const hay = `${categoryName || ''} ${productName || ''}`.toLowerCase()
  if (hay.includes('shisha')) return 'SHISHA'
  if (hay.includes('food')) return 'FOOD'
  return null
}

/**
 * The Clean + Validate + Map stages: reconcile each raw row against master data
 * (exact → remembered alias → fuzzy), compute price comparison, and attach
 * data-quality flags. Pure/deterministic given its inputs.
 */
export function resolveLines(raw: RawLine[], master: MasterData, defaultDate: string): ResolvedLine[] {
  const personCandidates = master.persons.map((p) => p.name)
  const productCandidates = master.products.map((p) => ({ label: p.name, value: p.id }))
  const personByNorm = new Map(master.persons.map((p) => [normalizeName(p.name), p]))
  const productByNorm = new Map(master.products.map((p) => [normalizeName(p.name), p]))

  const seen = new Set<string>()

  return raw.map((r): ResolvedLine => {
    const issues: IssueCode[] = []
    const date = r.date || defaultDate
    const qty = roundMoney(Number(r.qty) || 0)
    const amount = roundMoney(Number(r.amount) || 0)

    // ── Staff resolution ──
    const staffRaw = String(r.staffRaw || '').trim()
    const staffNorm = normalizeName(staffRaw)
    let staffName = staffRaw
    let staffMatched = false
    let staffSuggestion: { name: string; score: number } | null = null
    if (!staffRaw) {
      issues.push('MISSING_STAFF')
    } else if (personByNorm.has(staffNorm)) {
      staffName = personByNorm.get(staffNorm)!.name
      staffMatched = true
    } else if (master.staffAliases.has(staffNorm)) {
      staffName = master.staffAliases.get(staffNorm)!.staffName
      staffMatched = true
    } else {
      const s = bestMatch(staffRaw, personCandidates, FUZZY_SUGGEST)
      if (s && s.score >= FUZZY_AUTO) {
        staffName = s.value
        staffMatched = true
        issues.push('LOW_CONFIDENCE_STAFF')
        staffSuggestion = { name: s.value, score: s.score }
      } else {
        issues.push('UNKNOWN_STAFF')
        if (s) staffSuggestion = { name: s.value, score: s.score }
      }
    }

    // ── Product resolution ──
    const productRaw = String(r.productRaw || '').trim()
    const productNorm = normalizeName(productRaw)
    let productId: string | null = null
    let productName = productRaw
    let categoryId: string | null = null
    let categoryName: string | null = null
    let unitPriceMaster: number | null = null
    let productMatched = false
    let productSuggestion: { id: string; name: string; score: number } | null = null
    const applyProduct = (id: string) => {
      const p = master.products.find((x) => x.id === id)
      if (!p) return
      productId = p.id; productName = p.name; categoryId = p.categoryId; categoryName = p.categoryName; unitPriceMaster = p.sellingPrice
    }
    if (!productRaw) {
      productMatched = true // an item name is optional (some sheets are staff-total only)
    } else if (productByNorm.has(productNorm)) {
      applyProduct(productByNorm.get(productNorm)!.id)
      productMatched = true
    } else if (master.productAliases.has(productNorm)) {
      applyProduct(master.productAliases.get(productNorm)!.productId)
      productMatched = true
    } else {
      const s = bestMatch(productRaw, productCandidates, FUZZY_SUGGEST)
      if (s && s.score >= FUZZY_AUTO) {
        applyProduct(s.value)
        productMatched = true
        issues.push('LOW_CONFIDENCE_PRODUCT')
        productSuggestion = { id: s.value, name: s.label, score: s.score }
      } else {
        issues.push('UNKNOWN_PRODUCT')
        if (s) productSuggestion = { id: s.value, name: s.label, score: s.score }
      }
    }

    // ── Price comparison ──
    const unitPriceUploaded = qty > 0 ? roundMoney(amount / qty) : null
    let priceMismatch = false
    if (productMatched && unitPriceMaster && unitPriceMaster > 0 && unitPriceUploaded && unitPriceUploaded > 0) {
      const diff = Math.abs(unitPriceUploaded - unitPriceMaster) / unitPriceMaster
      if (diff > PRICE_TOLERANCE) { priceMismatch = true; issues.push('PRICE_MISMATCH') }
    }

    // ── Missing / duplicate ──
    if (qty <= 0 && amount <= 0) issues.push('MISSING_VALUE')
    const dupKey = `${date}|${staffNorm}|${productNorm}`
    if (seen.has(dupKey)) issues.push('DUPLICATE')
    else seen.add(dupKey)

    return {
      date, rawStaffName: staffRaw, staffName, staffMatched, staffSuggestion,
      rawProductName: productRaw, productId, productName, productMatched, productSuggestion,
      categoryId, categoryName, qty, amount, unitPriceUploaded, unitPriceMaster, priceListId: null, priceMismatch, issues,
    }
  })
}

/**
 * Overlay Price-List-Engine expected prices onto resolved lines. Replaces the
 * naive Product.sellingPrice comparison from resolveLines with the outlet/date-
 * aware engine price, records which price list supplied it, and recomputes the
 * PRICE_MISMATCH flag. Call after resolveLines, before preview/persist.
 */
export async function overlayEnginePrices(lines: ResolvedLine[], ctx: { outletId?: string | null; date?: Date }): Promise<ResolvedLine[]> {
  const ids = [...new Set(lines.filter((l) => l.productId).map((l) => l.productId as string))]
  if (!ids.length) return lines
  const prices = await resolvePrices(ids, ctx)
  return lines.map((l) => {
    if (!l.productId) return l
    const rp = prices.get(l.productId)
    if (!rp) return l
    const up = l.unitPriceUploaded
    const priceMismatch = !!(rp.price > 0 && up && up > 0 && Math.abs(up - rp.price) / rp.price > PRICE_TOLERANCE)
    const issues: IssueCode[] = l.issues.filter((i) => i !== 'PRICE_MISMATCH')
    if (priceMismatch) issues.push('PRICE_MISMATCH')
    return { ...l, unitPriceMaster: rp.price, priceListId: rp.priceListId, priceMismatch, issues }
  })
}

/** Blocking issues that must be corrected before an import can be approved. */
export function hasBlockingIssues(line: { issues: IssueCode[] | string[] }): boolean {
  return (line.issues as string[]).some((i) => i === 'UNKNOWN_STAFF' || i === 'MISSING_STAFF' || i === 'MISSING_VALUE')
}

// Local calendar-day key. Uses date-fns format (local time), NOT
// toISOString().slice — the latter shifts by a day for a stored local-midnight
// value in a positive-offset timezone (e.g. EAT/UTC+3, Dar es Salaam).
const dayKey = (d: Date) => format(startOfDay(d), 'yyyy-MM-dd')

/**
 * The Import step. Turns an approved batch's lines into SalesMetric rows and
 * remembers the mappings. Authoritative-replace per (outlet, date) for the
 * SHISHA/FOOD buckets so a corrected re-import fully supersedes the prior one;
 * blocked (never partial) if any affected day is locked.
 */
export async function commitImport(importId: string, actor: { userId: string; userName: string }): Promise<
  | { ok: true; salesMetricRows: number; lineCount: number }
  | { ok: false; blocked: true; lockedDays: string[] }
  | { ok: false; error: string }
> {
  const imp = await db.salesImport.findUnique({ where: { id: importId }, include: { lines: true } })
  if (!imp) return { ok: false, error: 'Import not found' }
  if (imp.status === 'IMPORTED') return { ok: false, error: 'This import has already been imported.' }
  if (imp.status === 'REJECTED') return { ok: false, error: 'A rejected import cannot be imported.' }

  const lines = imp.lines as {
    date: Date; outletId: string | null; staffName: string; staffMatched: boolean
    rawStaffName: string; rawProductName: string; productId: string | null; productName: string
    productMatched: boolean; categoryId: string | null; categoryName: string | null; qty: number; amount: number
  }[]

  // Aggregate to the SalesMetric grain: (outlet, date, staff) → shisha qty + food amount.
  const agg = new Map<string, { outletId: string | null; date: Date; staffName: string; shishaQty: number; foodAmount: number }>()
  for (const l of lines) {
    const oid = l.outletId ?? imp.outletId ?? null
    const k = `${oid}|${dayKey(l.date)}|${l.staffName.trim().toLowerCase()}`
    const cur = agg.get(k) || { outletId: oid, date: startOfDay(l.date), staffName: l.staffName.trim(), shishaQty: 0, foodAmount: 0 }
    const dept = classifyDept(l.categoryName, l.productName)
    if (dept === 'SHISHA') cur.shishaQty += l.qty || 0
    else if (dept === 'FOOD') cur.foodAmount += l.amount || 0
    agg.set(k, cur)
  }

  const metricRows: { date: Date; outletId: string | null; department: string; staffName: string; value: number; createdById: string }[] = []
  for (const g of agg.values()) {
    if (g.shishaQty > 0) metricRows.push({ date: g.date, outletId: g.outletId, department: 'SHISHA', staffName: g.staffName, value: roundMoney(g.shishaQty), createdById: actor.userId })
    if (g.foodAmount > 0) metricRows.push({ date: g.date, outletId: g.outletId, department: 'FOOD', staffName: g.staffName, value: roundMoney(g.foodAmount), createdById: actor.userId })
  }

  // Days/outlets this import is authoritative for (SHISHA + FOOD get replaced).
  // dayStarts are the exact local-midnight Date values the line/metric rows are
  // stored with, so an { in: dayStarts } filter matches precisely (no TZ drift).
  const outletId = imp.outletId ?? null
  const dayStartMap = new Map<string, Date>()
  for (const l of lines) { const s = startOfDay(l.date); dayStartMap.set(dayKey(s), s) }
  const dates = [...dayStartMap.keys()].sort() // yyyy-MM-dd sorts chronologically
  const dayStarts = [...dayStartMap.values()]

  // Lock guard — refuse (never partially write) if any affected day is locked.
  const locks = await db.salesMetricLock.findMany({
    where: { outletId, department: { in: ['SHISHA', 'FOOD'] }, date: { in: dayStarts } },
    select: { date: true },
  })
  if ((locks as { date: Date }[]).length) {
    const lockedDays = [...new Set((locks as { date: Date }[]).map((l) => dayKey(l.date)))]
    return { ok: false, blocked: true, lockedDays }
  }

  // Remember the mappings the user resolved (raw → canonical), skipping trivial
  // identity matches. companyId "" = single-company default; multi-company later.
  const companyId = ''
  const staffAliasOps = new Map<string, { alias: string; staffName: string }>()
  const productAliasOps = new Map<string, { alias: string; productId: string; productName: string }>()
  for (const l of lines) {
    if (l.staffMatched && l.rawStaffName) {
      const alias = normalizeName(l.rawStaffName)
      if (alias && alias !== normalizeName(l.staffName)) staffAliasOps.set(alias, { alias, staffName: l.staffName })
    }
    if (l.productMatched && l.productId && l.rawProductName) {
      const alias = normalizeName(l.rawProductName)
      if (alias && alias !== normalizeName(l.productName)) productAliasOps.set(alias, { alias, productId: l.productId, productName: l.productName })
    }
  }

  await prisma.$transaction(async (tx) => {
    const tdb = tx as any // eslint-disable-line @typescript-eslint/no-explicit-any

    // Supersede prior IMPORTED lines for exactly these (outlet, day) pairs so
    // analytics/BI never double-count a re-imported day. Line-level (not batch-
    // level) so a multi-day batch keeps its non-overlapping days. Two-step to
    // avoid a relation filter inside updateMany.
    const priorImported = await tdb.salesImport.findMany({ where: { outletId, status: 'IMPORTED', id: { not: importId } }, select: { id: true } }) as { id: string }[]
    if (priorImported.length) {
      await tdb.salesImportLine.updateMany({
        where: { importId: { in: priorImported.map((p) => p.id) }, date: { in: dayStarts }, superseded: false },
        data: { superseded: true, supersededByImportId: importId },
      })
    }

    // Authoritative replace of the SHISHA/FOOD buckets for exactly these
    // (outlet, day) pairs — precise { in } match, no gap-spanning range.
    await tdb.salesMetric.deleteMany({ where: { outletId, department: { in: ['SHISHA', 'FOOD'] }, date: { in: dayStarts } } })
    if (metricRows.length) await tdb.salesMetric.createMany({ data: metricRows })

    for (const a of staffAliasOps.values()) {
      await tdb.salesStaffAlias.upsert({
        where: { companyId_alias: { companyId, alias: a.alias } },
        update: { staffName: a.staffName },
        create: { companyId, alias: a.alias, staffName: a.staffName, createdById: actor.userId },
      })
    }
    for (const a of productAliasOps.values()) {
      await tdb.salesProductAlias.upsert({
        where: { companyId_alias: { companyId, alias: a.alias } },
        update: { productId: a.productId, productName: a.productName },
        create: { companyId, alias: a.alias, productId: a.productId, productName: a.productName, createdById: actor.userId },
      })
    }

    await tdb.salesImport.update({
      where: { id: importId },
      data: { status: 'IMPORTED', importedAt: new Date(), approvedById: actor.userId, approvedByName: actor.userName, approvedAt: new Date() },
    })
    await tdb.auditLog.create({
      data: { userId: actor.userId, action: 'IMPORT', entity: 'SalesImport', entityId: importId, details: `Imported ${lines.length} sales lines → ${metricRows.length} metric rows (${dates.join(', ')})` },
    })
  })

  // A saved Daily Report for any of these days is now out of date — flag it for
  // review (reverting a FINALIZED one to DRAFT) and notify the cashier who saved
  // it to refresh and re-finalize. Non-fatal.
  try {
    const reports = await db.dailyReport.findMany({ where: { outletId, date: { in: dayStarts } } }) as { id: string; date: Date; status: string; savedById: string | null }[]
    for (const r of reports) {
      await db.dailyReport.update({ where: { id: r.id }, data: { needsReview: true, reviewReason: 'Imported sales were approved after this report was saved — refresh and finalize.', ...(r.status === 'FINALIZED' ? { status: 'DRAFT' } : {}) } })
      if (r.savedById) {
        await createNotification({ userId: r.savedById, type: 'DAILY_REPORT_REVIEW', title: 'Daily Report needs review', message: `Approved sales for ${dayKey(r.date)} changed the figures. Please review and finalize the Daily Report.`, entityType: 'DailyReport', entityId: r.id })
      }
    }
  } catch { /* notification/flagging is best-effort */ }

  return { ok: true, salesMetricRows: metricRows.length, lineCount: lines.length }
}
