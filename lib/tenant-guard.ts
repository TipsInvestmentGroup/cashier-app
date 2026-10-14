import { Prisma, type PrismaClient } from '@prisma/client'
import { GUARDED, SCOPED, TENANT_ROOTS } from '@/lib/tenancy-registry'
import { CHILD_SCOPE, COMPANY_EMPTY_DEFAULT, COMPANY_NULLABLE, TENANT_FKS } from '@/lib/tenancy-fks'
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
 * USERS are scoped by membership, and a top-level `role` / `outletId` / `isActive` condition on a user query is evaluated
 * against the user's MEMBERSHIP in the session company, not the legacy User columns (which only mirror their primary
 * company): "who are Beta's cashiers?" must use the role a person holds in Beta, even if they are a manager in Alpha.
 *
 * CHILD tables (no company column) that are queried DIRECTLY are scoped through their parent relation, recursively up to a
 * company-scoped ancestor (lib/tenancy-fks.ts CHILD_SCOPE): `cashReconExcess.findMany()` becomes "excess rows whose cash
 * recon belongs to the session company".
 *
 * Scope of "company-scoped": TENANT_ROOTS + NATIVE (lib/tenancy-registry.ts) by their `companyId` column, `User`
 * by membership, and the (scope, scopeId) configuration tables (SCOPED): a company READS the GLOBAL defaults plus the
 * COMPANY rows naming it and the OUTLET rows of its outlets, and may WRITE only its own COMPANY/OUTLET rows - GLOBAL/ROLE
 * rows are the original company's legacy defaults (read-only for any other company). Membership itself is exempt (a user's memberships span companies by design). Child tables are reached
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

const SCOPED_SET: ReadonlySet<string> = new Set(SCOPED)
const SCOPED_AUDIT: ReadonlySet<string> = new Set(['BusinessCalendarAuditLog'])
const WRITE_OPS = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert'])
const OUTLETS_TTL_MS = 30_000
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

  // outlet ids of a company (the original also owns outlets with no company yet)
  const outletsCache = new Map<string, { ids: string[]; at: number }>()
  async function companyOutletIds(ctx: string, original: string | null): Promise<string[]> {
    const now = Date.now()
    const hit = outletsCache.get(ctx)
    if (hit && now - hit.at < OUTLETS_TTL_MS) return hit.ids
    const rows = await base.outlet.findMany({ where: ctx === original ? { OR: [{ companyId: ctx }, { companyId: null }] } : { companyId: ctx }, select: { id: true } })
    const ids = rows.map((r) => r.id)
    outletsCache.set(ctx, { ids, at: now })
    return ids
  }

  /** where-fragment for a (scope, scopeId) table. `forWrite` drops the shared GLOBAL/ROLE rows for non-original companies. */
  async function scopedCondition(ctx: string, original: string | null, forWrite: boolean, model = ''): Promise<Args> {
    const outletIds = await companyOutletIds(ctx, original)
    const own: Args[] = [{ scope: 'COMPANY', scopeId: ctx }, { scope: 'OUTLET', scopeId: { in: outletIds } }]
    if (ctx === original) return { OR: [...own, { scope: { notIn: ['COMPANY', 'OUTLET'] } }] } // GLOBAL, ROLE, legacy
    // an audit trail's GLOBAL rows are the original company's history, not a shared default
    return { OR: forWrite || SCOPED_AUDIT.has(model) ? own : [{ scope: 'GLOBAL' }, ...own] }
  }

  /** A write to a (scope, scopeId) row may only target the session company / its outlets (or, for the original, shared rows). */
  async function checkScopedWrite(data: unknown, ctx: string, original: string | null) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return
    const d = data as Record<string, unknown>
    if (d.scope === undefined && d.scopeId === undefined) return
    const scope = d.scope as string | undefined
    if (scope === 'COMPANY') { if (d.scopeId !== ctx) throw new TenantAccessError() }
    else if (scope === 'OUTLET') { if (typeof d.scopeId !== 'string' || !(await companyOutletIds(ctx, original)).includes(d.scopeId)) throw new TenantAccessError() }
    else if (scope !== undefined && ctx !== original) throw new TenantAccessError('Shared defaults can only be changed by the platform')
  }

  /** Condition for a child model: its parent's condition, through the relation (parent may itself be a child). */
  function childCondition(model: string, ctx: string, original: string | null, depth = 0): Args | null {
    const link = CHILD_SCOPE[model]
    if (!link || depth > 6) return null
    const parentCond = conditionFor(link.parent, ctx, original) ?? childCondition(link.parent, ctx, original, depth + 1)
    return parentCond ? { [link.rel]: { is: parentCond } } : null
  }

  const conditionFor = (model: string, ctx: string, original: string | null): Args | null => {
    if (model === 'User') {
      return ctx === original
        ? { OR: [{ memberships: { some: { companyId: ctx } } }, { memberships: { none: {} } }] }
        : { memberships: { some: { companyId: ctx } } }
    }
    if (!GUARDED.has(model)) return null
    if (ctx !== original) return { companyId: ctx }
    // The original company also owns legacy rows with no company - but `companyId: null` is only a valid filter
    // where the column is optional (Prisma rejects it on a required column), and '' is the old "no company" default.
    if (COMPANY_NULLABLE.has(model)) return { OR: [{ companyId: ctx }, { companyId: null }] }
    if (COMPANY_EMPTY_DEFAULT.has(model)) return { OR: [{ companyId: ctx }, { companyId: '' }] }
    return { companyId: ctx }
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

  /** Users: confine to the session company's members, mapping role/outletId/isActive onto the membership. */
  function narrowUsers(args: Args, ctx: string, original: string | null) {
    const where = { ...((args.where ?? {}) as Args) }
    const member: Args = { companyId: ctx }
    const legacy: Args = {}
    for (const k of ['role', 'outletId', 'isActive'] as const) {
      if (where[k] !== undefined) { member[k] = where[k]; legacy[k] = where[k]; delete where[k] }
    }
    // the original company also owns users with no membership yet (not backfilled): their legacy columns apply
    const cond: Args = ctx === original
      ? { OR: [{ memberships: { some: member } }, { memberships: { none: {} }, ...legacy }] }
      : { memberships: { some: member } }
    args.where = { ...where, AND: [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), cond] }
  }

  async function guard(model: string, operation: string, args: Args, ctx: string, original: string | null) {
    if (model === 'User' && WHERE_OPS.has(operation)) {
      narrowUsers(args, ctx, original)
    } else if (WHERE_OPS.has(operation)) {
      const cond = SCOPED_SET.has(model)
        ? await scopedCondition(ctx, original, WRITE_OPS.has(operation), model)
        : (conditionFor(model, ctx, original) ?? childCondition(model, ctx, original))
      if (cond) {
        const where = (args.where ?? {}) as Args
        args.where = { ...where, AND: [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), cond] }
      }
    }
    if (SCOPED_SET.has(model)) {
      if (operation === 'upsert') { await checkScopedWrite(args.create, ctx, original); await checkScopedWrite(args.update, ctx, original) }
      else if (operation === 'create' || operation === 'update' || operation === 'updateMany') await checkScopedWrite(args.data, ctx, original)
      else if (operation === 'createMany' || operation === 'createManyAndReturn') {
        for (const r of Array.isArray(args.data) ? args.data : [args.data]) await checkScopedWrite(r, ctx, original)
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
