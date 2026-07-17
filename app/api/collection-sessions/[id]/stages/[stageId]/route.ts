import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

const ALLOWED = ['CASHIER', 'ADMIN', 'ACCOUNTANT']

/**
 * Submit one stage's data for one staff member (SINGLE_STAFF entry mode —
 * the only mode implemented so far; MULTI_STAFF_GRID/BATCH/EXCEL_IMPORT/
 * POS_SYNC are a later phase). Upserts a CollectionStageRecord + its
 * CollectionFieldValue rows in one transaction and marks the stage COMPLETED.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; stageId: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: sessionId, stageId } = await params
  const session = await prisma.collectionSession.findUnique({ where: { id: sessionId } })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const stage = await prisma.collectionStage.findUnique({
    where: { id: stageId },
    include: { sections: { include: { fields: true } } },
  })
  if (!stage || stage.templateId !== session.templateId) return NextResponse.json({ error: 'Stage not found on this session\'s template' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const staffId: string | null = body.staffId || null
  const staffName: string | null = body.staffName || null
  const values: Record<string, unknown> = body.values && typeof body.values === 'object' ? body.values : {}

  if (stage.entryMode === 'SINGLE_STAFF' && !staffId && !staffName) {
    return NextResponse.json({ error: 'Select the staff member this stage is for' }, { status: 400 })
  }

  const fields = stage.sections.flatMap((s) => s.fields)
  for (const f of fields) {
    const raw = values[f.id]
    const isEmpty = raw === undefined || raw === null || raw === ''
    if (f.isRequired && isEmpty) return NextResponse.json({ error: `"${f.label}" is required` }, { status: 400 })
    if (isEmpty) continue
    if (f.fieldType === 'NUMBER' && Number.isNaN(Number(raw))) return NextResponse.json({ error: `"${f.label}" must be a number` }, { status: 400 })
  }

  const staffPickerIds = fields.filter((f) => f.fieldType === 'STAFF_PICKER').map((f) => values[f.id]).filter(Boolean) as string[]
  const personPickerIds = fields.filter((f) => f.fieldType === 'PERSON_PICKER').map((f) => values[f.id]).filter(Boolean) as string[]
  const [validStaff, validPersons] = await Promise.all([
    staffPickerIds.length ? prisma.user.count({ where: { id: { in: staffPickerIds } } }) : Promise.resolve(0),
    personPickerIds.length ? prisma.person.count({ where: { id: { in: personPickerIds } } }) : Promise.resolve(0),
  ])
  if (validStaff !== new Set(staffPickerIds).size) return NextResponse.json({ error: 'A selected staff member could not be found' }, { status: 400 })
  if (validPersons !== new Set(personPickerIds).size) return NextResponse.json({ error: 'A selected person could not be found' }, { status: 400 })

  const record = await prisma.$transaction(async (tx) => {
    const existing = await tx.collectionStageRecord.findFirst({
      where: { sessionId, stageId, ...(staffId ? { staffId } : { staffId: null, staffName }) },
    })
    const now = new Date()
    const stageRecord = existing
      ? await tx.collectionStageRecord.update({
          where: { id: existing.id },
          data: { status: 'COMPLETED', staffId, staffName, completedAt: now, completedById: user.userId },
        })
      : await tx.collectionStageRecord.create({
          data: { sessionId, stageId, status: 'COMPLETED', staffId, staffName, completedAt: now, completedById: user.userId },
        })

    for (const f of fields) {
      const raw = values[f.id]
      if (raw === undefined || raw === null || raw === '') continue
      await tx.collectionFieldValue.upsert({
        where: { stageRecordId_fieldId: { stageRecordId: stageRecord.id, fieldId: f.id } },
        update: { value: String(raw) },
        create: { stageRecordId: stageRecord.id, fieldId: f.id, value: String(raw) },
      })
    }

    if (session.status === 'OPEN') await tx.collectionSession.update({ where: { id: sessionId }, data: { status: 'IN_PROGRESS' } })

    return tx.collectionStageRecord.findUnique({ where: { id: stageRecord.id }, include: { fieldValues: true } })
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'CollectionStageRecord', entityId: record!.id, details: `Completed stage "${stage.label}" for ${staffName || staffId || 'session'}` },
  })

  return NextResponse.json(record)
}
