import { prisma } from '@/lib/prisma'

const OPEN_STAGE_STATUSES = ['PENDING', 'IN_PROGRESS', 'PENDING_APPROVAL']
const COUNTED_STAGE_STATUSES = ['COMPLETED', 'APPROVED']

export interface CollectionSessionTotal {
  id: string
  outletId: string
  date: Date
  status: string
  templateName: string
  total: number
  hasOpenWork: boolean
}

/**
 * Aggregates custom-Collection-Template money for an outlet/date range, so
 * Close-Day and reporting can treat template-collected cash the same way
 * DailyCollection totals are treated, without forcing template data into the
 * legacy fixed-column schema. Every NUMBER-type CollectionFieldValue on a
 * COMPLETED/APPROVED stage record counts toward a session's total; sessions
 * for the Standard/default template are excluded — its real data (if that
 * rarely-used path is ever exercised) already lives in DailyCollection, so
 * including it here would double-count.
 */
export async function getCollectionSessionTotals({ outletId, dateRange }: { outletId?: string | null; dateRange?: { gte: Date; lte: Date } }): Promise<CollectionSessionTotal[]> {
  const sessions = await prisma.collectionSession.findMany({
    where: {
      ...(outletId ? { outletId } : {}),
      ...(dateRange ? { date: dateRange } : {}),
      template: { isDefault: false },
    },
    include: {
      template: { select: { name: true, stages: { where: { isOptional: false }, select: { id: true } } } },
      stageRecords: {
        include: { fieldValues: { include: { field: { select: { fieldType: true } } } } },
      },
    },
  })

  return sessions.map((s) => {
    let total = 0
    let hasOpenWork = false
    for (const record of s.stageRecords) {
      if (OPEN_STAGE_STATUSES.includes(record.status)) hasOpenWork = true
      if (!COUNTED_STAGE_STATUSES.includes(record.status)) continue
      for (const fv of record.fieldValues) {
        if (fv.field.fieldType !== 'NUMBER' || fv.value == null || fv.value === '') continue
        const n = Number(fv.value)
        if (!Number.isNaN(n)) total += n
      }
    }
    // A required stage with no COMPLETED/APPROVED record yet (including one
    // never even started) is also open work — not just a record stuck in an
    // in-progress status.
    const requiredStagesDone = s.template.stages.every((stage) =>
      s.stageRecords.some((r) => r.stageId === stage.id && COUNTED_STAGE_STATUSES.includes(r.status)))
    if (!requiredStagesDone) hasOpenWork = true

    return {
      id: s.id,
      outletId: s.outletId,
      date: s.date,
      status: s.status,
      templateName: s.template.name,
      total,
      hasOpenWork,
    }
  })
}
