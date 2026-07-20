// Controlled Write-Off workflow — never modifies the original discrepancy
// record (CashRecon/BankRecon/CollectionExcess/CashReconExcess); a
// WriteOffRequest is a separate, approved adjustment that references it.
// No user, including Admin, can delete or silently adjust a reconciliation
// discrepancy — every write-off requires evidence + a Finance Manager
// approval (WRITE_OFF_RESOURCES.APPROVE_WRITE_OFF, see lib/rbac.ts). On
// approval, posts a JournalEntry adjustment through the existing Finance
// Platform ledger (lib/ledger.ts postJournalEntry, the single choke point
// every module already goes through) and stamps journalEntryId back onto
// the request.
import { prisma } from '@/lib/prisma'
import { postJournalEntry } from '@/lib/ledger'
import { resolveAccountId } from '@/lib/finance-mapping'

interface Actor {
  userId: string
  userName: string
}

async function writeAuditLog(writeOffId: string, action: string, reason?: string, actor?: Actor) {
  return prisma.writeOffAuditLog.create({
    data: { writeOffId, action, reason, userId: actor?.userId, userName: actor?.userName },
  })
}

/** Derives which account a write-off should credit from the actual source
 *  record, rather than trusting a client-supplied channelKey — a BankRecon
 *  write-off must post against that record's own channel (CRDB/STANBIC/
 *  MPESA/…), never a hardcoded default. */
async function resolveChannelKeyForSource(sourceModel: string, sourceId: string): Promise<string> {
  if (sourceModel === 'BankRecon') {
    const row = await prisma.bankRecon.findUnique({ where: { id: sourceId }, select: { channel: true } })
    return row?.channel || 'CASH'
  }
  if (sourceModel === 'CashRecon' || sourceModel === 'CashReconExcess') return 'CASH'
  if (sourceModel === 'CollectionExcess') {
    const row = await prisma.collectionExcess.findUnique({ where: { id: sourceId }, select: { channelCode: true } })
    return row?.channelCode || 'CASH'
  }
  return 'CASH'
}

export async function requestWriteOff(input: {
  companyId: string
  outletId?: string | null
  reconciliationStageId?: string | null
  sourceModel: string
  sourceId: string
  expectedAmount: number
  receivedAmount: number
  reason: string
  evidenceUrl?: string | null
  actor: Actor
}) {
  const amount = Math.round((input.expectedAmount - input.receivedAmount) * 100) / 100
  if (amount <= 0) throw new Error('Write-off amount must be positive (expected must exceed received)')

  const channelKey = await resolveChannelKeyForSource(input.sourceModel, input.sourceId)

  const request = await prisma.writeOffRequest.create({
    data: {
      companyId: input.companyId,
      outletId: input.outletId ?? null,
      reconciliationStageId: input.reconciliationStageId ?? null,
      sourceModel: input.sourceModel,
      sourceId: input.sourceId,
      channelKey,
      expectedAmount: input.expectedAmount,
      receivedAmount: input.receivedAmount,
      amount,
      reason: input.reason,
      evidenceUrl: input.evidenceUrl ?? null,
      requestedById: input.actor.userId,
      requestedByName: input.actor.userName,
    },
  })
  await writeAuditLog(request.id, 'REQUESTED', input.reason, input.actor)
  return request
}

export async function approveWriteOff(id: string, actor: Actor, comment?: string) {
  const request = await prisma.writeOffRequest.findUnique({ where: { id } })
  if (!request) throw new Error('Write-off request not found')
  if (request.status !== 'PENDING') throw new Error('This write-off request has already been resolved')

  const writeOffAccountId = await resolveAccountId(prisma, { companyId: request.companyId, key: 'WRITE_OFF_EXPENSE' })
  const assetAccountId = await resolveAccountId(prisma, { companyId: request.companyId, key: request.channelKey })

  const entry = await postJournalEntry(prisma, {
    companyId: request.companyId,
    entryDate: new Date(),
    sourceModule: 'COLLECTIONS',
    sourceType: 'WriteOffRequest',
    sourceId: request.id,
    description: `Reconciliation write-off: ${request.reason}`,
    createdById: actor.userId,
    lines: [
      { accountId: writeOffAccountId, outletId: request.outletId, debit: request.amount, description: request.reason },
      { accountId: assetAccountId, outletId: request.outletId, credit: request.amount, description: `Write-off against ${request.sourceModel} ${request.sourceId}` },
    ],
  })

  const updated = await prisma.writeOffRequest.update({
    where: { id },
    data: { status: 'APPROVED', approverId: actor.userId, approverName: actor.userName, approverComment: comment, resolvedAt: new Date(), journalEntryId: entry.id },
  })
  await writeAuditLog(id, 'APPROVED', comment, actor)
  await writeAuditLog(id, 'JOURNAL_ENTRY_CREATED', entry.entryNumber, actor)
  return updated
}

export async function rejectWriteOff(id: string, actor: Actor, comment: string) {
  const request = await prisma.writeOffRequest.findUnique({ where: { id } })
  if (!request) throw new Error('Write-off request not found')
  if (request.status !== 'PENDING') throw new Error('This write-off request has already been resolved')

  const updated = await prisma.writeOffRequest.update({
    where: { id },
    data: { status: 'REJECTED', approverId: actor.userId, approverName: actor.userName, approverComment: comment, resolvedAt: new Date() },
  })
  await writeAuditLog(id, 'REJECTED', comment, actor)
  return updated
}

export async function cancelWriteOff(id: string, actor: Actor, reason?: string) {
  const request = await prisma.writeOffRequest.findUnique({ where: { id } })
  if (!request) throw new Error('Write-off request not found')
  if (request.status !== 'PENDING') throw new Error('Only a pending write-off request can be cancelled')
  if (request.requestedById !== actor.userId) throw new Error('Only the original requester can cancel this request')

  const updated = await prisma.writeOffRequest.update({ where: { id }, data: { status: 'CANCELLED', resolvedAt: new Date() } })
  await writeAuditLog(id, 'CANCELLED', reason, actor)
  return updated
}
