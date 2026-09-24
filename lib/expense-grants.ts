// §4's Manage Access layer — the single source of truth for who may submit an
// expense request, custody a fund, approve at a given stage, or execute an
// allocation. Everything downstream reads from here rather than guessing from
// User.role:
//   • who appears in the Expense Form's "Requested By" dropdown
//   • who can be assigned as a custodian of a fund
//   • who a request is routed to at the first/second approval stage
//   • authorization on custodian-only actions (own ledger, pay from own fund)
//
// This replaces the role-broadcast in lib/expense-workflow.ts
// (notifyUsersByRole → every user holding a User.role string), which §7
// explicitly forbids: an "action needed" notification must reach the specific
// individual(s) holding the grant for the relevant outlet and fund.
//
// Relationship to FundingSourceCustodian — these are NOT two records of the
// same fact, and the distinction matters:
//   • ExpenseAccessGrant(CUSTODIAN, fundClass) = ELIGIBILITY. "This person may
//     hold a Petty Cash fund at Mikocheni." §4's wording is precisely "who CAN
//     be assigned as a custodian for each fund".
//   • FundingSourceCustodian(fundingSourceId, userId) = the ASSIGNMENT. "This
//     person holds THIS specific fund row."
// One fund class can have several FundingSource rows (two outlets, or a float
// per site), so eligibility cannot substitute for the assignment, and the
// assignment cannot express "eligible but not currently holding anything".
//
// NOT YET ENFORCED: assignFundingSourceCustodian() in lib/expense-access.ts
// still accepts any user, so an assignment without the matching grant is
// currently possible. Wiring that check in requires first seeding grants for
// the custodians already assigned today — otherwise the existing Funding
// Sources admin screen would start rejecting people who legitimately hold a
// fund. That seeding + enforcement is Phase 3 (custodian setup), deliberately
// not slipped in here where it would break a working screen.
//
// See docs/expense-module-upgrade-brief.md §4 and prisma/schema.prisma
// (ExpenseAccessGrant).
import { prisma } from '@/lib/prisma'
import type { Db } from '@/lib/ledger'
import { FUND_CLASSES, fundClassOf, isFundClass, type FundClass } from '@/lib/expense-funds'
import { EXPENSE_GRANT_TYPES, EXPENSE_GRANT_FLAGS, EXPENSE_RESERVED_GRANT_TYPES } from '@/lib/shared-constants'

// The grant vocabulary itself lives in lib/shared-constants.ts (dependency-free)
// so the Manage Access UI can import it without pulling prisma into the client
// bundle. Re-exported here under the names server code uses, so this module
// stays the one import for anything grant-related on the server.
export const GRANT_TYPES = EXPENSE_GRANT_TYPES
export type GrantType = (typeof EXPENSE_GRANT_TYPES)[number]
export const GRANT_FLAGS = EXPENSE_GRANT_FLAGS
export const RESERVED_GRANT_TYPES = EXPENSE_RESERVED_GRANT_TYPES

export function isGrantType(value: string | null | undefined): value is GrantType {
  return !!value && (GRANT_TYPES as readonly string[]).includes(value)
}

/** A CUSTODIAN grant must name the fund it covers; REQUEST is fund-agnostic.
 *  Approver grants may name a fund (per-fund chains) or leave it null to
 *  approve for every fund. Returns an error message, or null when valid. */
export function validateGrantShape(grantType: GrantType, fundClass: string | null): string | null {
  if (grantType === 'CUSTODIAN') {
    if (!fundClass) return 'A custodian grant must specify which fund it covers'
    if (!isFundClass(fundClass)) return `Unknown fund: ${fundClass}`
    return null
  }
  if (grantType === 'REQUEST' && fundClass) {
    return 'Requesting access is not fund-specific'
  }
  if (fundClass && !isFundClass(fundClass)) return `Unknown fund: ${fundClass}`
  return null
}

export interface GrantInput {
  companyId: string
  userId: string
  grantType: GrantType
  fundClass?: string | null
  /** null = business-wide (both outlets). */
  outletId?: string | null
  grantedById: string
  grantedByName?: string | null
  note?: string | null
}

