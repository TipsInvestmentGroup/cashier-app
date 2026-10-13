import { Prisma, type PrismaClient } from '@prisma/client'
import { GUARDED, TENANT_ROOTS } from '@/lib/tenancy-registry'
import { TENANT_FKS } from '@/lib/tenancy-fks'
import { originalCompanyId, sessionCompany } from '@/lib/tenant-context'

/**
 * Tenant guard (Phase 4): inside a signed-in request, every query on a company-scoped model is confined to the
 * SESSION's company, and a write may not point at another company's records. Implemented once, in the shared
 * Prisma client, so it covers all ~370 routes, the libs they call, and anything added later - instead of trusting
 * each handler to remember a `where: { companyId }`.
 *
 *  READS / UPDATES / DELETES  (find*, count, aggregate, groupBy, update, updateMany, delete, deleteMany, upsert)
 *      the query's `where` is AND-ed with the company condition. A record that belongs to another company is simply
 *      "not found" - by id as much as in lists - so a guessed or manipulated id yields nothing.
 *  WRITES (create, createMany, update, upsert)
 *      every foreign key in the data that points at a company-scoped model (outlet, product, person, account, ...)
 *      must belong to the session's company (lib/tenancy-fks.ts is generated from schema.prisma), and the outlet of an
 *      outlet-owned row likewise. A violation throws TenantAccessError.
 *
 * Scope of "company-scoped": TENANT_ROOTS + NATIVE (lib/tenancy-registry.ts) by their `companyId` column, and `User`
 * by membership. Membership itself is exempt (a user's memberships span companies by design). Child tables are reached
 * through their parent. NULL-company rows count as the original company until the contract makes the column required.
 *
 * System context (no session company: scripts, seed, cron, public + pre-login routes) is NOT scoped - those code
 * paths are reviewed individually. `prismaSystem` (lib/prisma.ts) is the explicit unscoped client for identity code
 * that must look across companies (sign-in, company switching, the platform console). Emergency switch: TENANT_GUARD=off.
 */

export class TenantAccessError extends Error {
  readonly code = 'TENANT_FORBIDDEN'
  constructor(message = 'That record belongs to another company') {
    super(message)
    this.name = 'TenantAccessError'
  }
}

// operations whose `where` is narrowed
const WHERE_OPS = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy',
  'update', 'updateMany', 'delete', 'deleteMany', 'upsert',
])

const FK_TTL_MS = 60_000
const FK_MAX = 5_000

type Args = Record<string, unknown>

export function tenantGuardExtension(base: PrismaClient) {
  // (model:id) -> owning company (null = NULL company, undefined-not-found stored as 'missing')
  const fkCache = new Map<string, { company: string | null | 'missing'; at: number }>()

  async function ownerOf(model: string, id: string): Promise<string | null | 'missing'> {
    const key = `${model}:${id}`
    const now = Date.now()
    const hit = fkCache.get(key)
    if (hit && now - hit.at < FK_TTL_MS) return hit.company
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (base as any)[model.charAt(0).toLowerCase() + model.slice(1)].findUnique({ where: { id }, select: { companyId: true } })
    const company: string | null | 'missing' = row ? (row.companyId ?? null) : 'missing'
    if (fkCache.size >= FK_MAX) fkCache.clear()
    fkCache.set(key, { company, at: now })
    return company
  }

  const conditionFor = (model: string, ctx: string, original: string | null): Args | null => {
    if (model === 'User') {
      return ctx === original
        ? { OR: [{ memberships: { some: { companyId: ctx } } }, { memberships: { none: {} } }] }
        : { memberships: { some: { companyId: ctx } } }
    }
    if (!GUARDED.has(model)) return null
    return ctx === original ? { OR: [{ companyId: ctx }, { companyId: null }] } : { companyId: ctx }
  }

  /** May the session company reference a row owned by `owner`? */
  const allowed = (owner: string | null | 'missing', ctx: string, original: string | null) =>
    owner === 'missing' || owner === ctx || (owner === null && ctx === original)
  // ('missing' passes here: a dangling id is the database's foreign-key problem, not a tenancy one)

  async function checkForeignKeys(model: string, data: unknown, ctx: string, original: string | null) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return
    const d = data as Record<string, unknown>
    const fks = TENANT_FKS[model] ?? []
    const checks: Array<Promise<void>> = []
    const verify = (target: string, id: unknown) => {
      if (typeof id !== 'string' || !id) return
      checks.push(ownerOf(target, id).then((owner) => { if (!allowed(owner, ctx, original)) throw new TenantAccessError() }))
    }
    for (const fk of fks) {
      verify(fk.target, d[fk.field])
      const relInput = d[fk.rel] as { connect?: { id?: unknown } } | undefined
      if (relInput && typeof relInput === 'object') verify(fk.target, relInput.connect?.id)
    }
    // outlet-owned tables whose outletId is a plain column (no @relation), e.g. PettyCash, StockLedgerEntry
    if (TENANT_ROOTS[model] === 'outlet' && !fks.some((f) => f.field === 'outletId')) verify('Outlet', d.outletId)
    await Promise.all(checks)
  }

  async function guard(model: string, operation: string, args: Args, ctx: string, original: string | null) {
    if (WHERE_OPS.has(operation)) {
      const cond = conditionFor(model, ctx, original)
      if (cond) {
        const where = (args.where ?? {}) as Args
        args.where = { ...where, AND: [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), cond] }
      }
    }
    // writes must not point at another company's records
    if (operation === 'create' || operation === 'update' || operation === 'upsert') {
      if (operation === 'upsert') {
        await checkForeignKeys(model, args.create, ctx, original)
        await checkForeignKeys(model, args.update, ctx, original)
      } else {
        await checkForeignKeys(model, args.data, ctx, original)
      }
    } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
      const rows = Array.isArray(args.data) ? args.data : [args.data]
      for (const r of rows) await checkForeignKeys(model, r, ctx, original)
    } else if (operation === 'updateMany') {
      await checkForeignKeys(model, args.data, ctx, original)
    }
  }

  return Prisma.defineExtension({
    name: 'tenant-guard',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = await sessionCompany()
          if (!ctx) return query(args) // system context: not scoped
          const original = await originalCompanyId(base)
          await guard(model, operation, args as Args, ctx, original)
          return query(args)
        },
      },
    },
  })
}
