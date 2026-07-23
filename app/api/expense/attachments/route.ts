import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { ATTACHMENT_DOC_TYPES } from '@/lib/expense-config'
import { createExpenseAttachment } from '@/lib/expense-verification'

const MGMT_ROLES = ['ADMIN', 'MANAGER', 'DIRECTOR', 'ACCOUNTANT']

/** Owner-or-management check for an ExpenseRequest-attached entity; for
 *  ExpensePayment/VerificationRecord (added by whoever processes them, not
 *  the original requester) a management role is required outright. */
async function canAccessEntity(entityType: string, entityId: string, userId: string, role: string): Promise<boolean> {
  if (MGMT_ROLES.includes(role)) return true
  if (entityType !== 'ExpenseRequest') return false
  const request = await prisma.expenseRequest.findUnique({ where: { id: entityId }, select: { requestedById: true } })
  return request?.requestedById === userId
}

/** GET — list attachments for an entity. Query: ?entityType=&entityId= */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entityType = req.nextUrl.searchParams.get('entityType') || ''
  const entityId = req.nextUrl.searchParams.get('entityId') || ''
  if (!entityType || !entityId) return NextResponse.json({ error: 'entityType and entityId are required' }, { status: 400 })

  if (!(await canAccessEntity(entityType, entityId, user.userId, user.role))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const attachments = await prisma.attachment.findMany({ where: { entityType, entityId }, orderBy: [{ createdAt: 'asc' }] })
  return NextResponse.json(attachments)
}

/** POST — attach a file/receipt/proof to an entity. Body: { entityType,
 *  entityId, url, docType? }. url is a link/data-URI the caller already
 *  uploaded elsewhere — this route does not handle file upload itself,
 *  mirrors PettyCash.receiptUrl's existing convention. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const entityType = String(body.entityType || '')
  const entityId = String(body.entityId || '')
  if (!entityType || !entityId) return NextResponse.json({ error: 'entityType and entityId are required' }, { status: 400 })
  if (!body.url || !String(body.url).trim()) return NextResponse.json({ error: 'url is required' }, { status: 400 })
  if (body.docType !== undefined && !(ATTACHMENT_DOC_TYPES as readonly string[]).includes(body.docType)) {
    return NextResponse.json({ error: `docType must be one of ${ATTACHMENT_DOC_TYPES.join(', ')}` }, { status: 400 })
  }

  if (!(await canAccessEntity(entityType, entityId, user.userId, user.role))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const attachment = await createExpenseAttachment(prisma, {
      entityType, entityId, url: String(body.url), docType: body.docType ? String(body.docType) : undefined, uploadedById: user.userId,
    })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'CREATE', entity: 'Attachment', entityId: attachment.id, details: `Attached ${attachment.docType} to ${entityType} ${entityId}` },
    })
    return NextResponse.json(attachment, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create attachment' }, { status: 400 })
  }
}
