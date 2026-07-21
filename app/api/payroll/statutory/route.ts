import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'

// Read-only listing of statutory rules (Phase 4). Supervisor-gated. Without
// `at`, returns every version; with `at=YYYY-MM-DD`, returns only the version of
// each code effective on that date (what a run on that date would apply).
const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const companyId = await resolveDefaultCompanyId(prisma)
  if (!companyId) return NextResponse.json({ rules: [] })

  const { searchParams } = new URL(req.url)
  const atParam = searchParams.get('at')
  const rules = await prisma.statutoryRule.findMany({ where: { companyId }, orderBy: [{ code: 'asc' }, { effectiveFrom: 'desc' }] })

  if (!atParam) return NextResponse.json({ rules })

  const at = new Date(atParam)
  if (isNaN(at.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  // Newest effective version per code as of `at`.
  const byCode = new Map<string, (typeof rules)[number]>()
  for (const r of rules) {
    if (!r.isActive) continue
    if (r.effectiveFrom > at) continue
    if (r.effectiveTo && r.effectiveTo < at) continue
    if (!byCode.has(r.code)) byCode.set(r.code, r) // rules are effectiveFrom-desc, so first hit wins
  }
  return NextResponse.json({ at: atParam, rules: [...byCode.values()] })
}
