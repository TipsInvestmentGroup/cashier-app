import type { NextRequest } from 'next/server'
import { prismaSystem as prisma } from '@/lib/prisma'
import { signKindToken, verifyKindToken } from '@/lib/auth'

/**
 * Platform-owner identity - the product owner who runs the multi-company service itself.
 *
 * It is deliberately NOT a company user: a PlatformAdmin has no Membership, signs in at its own endpoint,
 * and gets a token of `kind: 'platform'` which getAuthUser() rejects, so it can never be used as a company
 * session (and company sessions cannot call /api/platform/*). It manages the *directory* of companies
 * (create, suspend, reactivate) and nothing else: no endpoint here reads or writes any company's business
 * data. Everything it does is recorded in PlatformAuditLog.
 */

export interface PlatformAdminClaims { adminId: string; email: string; name: string }

const PLATFORM_TTL = '4h'

export function signPlatformToken(admin: { id: string; email: string; name: string; sessionEpoch: number }): string {
  return signKindToken({ kind: 'platform', adminId: admin.id, email: admin.email, name: admin.name, sepoch: admin.sessionEpoch }, PLATFORM_TTL)
}

/** Verifies the bearer token AND re-checks the database (active + epoch) on every call. */
export async function requirePlatformAdmin(req: NextRequest): Promise<PlatformAdminClaims | null> {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const claims = verifyKindToken<{ adminId: string; sepoch?: number }>(header.slice(7), 'platform')
  if (!claims?.adminId) return null
  const admin = await prisma.platformAdmin.findUnique({ where: { id: claims.adminId } })
  if (!admin || !admin.isActive) return null
  if (typeof claims.sepoch === 'number' && claims.sepoch !== admin.sessionEpoch) return null
  return { adminId: admin.id, email: admin.email, name: admin.name }
}

export async function platformAudit(adminId: string, action: string, entity: string, entityId: string | null, details?: string) {
  await prisma.platformAuditLog.create({ data: { adminId, action, entity, entityId, details: details ?? null } })
}
