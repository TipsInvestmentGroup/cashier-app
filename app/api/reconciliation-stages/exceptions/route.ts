import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, NO_OUTLET } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { getExceptionReport } from '@/lib/reconciliation-reminders'

/**
 * GET — exception report (design doc §12.2.1): every stage that reached full
 * escalation and is still not resolved, joined with its failing checks. Not
 * a stored table — generated on demand from ReconciliationStage +
 * ReconciliationCheckResult, the same data the Stages dashboard already
 * shows, just pre-filtered to what needs attention.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.VIEW_RECONCILIATION_AUDIT_LOG))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const requestedOutletId = searchParams.get('outletId')
  const outletId = readOutletScope(user, requestedOutletId)
  if (outletId === NO_OUTLET) return NextResponse.json({ exceptions: [] })

  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json({ exceptions: [] })

  const date = searchParams.get('date')
  const stages = await getExceptionReport({ companyId, outletId: outletId || undefined, date: date ? new Date(date) : undefined })

  return NextResponse.json({
    exceptions: stages.map((s) => ({
      id: s.id,
      outletId: s.outletId,
      date: s.date,
      stageKey: s.stageKey,
      status: s.status,
      escalatedAt: s.escalatedAt,
      escalatedToRoles: s.escalatedToRoles ? JSON.parse(s.escalatedToRoles) : null,
      failingChecks: s.checkResults.map((c) => ({ checkType: c.checkType, status: c.status, detail: c.detail ? JSON.parse(c.detail) : null })),
    })),
  })
}
