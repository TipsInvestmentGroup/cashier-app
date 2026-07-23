import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { VERIFICATION_STAGES, type VerificationStage } from '@/lib/expense-config'
import { recordVerificationStage } from '@/lib/expense-verification'

const MGMT_ROLES = ['ADMIN', 'MANAGER', 'DIRECTOR', 'ACCOUNTANT']
// RECEIPT_UPLOADED is self-attestation (the requester can log their own
// receipt); every later stage is an independent sign-off and needs a
// management role — the same separation-of-duties split used across this app
// (see lib/cash-verify.ts canVerifyCash()'s "entry role vs. verifier role").
const SELF_ATTESTABLE_STAGES: VerificationStage[] = ['RECEIPT_UPLOADED']

/** GET — list verification records for a request. Owner or management role. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const request = await prisma.expenseRequest.findUnique({ where: { id } })
  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (request.requestedById !== user.userId && !MGMT_ROLES.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const records = await prisma.verificationRecord.findMany({ where: { expenseRequestId: id }, orderBy: [{ verifiedAt: 'asc' }] })
  return NextResponse.json(records)
}

/** POST — record a verification stage. Body: { stage, note?, attachmentId? }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const request = await prisma.expenseRequest.findUnique({ where: { id } })
  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const stage = String(body.stage || '') as VerificationStage
  if (!(VERIFICATION_STAGES as readonly string[]).includes(stage)) {
    return NextResponse.json({ error: `stage must be one of ${VERIFICATION_STAGES.join(', ')}` }, { status: 400 })
  }

  const isSelfAttestable = SELF_ATTESTABLE_STAGES.includes(stage)
  const isOwner = request.requestedById === user.userId
  const isMgmt = MGMT_ROLES.includes(user.role)
  if (!isMgmt && !(isSelfAttestable && isOwner)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const result = await recordVerificationStage(prisma, {
      expenseRequestId: id, stage, verifiedById: user.userId,
      note: body.note ? String(body.note) : null, attachmentId: body.attachmentId ? String(body.attachmentId) : null,
    })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'CREATE', entity: 'VerificationRecord', entityId: result.id, details: `Recorded ${stage} on expense request ${id}` },
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to record verification' }, { status: 400 })
  }
}