/**
 * Issues a grant. Enforces "one LIVE grant per (user, type, fund class,
 * outlet)" here rather than relying on the @@unique index — fundClass,
 * outletId and revokedAt are all nullable, and both SQLite and Postgres treat
 * NULLs as distinct in a unique index, so the most common case (a live,
 * business-wide grant) would not be rejected by the database at all.
 *
 * Re-granting something previously revoked is allowed and creates a NEW row:
 * the revoked one stays for the audit trail (§4: revoke, never hard-delete).
 */
export async function grantAccess(input: GrantInput) {
  const fundClass = input.fundClass || null
  const outletId = input.outletId || null

  const shapeError = validateGrantShape(input.grantType, fundClass)
  if (shapeError) throw new Error(shapeError)

  const existing = await prisma.expenseAccessGrant.findFirst({
    where: {
      companyId: input.companyId,
      userId: input.userId,
      grantType: input.grantType,
      fundClass,
      outletId,
      revokedAt: null,
    },
  })
  if (existing) return existing // idempotent — granting twice is not an error

  return prisma.expenseAccessGrant.create({
    data: {
      companyId: input.companyId,
      userId: input.userId,
      grantType: input.grantType,
      fundClass,
      outletId,
      grantedById: input.grantedById,
      grantedByName: input.grantedByName || null,
      note: input.note || null,
    },
  })
}

/** Revokes a grant (never deletes it). Idempotent: revoking an already-revoked
 *  grant leaves the original revokedAt/revokedById intact, so the audit trail
 *  records when access was actually withdrawn, not when someone last clicked. */
export async function revokeGrant(id: string, revokedById: string) {
  const grant = await prisma.expenseAccessGrant.findUnique({ where: { id } })
  if (!grant) throw new Error('Access grant not found')
  if (grant.revokedAt) return grant
  return prisma.expenseAccessGrant.update({
    where: { id },
    data: { revokedAt: new Date(), revokedById },
  })
}

export interface GrantScope {
  /** Fund the action concerns. A grant with fundClass=null covers every fund. */
  fundClass?: FundClass | null
  /** Outlet the action concerns. A grant with outletId=null covers every outlet. */
  outletId?: string | null
}

/**
 * The `where` fragment matching grants that APPLY to a scope, honouring
 * null-as-wildcard in the stored row: a grant scoped to no outlet is
 * business-wide and therefore applies to every outlet, and a grant scoped to no
 * fund applies to every fund. Note the asymmetry — null in the *stored grant*
 * means "all", while null in the *query scope* means "don't filter on this".
 */
function scopeWhere(scope: GrantScope) {
  const where: Record<string, unknown> = { revokedAt: null }
  if (scope.fundClass) where.OR = [{ fundClass: scope.fundClass }, { fundClass: null }]
  if (scope.outletId) {
    const outletOr = [{ outletId: scope.outletId }, { outletId: null }]
    // Two independent OR groups cannot both live on `OR` — combine with AND so
    // a fund-scoped AND outlet-scoped query doesn't silently drop one of them.
    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: outletOr }]
      delete where.OR
    } else {
      where.OR = outletOr
    }
  }
  return where
}

/** Does this user hold this grant for the given fund/outlet? The authorization
 *  primitive for custodian-only actions and approval-stage gating. */
export async function hasGrant(userId: string, grantType: GrantType, scope: GrantScope = {}): Promise<boolean> {
  const row = await prisma.expenseAccessGrant.findFirst({
    where: { userId, grantType, ...scopeWhere(scope) },
    select: { id: true },
  })
  return !!row
}

/**
 * Every ACTIVE user holding `grantType` for the given fund/outlet — the routing
 * primitive §7 requires. Used for "action needed" notifications (the specific
 * individuals, not a role-wide broadcast), the "Requested By" dropdown, and the
 * list of people assignable as a custodian.
 */
