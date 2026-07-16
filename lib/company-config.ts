import { prisma } from '@/lib/prisma'
import { CompanyConfig, DEFAULT_COMPANY_CONFIG, normalizeCompanyConfig } from '@/lib/company-config-shared'

export type { CompanyConfig }
export { DEFAULT_COMPANY_CONFIG }

/**
 * Server-side company preferences (currency, VAT rate, branding), stored as
 * one JSON blob in the Setting table under this key. Reads are served from an
 * in-process cache so normal operations never re-query the config table —
 * the cache is refreshed after the TTL or invalidated immediately on write.
 * (On serverless, each instance has its own cache; the TTL bounds staleness.)
 */
const SETTING_KEY = 'companyConfig'
const TTL_MS = 30_000

let cache: { value: CompanyConfig; at: number } | null = null

export async function getCompanyConfig(): Promise<CompanyConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  const s = await prisma.setting.findUnique({ where: { key: SETTING_KEY } })
  let value = DEFAULT_COMPANY_CONFIG
  if (s?.value) {
    try { value = normalizeCompanyConfig(JSON.parse(s.value)) } catch { /* keep defaults */ }
  }
  cache = { value, at: Date.now() }
  return value
}

export async function updateCompanyConfig(patch: Partial<CompanyConfig>): Promise<CompanyConfig> {
  const s = await prisma.setting.findUnique({ where: { key: SETTING_KEY } })
  let current = DEFAULT_COMPANY_CONFIG
  if (s?.value) { try { current = normalizeCompanyConfig(JSON.parse(s.value)) } catch { /* defaults */ } }
  const next = normalizeCompanyConfig({ ...current, ...patch })
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SETTING_KEY, value: JSON.stringify(next) },
  })
  cache = { value: next, at: Date.now() }
  return next
}
