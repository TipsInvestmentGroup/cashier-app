// The Collection Mode Engine's resolver — decides which collection workflow
// (Default fixed-form, or Transaction Verification) applies for a given
// user/outlet, without any workflow being hardcoded. See the
// CollectionModeConfig model comment in prisma/schema.prisma for the
// scope/priority design.
import { prisma } from '@/lib/prisma'

export const COLLECTION_MODES = ['DEFAULT', 'TRANSACTION_VERIFICATION'] as const
export type CollectionMode = (typeof COLLECTION_MODES)[number]

export const SCOPES = ['GLOBAL', 'COMPANY', 'OUTLET', 'ROLE'] as const
export type Scope = (typeof SCOPES)[number]

interface ResolveArgs {
  outletId?: string | null
  role?: string | null
}

/**
 * Resolves the effective Collection Mode for a user, checking narrowest to
 * widest scope: ROLE (their own role) → OUTLET (their outlet) → COMPANY
 * (their outlet's company) → GLOBAL default. Falls back to DEFAULT — not an
 * error — if no config row exists at any level, so a business that has never
 * touched Collection Mode Settings keeps today's fixed-form behavior exactly
 * as before, with zero setup required.
 */
export async function resolveCollectionMode({ outletId, role }: ResolveArgs): Promise<CollectionMode> {
  const priority: { scope: Scope; scopeId: string | null }[] = []
  if (role) priority.push({ scope: 'ROLE', scopeId: role })

  let companyId: string | null = null
  if (outletId) {
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { companyId: true } })
    companyId = outlet?.companyId || null
    priority.push({ scope: 'OUTLET', scopeId: outletId })
  }
  if (companyId) priority.push({ scope: 'COMPANY', scopeId: companyId })
  priority.push({ scope: 'GLOBAL', scopeId: null })

  const rows = await prisma.collectionModeConfig.findMany({
    where: { OR: priority.map((p) => ({ scope: p.scope, scopeId: p.scopeId })) },
  })

  for (const p of priority) {
    const row = rows.find((r) => r.scope === p.scope && r.scopeId === p.scopeId)
    if (row) return row.mode as CollectionMode
  }
  return 'DEFAULT'
}

/** Upsert one config row. GLOBAL rows can't rely on the DB unique constraint
 *  (scopeId is NULL, and NULL != NULL in a unique index) — handled here by
 *  looking up the existing GLOBAL row explicitly instead. */
export async function setCollectionMode(scope: Scope, scopeId: string | null, mode: CollectionMode) {
  if (scope === 'GLOBAL') {
    const existing = await prisma.collectionModeConfig.findFirst({ where: { scope: 'GLOBAL' } })
    if (existing) return prisma.collectionModeConfig.update({ where: { id: existing.id }, data: { mode } })
    return prisma.collectionModeConfig.create({ data: { scope: 'GLOBAL', scopeId: null, mode } })
  }
  if (!scopeId) throw new Error(`scopeId is required for scope ${scope}`)
  return prisma.collectionModeConfig.upsert({
    where: { scope_scopeId: { scope, scopeId } },
    update: { mode },
    create: { scope, scopeId, mode },
  })
}
