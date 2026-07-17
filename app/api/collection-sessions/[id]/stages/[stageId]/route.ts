import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { validateFieldBasics, validatePickerReferences, submitStageRecord, notifyApprovers, CollectionValidationError } from '@/lib/collection-stage-submit'

const ALLOWED = ['CASHIER', 'ADMIN', 'ACCOUNTANT']

interface GridRowInput { staffId: string; values: Record<string, unknown> }

/**
 * Submit one stage's data. Two shapes, both handled here (rather than a
 * separate nested /grid route — a sibling `route.ts` one level below this
 * one's own `[stageId]/route.ts` was silently unregistered by the dev
 * server's router in this project, even after a full `.next` wipe + restart;
 * folding grid submission into the existing working endpoint sidesteps it
 * and keeps the API surface smaller anyway):
 *  - SINGLE_STAFF: body = { staffId?, staffName?, values }
 *  - MULTI_STAFF_GRID / BATCH / EXCEL_IMPORT: body = { rows: [{ staffId,
 *    values }, ...] } — one CollectionStageRecord per row, all in one
 *    transaction (mirrors the single-transaction pattern the legacy
 *    /api/collections route uses). These three entry modes all produce the
 *    same row shape (a full roster, a picked subset, or a parsed
 *    spreadsheet respectively) so they share this one code path. Rows with
 *    no values filled in are silently skipped.
 * Runs the CollectionValidationRule engine (lib/collection-validation.ts) via
 * lib/collection-stage-submit.ts for every row. A rule that requires sign-off
 * (e.g. discount over its limit) doesn't block the save — it marks the
 * record PENDING_APPROVAL and opens a WorkflowApproval instead.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; stageId: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: sessionId, stageId } = await params
  const session = await prisma.collectionSession.findUnique({ where: { id: sessionId } })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const [stage, allStages, rules] = await Promise.all([
    prisma.collectionStage.findUnique({ where: { id: stageId }, include: { sections: { include: { fields: true } } } }),
    prisma.collectionStage.findMany({ where: { templateId: session.templateId }, select: { id: true, order: true, isOptional: true, entryMode: true, label: true, templateId: true } }),
    prisma.collectionValidationRule.findMany({ where: { templateId: session.templateId } }),
  ])
  if (!stage || stage.templateId !== session.templateId) return NextResponse.json({ error: "Stage not found on this session's template" }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const fields = stage.sections.flatMap((s) => s.fields)

  try {
    if (Array.isArray(body.rows)) {
      const GRID_MODES = ['MULTI_STAFF_GRID', 'BATCH', 'EXCEL_IMPORT']
      if (!GRID_MODES.includes(stage.entryMode)) return NextResponse.json({ error: 'This stage is not configured for bulk (row-based) entry' }, { status: 400 })

      const rows: GridRowInput[] = body.rows
      const nonEmptyRows = rows.filter((r) => r.staffId && r.values && Object.values(r.values).some((v) => v !== undefined && v !== null && v !== ''))
      if (nonEmptyRows.length === 0) return NextResponse.json({ error: 'Enter at least one row before saving' }, { status: 400 })

      const staffIds = nonEmptyRows.map((r) => r.staffId)
      const validStaffCount = await prisma.user.count({ where: { id: { in: staffIds } } })
      if (validStaffCount !== new Set(staffIds).size) return NextResponse.json({ error: 'A selected staff member could not be found' }, { status: 400 })

      const staffNames = await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })
      const nameById = new Map(staffNames.map((s) => [s.id, s.name]))

      for (const row of nonEmptyRows) {
        validateFieldBasics(fields, row.values)
        await validatePickerReferences(fields, row.values)
      }

      const results = await prisma.$transaction(async (tx) => {
        const out = []
        for (const row of nonEmptyRows) {
          const result = await submitStageRecord({
            tx, sessionId, stage, allStages, rules, fields, user,
            staffId: row.staffId, staffName: nameById.get(row.staffId) || null, values: row.values,
          })
          out.push(result)
        }
        if (session.status === 'OPEN') await tx.collectionSession.update({ where: { id: sessionId }, data: { status: 'IN_PROGRESS' } })
        return out
      })

      const allApprovals = results.flatMap((r) => r.approvalsNeeded)
      const approverRoles = new Set(allApprovals.map((a) => a.approverRole))
      for (const role of approverRoles) {
        await notifyApprovers(role, { title: 'Collection approval needed', body: `${stage.label}: ${allApprovals.filter((a) => a.approverRole === role).length} entr(y/ies) need sign-off`, url: `/collection-sessions/${sessionId}` })
      }

      await prisma.auditLog.create({
        data: { userId: user.userId, action: 'UPDATE', entity: 'CollectionStageRecord', entityId: sessionId, details: `Grid-saved stage "${stage.label}" for ${results.length} staff (${allApprovals.length} pending approval)` },
      })

      return NextResponse.json({ saved: results.length, pendingApproval: allApprovals.length })
    }

    const staffId: string | null = body.staffId || null
    const staffName: string | null = body.staffName || null
    const values: Record<string, unknown> = body.values && typeof body.values === 'object' ? body.values : {}

    if (stage.entryMode === 'SINGLE_STAFF' && !staffId && !staffName) {
      return NextResponse.json({ error: 'Select the staff member this stage is for' }, { status: 400 })
    }

    validateFieldBasics(fields, values)
    await validatePickerReferences(fields, values)

    const { stageRecord, approvalsNeeded } = await prisma.$transaction(async (tx) => {
      const result = await submitStageRecord({ tx, sessionId, stage, allStages, rules, fields, user, staffId, staffName, values })
      if (session.status === 'OPEN') await tx.collectionSession.update({ where: { id: sessionId }, data: { status: 'IN_PROGRESS' } })
      return result
    })

    for (const a of approvalsNeeded) {
      await notifyApprovers(a.approverRole, { title: 'Collection approval needed', body: `${stage.label}: ${a.reason}`, url: `/collection-sessions/${sessionId}` })
    }

    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'UPDATE', entity: 'CollectionStageRecord', entityId: stageRecord.id, details: `${approvalsNeeded.length ? 'Submitted (pending approval)' : 'Completed'} stage "${stage.label}" for ${staffName || staffId || 'session'}` },
    })

    const full = await prisma.collectionStageRecord.findUnique({ where: { id: stageRecord.id }, include: { fieldValues: true } })
    return NextResponse.json(full)
  } catch (err) {
    if (err instanceof CollectionValidationError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
