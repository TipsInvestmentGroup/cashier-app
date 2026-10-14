// Server-only DB-backed layer for Difference Reasons — kept out of
// lib/excess-reasons.ts (imported by client components) since it needs
// prisma. Cached in-process like lib/company-config.ts: normal reads never
// re-query the table; the cache is refreshed after the TTL or invalidated
// immediately after an admin edit.
import { prisma } from '@/lib/prisma'
import { DIFFERENCE_REASONS, UNASSIGNED_EXCESS_REASON, type DifferenceReasonCategory } from '@/lib/excess-reasons'
import { classForReason } from '@/lib/reconciliation-classification'
import { companyKey } from '@/lib/tenant'

const TTL_MS = 30_000
type ReasonCache = { codes: Set<string>; labels: Map<string, string>; categories: Map<string, DifferenceReasonCategory>; at: number }
// One cache per company: each company has its own reason rows (per-company unique code).
const caches = new Map<string, ReasonCache>()

async function currentCache(): Promise<ReasonCache> {
  const companyId = await companyKey()
  const hit = caches.get(companyId)
  return hit && Date.now() - hit.at < TTL_MS ? hit : loadCache(companyId)
}

export async function seedExcessReasonsIfEmpty(): Promise<void> {
  // Upsert every default reason: creates any missing ones (first run, or a
  // reason added by a later app version) without ever overwriting a label/
  // category an admin has already customized.
  const companyId = await companyKey()
  for (const d of DIFFERENCE_REASONS) {
    const accountingClass = classForReason(d.value, d.category)
    await prisma.excessReason.upsert({
      where: { companyId_code: { companyId, code: d.value } },
      // Only backfill accountingClass — never touch a label/category the admin
      // customized. accountingClass derives from the code, so re-stamping it is
      // safe and corrects any deployment where it's still null.
      update: { accountingClass },
      create: { code: d.value, label: d.label, category: d.category, accountingClass, companyId },
    })
  }
}


export function invalidateExcessReasonCache() { caches.clear() }

/** DB-aware accountingClass lookup for a reason code (RECEIVABLE | PAYABLE | ADJUSTMENT).
 *  Always resolved from the code via lib/reconciliation-classification so it is
 *  correct even if the stored class hasn't been backfilled yet. */
export async function excessReasonAccountingClass(code: string) {
  const c = await currentCache()
  return classForReason(code, c.categories.get(code))
}

async function loadCache(companyId: string): Promise<ReasonCache> {
  await seedExcessReasonsIfEmpty()
  const rows = await prisma.excessReason.findMany()
  const cache: ReasonCache = {
    codes: new Set(rows.filter((r) => r.isActive).map((r) => r.code)),
    labels: new Map(rows.map((r) => [r.code, r.label])),
    categories: new Map(rows.map((r) => [r.code, (r.category as DifferenceReasonCategory) || 'NON_PAYABLE'])),
    at: Date.now(),
  }
  caches.set(companyId, cache)
  return cache
}

/** Whether a reason code is currently a valid, active, pickable option. */
export async function isValidExcessReasonCode(code: string): Promise<boolean> {
  if (!code || code === UNASSIGNED_EXCESS_REASON) return false
  const c = await currentCache()
  return c.codes.has(code)
}

/** DB-aware label lookup — falls back to the raw code if not found (matches excessReasonLabel's fallback). */
export async function excessReasonLabelDb(code: string): Promise<string> {
  if (code === UNASSIGNED_EXCESS_REASON) return 'Needs reason'
  const c = await currentCache()
  return c.labels.get(code) || code
}

/** DB-aware category lookup — the ExcessReason row's current classification (PAYABLE_EXCESS | NON_PAYABLE | STAFF_LOSS). */
export async function excessReasonCategoryDb(code: string): Promise<DifferenceReasonCategory | null> {
  const c = await currentCache()
  return c.categories.get(code) || null
}

/** Fetch the code→label map once, for synchronous lookups inside a report's map/flatMap over many rows. */
export async function getExcessReasonLabelMap(): Promise<Map<string, string>> {
  const c = await currentCache()
  return c.labels
}
