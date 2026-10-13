import { AsyncLocalStorage } from 'node:async_hooks'
import type { PrismaClient } from '@prisma/client'

/**
 * Who is this request for? Shared by the Prisma write-stamp (lib/tenant-stamp.ts) and read/write guard
 * (lib/tenant-guard.ts).
 *
 * The session company arrives in the `x-tenant-company` request header. proxy.ts deletes any client-supplied copy
 * of it on EVERY /api request and sets it only from a verified session token, so inside a request it can be trusted.
 * Outside a request (scripts, the deploy seed, cron without a user) there is no header: that is a "system context"
 * and the guard does not scope it.
 */
export const TENANT_HEADER = 'x-tenant-company'

const runAs = new AsyncLocalStorage<{ companyId: string }>()

/**
 * Run `fn` AS a company: inside it the Prisma tenant guard scopes every query to `companyId`, exactly as for a signed-in
 * session of that company - without a request. For jobs that serve one company at a time (a cron looping over
 * companies, an ops script acting for one company). It never widens access: it can only narrow to the company named.
 */
export function runAsCompany<T>(companyId: string, fn: () => PromiseLike<T> | T): Promise<T> {
  // `await` INSIDE the context: Prisma queries are lazy (they only start when awaited), so returning an un-awaited
  // query from `fn` would otherwise begin executing outside the company context and silently run unscoped.
  return runAs.run({ companyId }, async () => await fn())
}

export async function sessionCompany(): Promise<string | null> {
  const explicit = runAs.getStore()
  if (explicit) return explicit.companyId
  try {
    const { headers } = await import('next/headers')
    return (await headers()).get(TENANT_HEADER) || null
  } catch {
    return null // not inside a request
  }
}

const ORIGINAL_TTL_MS = 60_000
let originalCache: { id: string | null; at: number } | null = null

/**
 * The ORIGINAL (oldest) company. Until the Phase-3 contract makes every company column required, a row with a
 * NULL company is treated as belonging to it - exactly what the legacy single-company code did - so a straggler
 * can never "disappear" from the original company's screens. Cached briefly.
 */
export async function originalCompanyId(base: PrismaClient): Promise<string | null> {
  const now = Date.now()
  if (originalCache && now - originalCache.at < ORIGINAL_TTL_MS) return originalCache.id
  const c = await base.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
  originalCache = { id: c?.id ?? null, at: now }
  return originalCache.id
}
