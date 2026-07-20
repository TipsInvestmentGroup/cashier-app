import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { checkGraceAndEscalate } from '@/lib/reconciliation-stage'

/** GET — one stage instance with its check results, audit log, and unlock requests. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.VIEW_RECONCILIATION_STAGES))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  await checkGraceAndEscalate(id)

  const stage = await prisma.reconciliationStage.findUnique({
    where: { id },
    include: {
      outlet: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      checkResults: true,
      auditLogs: { orderBy: { createdAt: 'desc' } },
      unlockRequests: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!stage) return NextResponse.json({ error: 'Stage not found' }, { status: 404 })

  return NextResponse.json({
    ...stage,
    missingItems: stage.resultDetail ? JSON.parse(stage.resultDetail) : [],
    checkResults: stage.checkResults.map((c) => ({ ...c, detail: c.detail ? JSON.parse(c.detail) : null })),
  })
}
