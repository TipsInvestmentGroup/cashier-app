import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'

// Edit one employee. Identity links (userId) are NOT re-pointable here — that's a
// re-hire/merge concern, not an edit — but a Person can be attached to an existing
// (user-only) employee, which is the curated User↔Person link Phase 3 needs to
// settle a person's signed bills through payroll. Management-gated.
const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
const STATUSES = ['ACTIVE', 'PROBATION', 'SUSPENDED', 'ON_LEAVE', 'TERMINATED']
const PAYMENT_METHODS = ['BANK', 'MOBILE_MONEY', 'CASH']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.employee.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (body.categoryId !== undefined) {
    const cat = await prisma.employeeCategory.findUnique({ where: { id: body.categoryId }, select: { id: true } })
    if (!cat) return NextResponse.json({ error: 'Category not found' }, { status: 400 })
    data.categoryId = body.categoryId
  }
  if (body.payGroupId !== undefined) {
    const pg = await prisma.payGroup.findUnique({ where: { id: body.payGroupId }, select: { id: true } })
    if (!pg) return NextResponse.json({ error: 'Pay group not found' }, { status: 400 })
    data.payGroupId = body.payGroupId
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return NextResponse.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 })
    data.status = body.status
    // Stamp/clear the termination date to match the lifecycle state.
    if (body.status === 'TERMINATED' && !existing.terminationDate) data.terminationDate = new Date()
    if (body.status !== 'TERMINATED' && existing.terminationDate) data.terminationDate = null
  }
  if (body.paymentMethod !== undefined) {
    if (!PAYMENT_METHODS.includes(body.paymentMethod)) return NextResponse.json({ error: `paymentMethod must be one of ${PAYMENT_METHODS.join(', ')}` }, { status: 400 })
    data.paymentMethod = body.paymentMethod
  }
  if (body.baseSalary !== undefined) {
    const n = Number(body.baseSalary)
    if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'baseSalary must be a non-negative number' }, { status: 400 })
    data.baseSalary = n
  }
  if (body.baseCurrency !== undefined) data.baseCurrency = String(body.baseCurrency).trim() || 'TZS'
  if (body.employeeNumber !== undefined) data.employeeNumber = body.employeeNumber ? String(body.employeeNumber).trim() : null
  if (body.bankRef !== undefined) data.bankRef = body.bankRef ? String(body.bankRef).trim() : null
  if (body.mobileMoneyRef !== undefined) data.mobileMoneyRef = body.mobileMoneyRef ? String(body.mobileMoneyRef).trim() : null
  if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null
  if (body.hireDate !== undefined) data.hireDate = body.hireDate ? new Date(body.hireDate) : null

  // Attach a Person (curated link) — only when the slot is currently empty and
  // the person isn't already linked elsewhere.
  if (body.personId !== undefined && body.personId) {
    if (existing.personId && existing.personId !== body.personId) {
      return NextResponse.json({ error: 'This employee is already linked to a different person; unlink first' }, { status: 409 })
    }
    const taken = await prisma.employee.findUnique({ where: { personId: body.personId } })
    if (taken && taken.id !== id) return NextResponse.json({ error: 'That person is already linked to another employee' }, { status: 409 })
    data.personId = body.personId
  } else if (body.personId === null) {
    data.personId = null
  }

  const updated = await prisma.employee.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'Employee', entityId: id, details: 'Updated employee' },
  })
  return NextResponse.json({ employee: updated })
}
