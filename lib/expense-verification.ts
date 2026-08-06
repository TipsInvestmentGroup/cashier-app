// The Universal Expense & Disbursement Framework's verification workflow —
// Stage 10: payment alone never advances a request past PAID. Reaching
// VERIFIED requires recording the VALIDATED stage, and — when the request
// type configures requiredVerificationStages / requiredAttachments — every
// prerequisite stage and required attachment doc-type must already be on
// file. CLOSED is a separate, explicit final step (Phase 1's stand-in for
// Stage 10's "Accounting Posted → Reconciled → Closed" tail — accounting
// posting already happens automatically at payment time via
// lib/expense-payments.ts, and full reconciliation integration is a later
// phase). See docs/expense-disbursement-framework-design.md.
import type { Db } from '@/lib/ledger'
import { VERIFICATION_STAGES, ATTACHMENT_ENTITY_TYPES, type VerificationStage, type ExpenseRequestStatus } from '@/lib/expense-config'

function parseStageList(raw: string | null | undefined): VerificationStage[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s): s is VerificationStage => (VERIFICATION_STAGES as readonly string[]).includes(s)) : []
  } catch {
    return []
  }
}

function parseDocTypeList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

// A request can gather verification evidence any time after APPROVED (a
// receipt often arrives before the cash does), but not before — and not once
// it's already CLOSED/CANCELLED/REJECTED.
const RECORDABLE_STATUSES: ExpenseRequestStatus[] = ['APPROVED', 'PARTIALLY_PAID', 'PAID', 'VERIFIED']

export interface RecordVerificationStageInput {
  expenseRequestId: string
  stage: VerificationStage
  verifiedById?: string | null
  note?: string | null
  attachmentId?: string | null
}

export interface RecordVerificationStageResult {
  id: string
  stage: VerificationStage
  requestStatus: ExpenseRequestStatus
}

/**
 * Append one VerificationRecord row — history is append-only, re-recording
 * the same stage just adds another row, never edits a prior one. Only
 * stage=VALIDATED can advance the request: PAID → VERIFIED, and only once
 * every stage in the request type's requiredVerificationStages is on file
 * (excluding VALIDATED itself) AND every doc-type in requiredAttachments has
 * at least one Attachment on file. A request type with no requirements
 * configured lets a single VALIDATED record close the loop — "zero config =
 * simplest behavior", same as everywhere else in this framework. Recording
 * VALIDATED while the request is still PARTIALLY_PAID is allowed (kept for
 * the audit trail) but does not advance status — full payment is the gate.
 */
export async function recordVerificationStage(db: Db, input: RecordVerificationStageInput): Promise<RecordVerificationStageResult> {
  const request = await db.expenseRequest.findUnique({ where: { id: input.expenseRequestId }, include: { requestType: true } })
  if (!request) throw new Error('Expense request not found')
  if (!RECORDABLE_STATUSES.includes(request.status as ExpenseRequestStatus)) {
    throw new Error(`Cannot record verification on a request in status ${request.status}`)
  }

  if (input.stage === 'VALIDATED') {
    const requiredStages = parseStageList(request.requestType.requiredVerificationStages).filter((s) => s !== 'VALIDATED')
    if (requiredStages.length) {
      const existing = await db.verificationRecord.findMany({ where: { expenseRequestId: input.expenseRequestId, stage: { in: requiredStages } }, select: { stage: true } })
      const have = new Set(existing.map((r) => r.stage))
      const missing = requiredStages.filter((s) => !have.has(s))
      if (missing.length) throw new Error(`Cannot validate — missing required verification stage(s): ${missing.join(', ')}`)
    }
    const requiredDocTypes = parseDocTypeList(request.requestType.requiredAttachments)
    if (requiredDocTypes.length) {
      const attachments = await db.attachment.findMany({ where: { entityType: 'ExpenseRequest', entityId: input.expenseRequestId }, select: { docType: true } })
      const have = new Set(attachments.map((a) => a.docType))
      const missing = requiredDocTypes.filter((d) => !have.has(d))
      if (missing.length) throw new Error(`Cannot validate — missing required attachment(s): ${missing.join(', ')}`)
    }
  }

  const record = await db.verificationRecord.create({
    data: { expenseRequestId: input.expenseRequestId, stage: input.stage, verifiedById: input.verifiedById || null, note: input.note || null, attachmentId: input.attachmentId || null },
  })

  let requestStatus = request.status as ExpenseRequestStatus
  if (input.stage === 'VALIDATED' && request.status === 'PAID') {
    await db.expenseRequest.update({ where: { id: input.expenseRequestId }, data: { status: 'VERIFIED', stageEnteredAt: new Date() } })
    requestStatus = 'VERIFIED'
  }

  return { id: record.id, stage: input.stage, requestStatus }
}

/** VERIFIED → CLOSED. The final, explicit administrative step. */
export async function closeExpenseRequest(db: Db, expenseRequestId: string): Promise<{ status: ExpenseRequestStatus }> {
  const request = await db.expenseRequest.findUnique({ where: { id: expenseRequestId } })
  if (!request) throw new Error('Expense request not found')
  if (request.status !== 'VERIFIED') throw new Error(`Cannot close a request in status ${request.status}`)

  await db.expenseRequest.update({ where: { id: expenseRequestId }, data: { status: 'CLOSED', stageEnteredAt: new Date() } })
  return { status: 'CLOSED' }
}

export interface CreateAttachmentInput {
  entityType: string
  entityId: string
  url: string
  docType?: string
  uploadedById?: string | null
}

/** Validates entityType is one of the supported kinds and that entity
 *  actually exists, then creates the Attachment row. Loose entityType/
 *  entityId ref (no FK) — same convention as JournalEntry.sourceType/
 *  sourceId — so attaching to a new entity kind later needs no schema change. */
export async function createExpenseAttachment(db: Db, input: CreateAttachmentInput) {
  if (!(ATTACHMENT_ENTITY_TYPES as readonly string[]).includes(input.entityType)) {
    throw new Error(`entityType must be one of ${ATTACHMENT_ENTITY_TYPES.join(', ')}`)
  }
  if (!input.url.trim()) throw new Error('url is required')

  const exists =
    input.entityType === 'ExpenseRequest'
      ? await db.expenseRequest.findUnique({ where: { id: input.entityId }, select: { id: true } })
      : input.entityType === 'ExpensePayment'
        ? await db.expensePayment.findUnique({ where: { id: input.entityId }, select: { id: true } })
        : await db.verificationRecord.findUnique({ where: { id: input.entityId }, select: { id: true } })
  if (!exists) throw new Error(`${input.entityType} ${input.entityId} not found`)

  return db.attachment.create({
    data: { entityType: input.entityType, entityId: input.entityId, url: input.url, docType: input.docType || 'RECEIPT', uploadedById: input.uploadedById || null },
  })
}
