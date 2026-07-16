import { prisma } from '@/lib/prisma'
import { DEFAULT_FLOOR_POSITIONS } from '@/lib/floor-positions'

// Cached in-process like lib/company-config.ts — normal reads never re-query
// the Setting table; the cache is invalidated immediately after an edit.
const SETTING_KEY = 'floorPositions'
const TTL_MS = 30_000

let cache: { value: string[]; at: number } | null = null

function normalize(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_FLOOR_POSITIONS]
  const cleaned = raw.map((v) => String(v).trim()).filter(Boolean)
  return cleaned.length ? cleaned : [...DEFAULT_FLOOR_POSITIONS]
}

export async function getFloorPositions(): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  const s = await prisma.setting.findUnique({ where: { key: SETTING_KEY } })
  let value = DEFAULT_FLOOR_POSITIONS
  if (s?.value) { try { value = normalize(JSON.parse(s.value)) } catch { /* keep defaults */ } }
  cache = { value, at: Date.now() }
  return value
}

export async function setFloorPositions(list: string[]): Promise<string[]> {
  const next = normalize(list)
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SETTING_KEY, value: JSON.stringify(next) },
  })
  cache = { value: next, at: Date.now() }
  return next
}
