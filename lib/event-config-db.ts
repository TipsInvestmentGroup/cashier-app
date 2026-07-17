import { prisma } from '@/lib/prisma'
import { DEFAULT_EVENT_CONFIG, normalizeEventConfig, type EventConfig } from '@/lib/event-config-shared'

export type { EventConfig }
export { DEFAULT_EVENT_CONFIG }

// Cached in-process like lib/company-config.ts.
const SETTING_KEY = 'eventConfig'
const TTL_MS = 30_000

let cache: { value: EventConfig; at: number } | null = null

export async function getEventConfig(): Promise<EventConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  const s = await prisma.setting.findUnique({ where: { key: SETTING_KEY } })
  let value = DEFAULT_EVENT_CONFIG
  if (s?.value) { try { value = normalizeEventConfig(JSON.parse(s.value)) } catch { /* keep defaults */ } }
  cache = { value, at: Date.now() }
  return value
}

export async function setEventConfig(patch: Partial<EventConfig>): Promise<EventConfig> {
  const s = await prisma.setting.findUnique({ where: { key: SETTING_KEY } })
  let current = DEFAULT_EVENT_CONFIG
  if (s?.value) { try { current = normalizeEventConfig(JSON.parse(s.value)) } catch { /* defaults */ } }
  const next = normalizeEventConfig({ ...current, ...patch })
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SETTING_KEY, value: JSON.stringify(next) },
  })
  cache = { value: next, at: Date.now() }
  return next
}