export async function usersWithGrant(
  grantType: GrantType,
  scope: GrantScope = {},
  db: Db = prisma,
): Promise<{ id: string; name: string; email: string | null; role: string }[]> {
  const grants = await db.expenseAccessGrant.findMany({
    where: { grantType, ...scopeWhere(scope) },
    select: { userId: true },
  })
  const userIds = [...new Set(grants.map((g) => g.userId))]
  if (!userIds.length) return []
  // isActive filters out a grant left standing on a deactivated account — the
  // grant is deliberately not auto-revoked (that would lose the audit trail),
  // so the liveness test belongs here at read time.
  return db.user.findMany({
    where: { id: { in: userIds }, isActive: true },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  })
}

export interface GrantRow {
  id: string
  userId: string
  grantType: string
  fundClass: string | null
  outletId: string | null
  grantedById: string
  grantedByName: string | null
  grantedAt: Date
  revokedAt: Date | null
  revokedById: string | null
  note: string | null
  user: { id: string; name: string; email: string; role: string } | null
  outlet: { id: string; name: string } | null
}

/**
 * The Manage Access table. Returns live grants by default; `includeRevoked`
 * surfaces the full audit trail. Users and outlets are resolved in two batch
 * queries rather than a join because ExpenseAccessGrant.userId is a loose ref
 * (the same convention as CreditAccount.userId / FundingSourceCustodian.userId,
 * which keeps User free of a back-relation per module).
 */
export async function listGrants(
  companyId: string,
  opts: { includeRevoked?: boolean; userId?: string } = {},
): Promise<GrantRow[]> {
  const grants = await prisma.expenseAccessGrant.findMany({
    where: {
      companyId,
      ...(opts.includeRevoked ? {} : { revokedAt: null }),
      ...(opts.userId ? { userId: opts.userId } : {}),
    },
    orderBy: [{ revokedAt: 'asc' }, { grantedAt: 'desc' }],
  })
  if (!grants.length) return []

  const userIds = [...new Set(grants.map((g) => g.userId))]
  const outletIds = [...new Set(grants.map((g) => g.outletId).filter((id): id is string => !!id))]
  const [users, outlets] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true, role: true } }),
    outletIds.length
      ? prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ])

  return grants.map((g) => ({
    ...g,
    user: users.find((u) => u.id === g.userId) || null,
    outlet: g.outletId ? outlets.find((o) => o.id === g.outletId) || null : null,
  }))
}

/**
 * Approvers for one stage of one fund's chain, in the order the chain runs.
 * Returns the FIRST_APPROVER holders for stage 1 and SECOND_APPROVER holders
 * for stage 2 — the per-fund chain the 2026-08-05 decision calls for falls out
 * of which grants exist for that fundClass, with no chain stored anywhere.
 */
export async function approversForStage(stage: 1 | 2, scope: GrantScope) {
  return usersWithGrant(stage === 1 ? 'FIRST_APPROVER' : 'SECOND_APPROVER', scope)
}

/** Who is available to approve for a fund, per model:
 *   • single — a Single Approver, whose lone approval finalizes the request;
 *   • first / second — the two-stage chain.
 *  Used to (a) drop unstaffed stages from the plan and (b) surface at submit
 *  time the case where a request needs approval but has nobody to route to,
 *  which would otherwise leave it silently stuck with no pending approver.
 *  resolveApprovalPlan gives `single` precedence — see there. */
export async function chainIsStaffed(scope: GrantScope): Promise<{ single: boolean; first: boolean; second: boolean }> {
  const [single, first, second] = await Promise.all([
    usersWithGrant('SINGLE_APPROVER', scope),
    approversForStage(1, scope),
    approversForStage(2, scope),
  ])
  return { single: single.length > 0, first: first.length > 0, second: second.length > 0 }
}

