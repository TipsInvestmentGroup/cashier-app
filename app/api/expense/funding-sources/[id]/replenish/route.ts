import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { replenishFundingSource } from '@/lib/expense-ledger'

const ALLOWED = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

/** POST — allocate funds to a CASH/OTHER funding source's custodian (Petty
 *  Cash Ledger scenario B's "Funds Received"). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const amount = Number(body.amount)
  if (!amount || amount <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 })

  try {
    const source = await replenishFundingSource({
      fundingSourceId: id, amount,
      reference: body.reference ? String(body.reference) : null,
      note: body.note ? String(body.note) : null,
      createdById: user.userId, createdByName: user.name,
    })
    return NextResponse.json(source, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not replenish funding source' }, { status: 400 })
  }
}
