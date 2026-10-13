import type { NextRequest } from 'next/server'
import { prismaSystem as prisma } from '@/lib/prisma'
import { getAuthUser, signToken, type JWTPayload } from '@/lib/auth'
import { isOwnerEmail } from '@/lib/owner'

/**
 * Multi-company tenancy layer (Phase 2).
 *
 * The model, in one paragraph: a *User* is a login identity; a *Membership* binds that identity to ONE
 * *Company* with the role / outlet / position they hold there; a session token is bound to exactly one
 * membership (the "active company", `JWTPayload.companyId`). Everything company-scoped must derive its
 * company from the session — never from a client-supplied id.
 *
 * Until every existing row is backfilled (Phase 3) the app still has to behave exactly as it did with a
 * single company, so a user with no membership yet gets one created lazily (`ensureMemberships`) in their
 * "home" company: their outlet's company, else the oldest company (today's single-company reality).
 */

// Structural subset of the Prisma client (or a $transaction client) this module needs.
export type TenantDb = Pick<typeof prisma, 'user' | 'company' | 'outlet' | 'membership'>

export const COMPANY_STATUS = { ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED', ARCHIVED: 'ARCHIVED' } as const

/** lower-case a-z0-9 and single hyphens; used for the sign-in "company code". */
export function slugify(name: string): string {
  const s = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s.slice(0, 40) || 'company'
}
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

/** The oldest company — the single-company bridge. Kept ONLY for first-membership creation and legacy
 *  paths; request handlers must use the session's company instead. */
async function oldestCompanyId(db: TenantDb): Promise<string | null> {
  const c = await db.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
  return c?.id ?? null
}

export interface CompanyRef { id: string; name: string; slug: string | null; status: string }
export interface MembershipView {
  companyId: string
  company: CompanyRef
  role: string
  outletId: string | null
  position: string | null
  isOwner: boolean
  isActive: boolean
}

const MEMBERSHIP_SELECT = {
  companyId: true, role: true, outletId: true, position: true, isOwner: true, isActive: true, createdAt: true,
  company: { select: { id: true, name: true, slug: true, status: true } },
} as const

/** Where a user with no membership belongs: their outlet's company, else the oldest company. */
export async function homeCompanyIdFor(db: TenantDb, outletId: string | null | undefined): Promise<string | null> {
  if (outletId) {
    const o = await db.outlet.findUnique({ where: { id: outletId }, select: { companyId: true } })
    if (o?.companyId) return o.companyId
  }
  return oldestCompanyId(db)
}

/**
 * All of a user's memberships (oldest first). If the user has none, creates the one implied by the legacy
 * User.role / outletId / position columns, in their home company. Idempotent and race-safe (unique
 * [userId, companyId]; a concurrent create just re-reads).
 */
export async function ensureMemberships(
  db: TenantDb,
  user: { id: string; email: string; role: string; outletId: string | null; position: string | null; isActive: boolean },
): Promise<MembershipView[]> {
  const read = () => db.membership.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' }, select: MEMBERSHIP_SELECT })
  let rows = await read()
  if (rows.length === 0) {
    const companyId = await homeCompanyIdFor(db, user.outletId)
    if (companyId) {
      try {
        await db.membership.create({
          data: {
            userId: user.id, companyId, role: user.role, outletId: user.outletId, position: user.position,
            isOwner: isOwnerEmail(user.email), isActive: user.isActive,
          },
        })
      } catch { /* unique race: another request created it — fall through to re-read */ }
      rows = await read()
    }
  }
  return rows.map(({ createdAt: _c, ...m }) => ({ ...m }))
}

/** Memberships that can currently sign in: membership active AND company ACTIVE. */
export function usableMemberships(all: MembershipView[]): MembershipView[] {
  return all.filter((m) => m.isActive && m.company.status === COMPANY_STATUS.ACTIVE)
}

/** Pick a membership by company id or slug (case-insensitive slug). */
export function pickMembership(all: MembershipView[], companyRef: string | null | undefined): MembershipView | null {
  if (!companyRef) return null
  const ref = String(companyRef).trim().toLowerCase()
  return all.find((m) => m.companyId.toLowerCase() === ref || (m.company.slug || '').toLowerCase() === ref) ?? null
}

export interface SessionUserShape { id: string; name: string; email: string; sessionEpoch: number }

/** Mint a session token bound to `membership`, plus the user object the client stores. */
export function issueSession(
  user: SessionUserShape,
  m: MembershipView,
  outlet: { id: string; name: string } | null,
) {
  const token = signToken({
    userId: user.id, email: user.email, role: m.role, outletId: m.outletId || undefined,
    name: user.name, position: m.position || undefined, sepoch: user.sessionEpoch,
    companyId: m.companyId, owner: m.isOwner,
  })
  return {
    token,
    user: {
      id: user.id, name: user.name, email: user.email, role: m.role, position: m.position, outlet,
      company: { id: m.company.id, name: m.company.name, slug: m.company.slug },
      isOwner: m.isOwner,
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Request-time tenant resolution
// ---------------------------------------------------------------------------------------------

export type TenantUser = JWTPayload & { companyId: string }

/**
 * The caller's identity bound to their company, or null when unauthenticated / not a member of any
 * usable company. The company comes from the SIGNED token (revocation of the membership/company is
 * enforced for every /api request by proxy.ts). A legacy token minted before multi-company shipped has no
 * company claim: it is resolved once from the database to the user's primary usable membership.
 */
export async function requireTenant(req: NextRequest): Promise<TenantUser | null> {
  const t = getAuthUser(req)
  if (!t) return null
  if (t.companyId) return t as TenantUser
  const u = await prisma.user.findUnique({
    where: { id: t.userId },
    select: { id: true, email: true, role: true, outletId: true, position: true, isActive: true },
  })
  if (!u || !u.isActive) return null
  const m = usableMemberships(await ensureMemberships(prisma, u))[0]
  return m ? { ...t, companyId: m.companyId, role: m.role, outletId: m.outletId ?? undefined, owner: m.isOwner } : null
}

/**
 * The company a request is allowed to operate on. Replaces `searchParams.get('companyId') ||
 * resolveDefaultCompanyId()`: the company is the SESSION's company; a client may still pass `requested`
 * (older screens do) but it is only honoured when it names that same company. Anything else returns null,
 * which callers already treat as "no company" — so a manipulated id yields an empty/404 response instead
 * of another company's data.
 */
export async function tenantCompanyId(user: JWTPayload, requested?: string | null): Promise<string | null> {
  let own = user.companyId ?? null
  if (!own) {
    const u = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { id: true, email: true, role: true, outletId: true, position: true, isActive: true },
    })
    if (u?.isActive) own = usableMemberships(await ensureMemberships(prisma, u))[0]?.companyId ?? null
  }
  if (!own) return null
  if (requested && requested !== own) return null
  return own
}

/**
 * Prisma `where` fragment: users who belong to `companyId`. Until the membership backfill has run, a user
 * with NO membership at all is treated as belonging to the oldest (original) company - exactly the
 * single-company behaviour - so a deploy never makes people vanish from lists between "schema applied"
 * and "backfill ran". Once every user has a membership the second clause matches nothing.
 */
export async function memberOfCompanyWhere(db: TenantDb, companyId: string) {
  const oldest = await oldestCompanyId(db)
  return oldest === companyId
    ? { OR: [{ memberships: { some: { companyId } } }, { memberships: { none: {} } }] }
    : { memberships: { some: { companyId } } }
}

/** Does `outletId` belong to `companyId`? (null/undefined outlet = true: "no outlet" is company-wide.) */
export async function outletInCompany(db: TenantDb, outletId: string | null | undefined, companyId: string): Promise<boolean> {
  if (!outletId) return true
  const o = await db.outlet.findUnique({ where: { id: outletId }, select: { companyId: true } })
  return !!o && o.companyId === companyId
}

// ---------------------------------------------------------------------------------------------
// Keeping Membership and the legacy User columns in step (user-management + seeds)
// ---------------------------------------------------------------------------------------------

/**
 * Create or update the user's membership of `companyId`, and — when it is the user's primary (oldest)
 * membership — mirror role / outlet / position onto the legacy User columns, which a great deal of
 * existing code still reads. `isActive` follows the membership; the User-level flag stays true while the
 * user is active in ANY company.
 */
export async function upsertMembership(
  db: TenantDb,
  input: { userId: string; companyId: string; role: string; outletId: string | null; position: string | null; isActive?: boolean; isOwner?: boolean },
): Promise<void> {
  const isActive = input.isActive ?? true
  await db.membership.upsert({
    where: { userId_companyId: { userId: input.userId, companyId: input.companyId } },
    update: {
      role: input.role, outletId: input.outletId, position: input.position, isActive,
      ...(input.isOwner !== undefined ? { isOwner: input.isOwner } : {}),
    },
    create: {
      userId: input.userId, companyId: input.companyId, role: input.role, outletId: input.outletId,
      position: input.position, isActive, isOwner: input.isOwner ?? false,
    },
  })
  const primary = await db.membership.findFirst({ where: { userId: input.userId }, orderBy: { createdAt: 'asc' }, select: { companyId: true } })
  if (primary?.companyId === input.companyId) {
    await db.user.update({ where: { id: input.userId }, data: { role: input.role, outletId: input.outletId, position: input.position } })
  }
  const anyActive = await db.membership.count({ where: { userId: input.userId, isActive: true } })
  await db.user.update({ where: { id: input.userId }, data: { isActive: anyActive > 0 } })
}

// ---------------------------------------------------------------------------------------------
// Idempotent backfill (run by the deploy seed on every deploy, and by the ops script in dry-run)
// ---------------------------------------------------------------------------------------------

export interface BackfillReport {
  slugsAssigned: number
  orphanOutletsAssigned: number
  membershipsCreated: number
  ownersFlagged: number
}

/**
 * Brings existing data up to the multi-company identity model without changing behaviour:
 *  - every Company gets a unique slug;
 *  - every Outlet with no company joins the oldest company (what the old fallbacks already did);
 *  - every User gets a Membership mirroring their legacy role/outlet in their home company;
 *  - the owner-email user's membership is flagged isOwner.
 * Create-only / fill-null-only: re-running changes nothing. `apply:false` only counts.
 */
export async function backfillTenantIdentity(db: TenantDb, opts: { apply: boolean }): Promise<BackfillReport> {
  const report: BackfillReport = { slugsAssigned: 0, orphanOutletsAssigned: 0, membershipsCreated: 0, ownersFlagged: 0 }

  const companies = await db.company.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, slug: true } })
  const taken = new Set(companies.map((c) => c.slug).filter((s): s is string => !!s))
  for (const c of companies) {
    if (c.slug) continue
    let slug = slugify(c.name)
    for (let i = 2; taken.has(slug); i++) slug = `${slugify(c.name)}-${i}`
    taken.add(slug)
    report.slugsAssigned++
    if (opts.apply) await db.company.update({ where: { id: c.id }, data: { slug } })
  }

  const defaultCompany = companies[0]?.id ?? null
  if (defaultCompany) {
    const orphans = await db.outlet.findMany({ where: { companyId: null }, select: { id: true } })
    report.orphanOutletsAssigned = orphans.length
    if (opts.apply && orphans.length) await db.outlet.updateMany({ where: { companyId: null }, data: { companyId: defaultCompany } })
  }

  const users = await db.user.findMany({
    where: { memberships: { none: {} } },
    select: { id: true, email: true, role: true, outletId: true, position: true, isActive: true },
  })
  for (const u of users) {
    report.membershipsCreated++
    if (opts.apply) await ensureMemberships(db, u)
  }

  const owner = (process.env.OWNER_EMAIL || process.env.NEXT_PUBLIC_OWNER_EMAIL || '').trim().toLowerCase()
  if (owner) {
    // Case-insensitive match done in JS (portable across SQLite dev and Postgres; the user table is small).
    const ownerUser = (await db.user.findMany({ select: { id: true, email: true } })).find((u) => u.email.trim().toLowerCase() === owner) ?? null
    // The legacy single owner email owns the ORIGINAL (oldest) company only — never any later one.
    if (ownerUser && defaultCompany) {
      const unflagged = await db.membership.count({ where: { userId: ownerUser.id, companyId: defaultCompany, isOwner: false } })
      report.ownersFlagged = unflagged
      if (opts.apply && unflagged) await db.membership.updateMany({ where: { userId: ownerUser.id, companyId: defaultCompany, isOwner: false }, data: { isOwner: true } })
    }
  }
  return report
}
