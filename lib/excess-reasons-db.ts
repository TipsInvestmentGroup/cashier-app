// Server-only DB-backed layer for excess reasons — kept out of
// lib/excess-reasons.ts (imported by client components) since it needs
// prisma. Cached in-process like lib/company-config.ts: normal writes never
// re-query the table; the cache is refreshed after the TTL or invalidated
// immediately after an admin edit.
import { prisma } from '@/lib/prisma'
import { EXCESS_REASONS, UNASSIGNED_EXCESS_REASON } from '@/lib/excess-reasons'

const TTL_MS = 30_000
let cache: { codes: Set<string>; labels: Map<string, string>; at: number } | null = null

export async function seedExcessReasonsIfEmpty(): Promise<void> {
  if ((await prisma.excessReason.count()) > 0) return
  for (const d of EXCESS_REASONS) {
    await prisma.excessReason.upsert({ where: { code: d.value }, update: {}, create: { code: d.value, label: d.label } })
  }
}

export function invalidateExcessReasonCache() { cache = null }

async function loadCache() {
  await seedExcessReasonsIfEmpty()
  const rows = await prisma.excessReason.findMany()
  cache = {
    codes: new Set(rows.filter((r) => r.isActive).map((r) => r.code)),
    labels: new Map(rows.map((r) => [r.code, r.label])),
    at: Date.now(),
  }
  return cache
}

/** Whether a reason code is currently a valid, active, pickable option. */
export async function isValidExcessReasonCode(code: string): Promise<boolean> {
  if (!code || code === UNASSIGNED_EXCESS_REASON) return false
  const c = (cache && Date.now() - cache.at < TTL_MS) ? cache : await loadCache()
  return c.codes.has(code)
}

/** DB-aware label lookup — falls back to the raw code if not found (matches excessReasonLabel's fallback). */
export async function excessReasonLabelDb(code: string): Promise<string> {
  if (code === UNASSIGNED_EXCESS_REASON) return 'Needs reason'
  const c = (cache && Date.now() - cache.at < TTL_MS) ? cache : await loadCache()
  return c.labels.get(code) || code
}

/** Fetch the code→label map once, for synchronous lookups inside a report's map/flatMap over many rows. */
export async function getExcessReasonLabelMap(): Promise<Map<string, string>> {
  const c = (cache && Date.now() - cache.at < TTL_MS) ? cache : await loadCache()
  return c.labels
}
