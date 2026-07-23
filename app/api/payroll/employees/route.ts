import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { resolveCompanyId } from '@/lib/payroll-config'

// The Employee master (Payroll Framework Phase 1). Read/write is management-gated
// — the same oversight roles that run payroll. Employee is the compensation
// identity that unifies a login (User, bare scalar) and a party (Person, relation);
// at least one link is required, enforced here in app code (the schema keeps both
// nullable). Names are resolved from person → user for display.
const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
const STATUSES = ['ACTIVE', 'PROBATION', 'SUSPENDED', 'ON_LEAVE', 'TERMINATED']
const PAYMENT_METHODS = ['BANK', 'MOBILE_MONEY', 'CASH']

/** GET — the employee roster plus the category & pay-group lookups the list and
 *  editor need (both small, company-scoped). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const companyId = await resolveCompanyId(prisma, null)

  const [employees, categories, payGroups] = await Promise.all([
    prisma.employee.findMany({
      include: { category: true, payGroup: true, person: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.employeeCategory.findMany({ where: companyId ? { companyId } : {}, orderBy: { priority: 'asc' } }),
    prisma.payGroup.findMany({ where: companyId ? { companyId } : {}, orderBy: { priority: 'asc' } }),
  ])

  // userId is a bare scalar (no relation, to keep the User model untouched), so
  // resolve the login names in one batch.
  const userIds = employees.map((e) => e.userId).filter((id): id is string => !!id)
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true, role: true } })
    : []
  const userById = new Map(users.map((u) => [u.id, u]))

  const rows = employees.map((e) => {
    const u = e.userId ? userById.get(e.userId) : null
    return {
      id: e.id,
      name: e.person?.name || u?.name || e.employeeNumber || 'Unnamed',
      employeeNumber: e.employeeNumber,
      categoryId: e.categoryId,
      categoryName: e.category?.name || '',
      payGroupId: e.payGroupId,
      payGroupName: e.payGroup?.name || '',
      baseSalary: e.baseSalary,
      baseCurrency: e.baseCurrency,
      paymentMethod: e.paymentMethod,
      bankRef: e.bankRef,
      mobileMoneyRef: e.mobileMoneyRef,
      status: e.status,
      userId: e.userId,
      userName: u?.name || null,
      userRole: u?.role || null,
      personId: e.personId,
      personName: e.person?.name || null,
      outletId: e.outletId,
      hireDate: e.hireDate,
      notes: e.notes,
    }
  })

  return NextResponse.json({ employees: rows, categories, payGroups })
}

/** POST — create one employee. Requires at least one identity link (userId or
 *  personId) and a valid category + pay group. Both links are unique, so a User
 *  or Person already attached to an employee is rejected. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const userId = body.userId ? String(body.userId) : null
  const personId = body.personId ? String(body.personId) : null
  if (!userId && !personId) {
    return NextResponse.json({ error: 'An employee must be linked to a user account and/or a person record' }, { status: 400 })
  }
  if (!body.categoryId || !body.payGroupId) {
    return NextResponse.json({ error: 'Category and pay group are required' }, { status: 400 })
  }
  if (body.paymentMethod !== undefined && !PAYMENT_METHODS.includes(body.paymentMethod)) {
    return NextResponse.json({ error: `paymentMethod must be one of ${PAYMENT_METHODS.join(', ')}` }, { status: 400 })
  }
  if (body.status !== undefined && !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 })
  }

  // Guard the unique links (nicer message than the raw P2002).
  if (userId && (await prisma.employee.findUnique({ where: { userId } }))) {
    return NextResponse.json({ error: 'That user is already linked to an employee' }, { status: 409 })
  }
  if (personId && (await prisma.employee.findUnique({ where: { personId } }))) {
    return NextResponse.json({ error: 'That person is already linked to an employee' }, { status: 409 })
  }

  const category = await prisma.employeeCategory.findUnique({ where: { id: body.categoryId }, select: { companyId: true } })
  if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 400 })
  const payGroup = await prisma.payGroup.findUnique({ where: { id: body.payGroupId }, select: { id: true } })
  if (!payGroup) return NextResponse.json({ error: 'Pay group not found' }, { status: 400 })

  // Outlet defaults from the linked user's outlet when not supplied.
  let outletId = body.outletId ? String(body.outletId) : null
  if (!outletId && userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { outletId: true } })
    outletId = u?.outletId ?? null
  }

  const created = await prisma.employee.create({
    data: {
      userId,
      personId,
      employeeNumber: body.employeeNumber ? String(body.employeeNumber).trim() : null,
      categoryId: body.categoryId,
      payGroupId: body.payGroupId,
      companyId: category.companyId,
      outletId,
      status: body.status || 'ACTIVE',
      baseCurrency: body.baseCurrency ? String(body.baseCurrency).trim() : 'TZS',
      baseSalary: Number.isFinite(Number(body.baseSalary)) ? Number(body.baseSalary) : 0,
      paymentMethod: body.paymentMethod || 'BANK',
      bankRef: body.bankRef ? String(body.bankRef).trim() : null,
      mobileMoneyRef: body.mobileMoneyRef ? String(body.mobileMoneyRef).trim() : null,
      notes: body.notes ? String(body.notes).trim() : null,
      hireDate: body.hireDate ? new Date(body.hireDate) : null,
    },
  })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'Employee', entityId: created.id, details: 'Created employee' },
  })
  return NextResponse.json({ employee: created }, { status: 201 })
}
