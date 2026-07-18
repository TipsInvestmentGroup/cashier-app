import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { createStaffTransaction, categoryNeedsApproval, notifyApprovers, APPROVER_ROLE } from '@/lib/staff-transaction-submit'

const CATEGORIES = ['PAYMENT', 'SIGNED_BILL', 'DISCOUNT', 'CANCELLATION', 'CREDIT_SALE']

/** GET — the caller's own declared transactions for a session. ?sessionId= */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sessionId = new URL(req.url).searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const rows = await prisma.staffTransaction.findMany({
    where: { sessionId, staffId: user.userId },
    include: { approvals: { select: { status: true, comment: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(rows)
}

/** POST — declare one transaction. Body: { sessionId, category, paymentMethod?, amount, receivingAccount?, reference?, personName? } */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '')
  const category = CATEGORIES.includes(body.category) ? body.category : 'PAYMENT'
  const amount = roundMoney(Number(body.amount) || 0)
  const paymentMethod = body.paymentMethod ? String(body.paymentMethod) : null
  const receivingAccount = body.receivingAccount ? String(body.receivingAccount) : null
  const reference = body.reference ? String(body.reference) : null
  const personName = body.personName ? String(body.personName).trim() : null

  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  if (amount <= 0) return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 })
  if (category === 'PAYMENT' && !paymentMethod) return NextResponse.json({ error: 'Payment method required' }, { status: 400 })
  if ((category === 'SIGNED_BILL' || category === 'CREDIT_SALE') && !personName) {
    return NextResponse.json({ error: 'Payer/customer name required' }, { status: 400 })
  }

  const session = await prisma.transactionSession.findUnique({ where: { id: sessionId } })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.status !== 'OPEN') return NextResponse.json({ error: 'This session is no longer open for new transactions' }, { status: 409 })

  const transaction = await prisma.$transaction((tx) =>
    createStaffTransaction({ tx, sessionId, staffId: user.userId, category, paymentMethod, amount, receivingAccount, reference, personName }),
  )

  if (categoryNeedsApproval(category)) {
    notifyApprovers(APPROVER_ROLE, {
      title: 'Transaction needs approval',
      body: `${user.name}: ${category.replace('_', ' ')} of ${amount}`,
      url: '/collection-approvals',
    })
  }

  return NextResponse.json(transaction)
}
