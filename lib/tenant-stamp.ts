import { Prisma, type PrismaClient } from '@prisma/client'
import { TENANT_ROOTS } from '@/lib/tenancy-registry'
import { sessionCompany, TENANT_HEADER } from '@/lib/tenant-context'

// re-exported for existing importers
export { TENANT_HEADER }

/**
 * Write-path guard (Phase 3): every row created in a tenant-root table is stamped with its owning company.
 *
 * Without it, new rows would keep arriving with a NULL company after the backfill, and the later NOT NULL step
 * could never be applied. It runs inside the shared Prisma client (lib/prisma.ts), so ALL ~370 routes, the cron
 * jobs and the libs are covered without editing any of them.
 *
 * Company is resolved, in order:
 *   1. an explicit `companyId` already in the data (never overridden);
 *   2. for outlet-owned tables, the company of the row's `outletId`  (the row can then never disagree with its outlet);
 *   3. the SESSION's company, passed by proxy.ts in the `x-tenant-company` request header. proxy.ts deletes any
 *      client-supplied copy of that header on every /api request and sets it only from a verified token, so it is
 *      trustworthy. Outside a request (scripts, seed) there is no header and this step simply yields nothing.
 * If none applies the row is left NULL and the nightly/deploy backfill assigns it; the census script reports any
 * stragglers. This is *stamping*, not enforcement: reads are not filtered here (Phase 4).
 */

const OUTLET_TTL_MS = 60_000
const MAX_CACHE = 2_000

export function tenantStampExtension(base: PrismaClient) {
  const outletCache = new Map<string, { company: string | null; at: number }>()

  async function outletCompany(outletId: string): Promise<string | null> {
    const now = Date.now()
    const hit = outletCache.get(outletId)
    if (hit && now - hit.at < OUTLET_TTL_MS) return hit.company
    const o = await base.outlet.findUnique({ where: { id: outletId }, select: { companyId: true } })
    if (outletCache.size >= MAX_CACHE) outletCache.clear()
    outletCache.set(outletId, { company: o?.companyId ?? null, at: now })
    return o?.companyId ?? null
  }

  async function companyFor(model: string, data: Record<string, unknown>): Promise<string | null> {
    if (TENANT_ROOTS[model] === 'outlet' && typeof data.outletId === 'string' && data.outletId) {
      const c = await outletCompany(data.outletId)
      if (c) return c
    }
    return sessionCompany()
  }

  async function stamp(model: string, data: unknown): Promise<unknown> {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data
    const d = data as Record<string, unknown>
    if (d.companyId !== undefined) return data
    const c = await companyFor(model, d)
    return c ? { ...d, companyId: c } : data
  }

  return Prisma.defineExtension({
    name: 'tenant-stamp',
    query: {
      $allModels: {
        async create({ model, args, query }) {
          if (model in TENANT_ROOTS) args.data = (await stamp(model, args.data)) as typeof args.data
          return query(args)
        },
        async createMany({ model, args, query }) {
          if (model in TENANT_ROOTS) {
            const rows = Array.isArray(args.data) ? args.data : [args.data]
            const stamped = await Promise.all(rows.map((r) => stamp(model, r)))
            args.data = (Array.isArray(args.data) ? stamped : stamped[0]) as typeof args.data
          }
          return query(args)
        },
        async createManyAndReturn({ model, args, query }) {
          if (model in TENANT_ROOTS) {
            const rows = Array.isArray(args.data) ? args.data : [args.data]
            const stamped = await Promise.all(rows.map((r) => stamp(model, r)))
            args.data = (Array.isArray(args.data) ? stamped : stamped[0]) as typeof args.data
          }
          return query(args)
        },
        async upsert({ model, args, query }) {
          if (model in TENANT_ROOTS) args.create = (await stamp(model, args.create)) as typeof args.create
          return query(args)
        },
      },
    },
  })
}
