import { prisma } from '@/lib/prisma'
import { DEFAULT_SCHEDULE_CONFIG, normalizeScheduleConfig, type ScheduleConfig } from '@/lib/schedule-config-shared'

export type { ScheduleConfig }
export { DEFAULT_SCHEDULE_CONFIG }

// Cached in-process like lib/company-config.ts.
const SETTING_KEY = 'scheduleConfig'
const TTL_MS = 30_000

let cache: { value: ScheduleConfig; at: number } | null = null

export async function getScheduleConfig(): Promise<ScheduleConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  const s = await prisma.setting.findUnique({ where: { key: SETTING_KEY } })
  let value = DEFAULT_SCHEDULE_CONFIG
  if (s?.value) { try { value = normalizeScheduleConfig(JSON.parse(s.value)) } catch { /* keep defaults */ } }
  cache = { value, at: Date.now() }
  return value
}

export async function setScheduleConfig(patch: Partial<ScheduleConfig>): Promise<ScheduleConfig> {
  const s = await prisma.setting.findUnique({ where: { key: SETTING_KEY } })
  let current = DEFAULT_SCHEDULE_CONFIG
  if (s?.value) { try { current = normalizeScheduleConfig(JSON.parse(s.value)) } catch { /* defaults */ } }
  const next = normalizeScheduleConfig({ ...current, ...patch })
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SETTING_KEY, value: JSON.stringify(next) },
  })
  cache = { value: next, at: Date.now() }
  return next
}
