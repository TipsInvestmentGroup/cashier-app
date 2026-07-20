import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, NO_OUTLET } from '@/lib/auth'
import { runReconciliationDiagnostic } from '@/lib/reconciliation-diagnostic'

const ALLOWED = ['ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR']

/** GET — run the live Excess/Reconciliation accounting self-diagnostic (read-only).
 *  Optional ?outletId= scopes the checks; managers/finance only. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const outletId = readOutletScope(user, new URL(req.url).searchParams.get('outletId'))
  if (outletId === NO_OUTLET) return NextResponse.json({ generatedAt: new Date().toISOString(), bySeverity: {}, findings: [] })

  try {
    const findings = await runReconciliationDiagnostic(prisma, { outletId })
    const bySeverity = findings.reduce((m, f) => { m[f.severity] = (m[f.severity] || 0) + 1; return m }, {} as Record<string, number>)
    return NextResponse.json({ generatedAt: new Date().toISOString(), bySeverity, findings })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Diagnostic failed' }, { status: 500 })
  }
}
