import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance, canManageFinance } from '@/lib/finance-access'
import { RESOURCES } from '@/lib/rbac'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { postBankTransaction, BANK_TRANSACTION_TYPES } from '@/lib/finance-banking'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json([])

  const txns = await prisma.bankTransaction.findMany({
    where: { companyId },
    include: { fromAccount: true, toAccount: true },
    orderBy: { transactionDate: 'desc' },
    take: 200,
  })
  return NextResponse.json(txns)
}

/** Record a transfer/deposit/withdrawal/bank charge/interest movement. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_BANKING))) {
    return NextResponse.json({ error: 'You are not authorized to record bank transactions' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { type, fromAccountId, toAccountId, amount, transactionDate, reference, note } = body
  if (!BANK_TRANSACTION_TYPES.includes(type)) return NextResponse.json({ error: 'Invalid transaction type' }, { status: 400 })
  if (!(Number(amount) > 0)) return NextResponse.json({ error: 'A positive amount is required' }, { status: 400 })
  const companyId = body.companyId || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 })

  try {
    const txn = await postBankTransaction({
      companyId, type, fromAccountId: fromAccountId || null, toAccountId: toAccountId || null,
      amount: Number(amount), transactionDate: transactionDate ? new Date(transactionDate) : new Date(),
      reference: reference || null, note: note || null, createdById: user.userId,
    })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'BankTransaction', entityId: txn.id, details: `${type} of ${amount}` } })
    return NextResponse.json(txn, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not record this transaction' }, { status: 400 })
  }
}
