import { prisma } from '@/lib/prisma'
import { sendPushToUser } from '@/lib/push'
import { evaluateStageSubmit, CollectionValidationError } from '@/lib/collection-validation'

interface FieldDef { id: string; key: string; label: string; fieldType: string; isRequired: boolean }
interface StageDef { id: string; order: number; isOptional: boolean; entryMode: string; label: string; templateId: string }
interface RuleDef { id: string; ruleType: string; config: string | null; isActive: boolean }
interface JWTUser { userId: string; role: string }

export { CollectionValidationError }

/** Generic per-field required/type checks shared by both single-staff and grid submission. */
export function validateFieldBasics(fields: FieldDef[], values: Record<string, unknown>) {
  for (const f of fields) {
    const raw = values[f.id]
    const isEmpty = raw === undefined || raw === null || raw === ''
    if (f.isRequired && isEmpty) throw new CollectionValidationError(`"${f.label}" is required`)
    if (isEmpty) continue
    if (f.fieldType === 'NUMBER' && Number.isNaN(Number(raw))) throw new CollectionValidationError(`"${f.label}" must be a number`)
  }
}

export async function validatePickerReferences(fields: FieldDef[], values: Record<string, unknown>) {
  const staffPickerIds = fields.filter((f) => f.fieldType === 'STAFF_PICKER').map((f) => values[f.id]).filter(Boolean) as string[]
  const personPickerIds = fields.filter((f) => f.fieldType === 'PERSON_PICKER').map((f) => values[f.id]).filter(Boolean) as string[]
  const [validStaff, validPersons] = await Promise.all([
    staffPickerIds.length ? prisma.user.count({ where: { id: { in: staffPickerIds } } }) : Promise.resolve(0),
    personPickerIds.length ? prisma.person.count({ where: { id: { in: personPickerIds } } }) : Promise.resolve(0),
  ])
  if (validStaff !== new Set(staffPickerIds).size) throw new CollectionValidationError('A selected staff member could not be found')
  if (validPersons !== new Set(personPickerIds).size) throw new CollectionValidationError('A selected person could not be found')
}

interface SubmitArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any
  sessionId: string
  stage: StageDef
  allStages: StageDef[]
  rules: RuleDef[]
  fields: FieldDef[]
  user: JWTUser
  staffId: string | null
  staffName: string | null
  values: Record<string, unknown>
}

/**
 * Runs the CollectionValidationRule engine, then upserts one
 * CollectionStageRecord + its CollectionFieldValue rows. If a
 * DISCOUNT_APPROVAL_LIMIT-style rule flags the submission, the record is
 * still saved (data entry isn't blocked) but status becomes PENDING_APPROVAL
 * instead of COMPLETED, and a WorkflowApproval row is created — resolved via
 * /api/collection-approvals.
 */
export async function submitStageRecord({ tx, sessionId, stage, allStages, rules, fields, user, staffId, staffName, values }: SubmitArgs) {
  const existingRecords = await tx.collectionStageRecord.findMany({ where: { sessionId }, select: { stageId: true, status: true } })

  const approvalsNeeded = evaluateStageSubmit({
    rules, allStages, existingRecords, currentStage: stage, fields, values,
  })

  const existing = await tx.collectionStageRecord.findFirst({
    where: { sessionId, stageId: stage.id, ...(staffId ? { staffId } : { staffId: null, staffName }) },
  })
  const now = new Date()
  const status = approvalsNeeded.length ? 'PENDING_APPROVAL' : 'COMPLETED'
  const stageRecord = existing
    ? await tx.collectionStageRecord.update({ where: { id: existing.id }, data: { status, staffId, staffName, completedAt: now, completedById: user.userId } })
    : await tx.collectionStageRecord.create({ data: { sessionId, stageId: stage.id, status, staffId, staffName, completedAt: now, completedById: user.userId } })

  for (const f of fields) {
    const raw = values[f.id]
    if (raw === undefined || raw === null || raw === '') continue
    await tx.collectionFieldValue.upsert({
      where: { stageRecordId_fieldId: { stageRecordId: stageRecord.id, fieldId: f.id } },
      update: { value: String(raw) },
      create: { stageRecordId: stageRecord.id, fieldId: f.id, value: String(raw) },
    })
  }

  for (const a of approvalsNeeded) {
    await tx.workflowApproval.create({
      data: { stageRecordId: stageRecord.id, requestedById: user.userId, approverRole: a.approverRole, comment: a.reason },
    })
  }

  return { stageRecord, approvalsNeeded }
}

/** Fire-and-forget push to every user with the given role who has a push subscription. Best-effort — never blocks the request. */
export async function notifyApprovers(approverRole: string, payload: { title: string; body: string; url?: string }) {
  const approvers = await prisma.user.findMany({ where: { role: approverRole, isActive: true }, select: { id: true } })
  await Promise.all(approvers.map((a) => sendPushToUser(a.id, payload).catch(() => null)))
}