/**
 * Backfills a CUSTODIAN eligibility grant for everyone already assigned to a
 * fund today — every FundingSourceCustodian row plus each fund's legacy single
 * responsibleUserId. This must run BEFORE eligibility is enforced on assignment
 * (lib/expense-access.ts assignFundingSourceCustodian), otherwise the existing
 * Funding Sources admin screen would start rejecting people who legitimately
 * hold a fund.
 *
 * Idempotent — grantAccess() is a no-op when a live grant already exists, so
 * re-running never duplicates and never clobbers a grant an admin has since
 * scoped differently. Funds whose sourceType maps to no fund class (OTHER) are
 * skipped: there is no fund class to be a custodian OF, and inventing one would
 * put money under a custodian who never agreed to hold it.
 *
 * Returns what it did, so a script or seed can report it rather than claiming
 * success blindly.
 */
export async function backfillCustodianGrants(grantedById = 'system-backfill'): Promise<{
  granted: number
  skippedNoFundClass: number
  skippedInactiveUser: number
}> {
  const sources = await prisma.fundingSource.findMany({
    where: { isActive: true },
    select: { id: true, companyId: true, name: true, sourceType: true, outletId: true, responsibleUserId: true },
  })

  let granted = 0
  let skippedNoFundClass = 0
  let skippedInactiveUser = 0

  for (const source of sources) {
    const fundClass = fundClassOf(source.sourceType)
    if (!fundClass) {
      skippedNoFundClass++
      continue
    }

    const assignments = await prisma.fundingSourceCustodian.findMany({
      where: { fundingSourceId: source.id },
      select: { userId: true },
    })
    const userIds = [...new Set([
      ...assignments.map((a) => a.userId),
      ...(source.responsibleUserId ? [source.responsibleUserId] : []),
    ])]
    if (!userIds.length) continue

    // A grant on a deactivated account would be dead weight that usersWithGrant
    // filters out at read time anyway — don't create it.
    const activeUsers = await prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true },
      select: { id: true },
    })
    skippedInactiveUser += userIds.length - activeUsers.length

    for (const user of activeUsers) {
      const before = await prisma.expenseAccessGrant.count({
        where: { companyId: source.companyId, userId: user.id, grantType: 'CUSTODIAN', fundClass, outletId: source.outletId, revokedAt: null },
      })
      await grantAccess({
        companyId: source.companyId,
        userId: user.id,
        grantType: 'CUSTODIAN',
        fundClass,
        outletId: source.outletId,
        grantedById,
        grantedByName: 'Backfill from existing fund assignments',
        note: `Backfilled from assignment on "${source.name}"`,
      })
      if (before === 0) granted++
    }
  }

  return { granted, skippedNoFundClass, skippedInactiveUser }
}

/**
 * Whether the "Requesting Access" gate is live for a company — i.e. whether any
 * REQUEST grant has been issued at all.
 *
 * Zero REQUEST grants means an admin has not configured requesting access yet,
 * so submitting stays open to any authenticated user exactly as it was before
 * §4 existed. This is the same "zero config rows ⇒ today's behavior unchanged"
 * convention ExpenseModuleConfig/CollectionModeConfig already follow, and it is
 * what makes this enforceable without a backfill: the moment an admin grants
 * requesting access to one person, the gate closes for everyone else.
 *
 * The trade-off is deliberate and worth knowing: granting REQUEST to exactly one
 * user silently revokes it from everyone else. The Manage Access screen says so.
 */
export async function requestGateActive(companyId: string): Promise<boolean> {
  const count = await prisma.expenseAccessGrant.count({
    where: { companyId, grantType: 'REQUEST', revokedAt: null },
  })
  return count > 0
}

/** Fund classes a user custodians, for the given outlet — drives which ledger
 *  screens and Ready-to-Pay queues they see. */
export async function custodianFundClasses(userId: string, outletId?: string | null): Promise<FundClass[]> {
  const grants = await prisma.expenseAccessGrant.findMany({
    where: { userId, grantType: 'CUSTODIAN', ...scopeWhere({ outletId }) },
    select: { fundClass: true },
  })
  const held = new Set(grants.map((g) => g.fundClass).filter((c): c is string => !!c))
  return FUND_CLASSES.filter((c) => held.has(c))
}
