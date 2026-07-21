// Leave engine for the Universal Payroll Framework (Phase 4b). Requests move
// through a role-gated approval; approving decrements the employee's balance and
// writes the leave days as AttendanceRecord rows (PAID_LEAVE counts as worked;
// UNPAID_LEAVE prorates pay down via the attendance aggregator) — one source of
// truth, no dual-counting. Accrual tops up balances per the leave type's monthly
// rate (capped by carry-forward). See docs/payroll-framework-design.md §8.
import type { Db } from '@/lib/ledger'
import { roundMoney } from '@/lib/utils'
import { dateOnly } from '@/lib/payroll-attendance'

export interface LeaveUser { userId: string; role: string; name?: string | null }
export const DEFAULT_LEAVE_APPROVERS = ['MANAGER', 'DIRECTOR', 'ADMIN']

/** Inclusive list of calendar days between two dates (date-only, UTC). */
function daysBetween(start: Date, end: Date): Date[] {
  const out: Date[] = []
  let cur = dateOnly(start)
  const last = dateOnly(end)
  while (cur.getTime() <= last.getTime()) {
    out.push(cur)
    cur = new Date(cur.getTime() + 86_400_000)
  }
  return out
}

/** Create a PENDING leave request. `days` defaults to the inclusive calendar span. */
export async function createLeaveRequest(db: Db, input: { employeeId: string; leaveTypeId: string; startDate: Date; endDate: Date; days?: number; reason?: string; user: LeaveUser }) {
  if (dateOnly(input.endDate).getTime() < dateOnly(input.startDate).getTime()) throw new Error('endDate must be on or after startDate')
  const emp = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } })
  if (!emp) throw new Error('Employee not found')
  const type = await db.leaveType.findUnique({ where: { id: input.leaveTypeId }, select: { id: true, status: true } })
  if (!type || type.status !== 'ACTIVE') throw new Error('Leave type not found or inactive')
  const days = input.days ?? daysBetween(input.startDate, input.endDate).length
  return db.leaveRequest.create({
    data: { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, startDate: dateOnly(input.startDate), endDate: dateOnly(input.endDate), days, reason: input.reason ?? null, status: 'PENDING', requestedById: input.user.userId },
  })
}

async function approverRolesFor(db: Db, leaveTypeId: string): Promise<string[]> {
  const t = await db.leaveType.findUnique({ where: { id: leaveTypeId }, select: { approverRoles: true } })
  if (t?.approverRoles) {
    try { const roles = JSON.parse(t.approverRoles) as string[]; if (Array.isArray(roles) && roles.length) return roles } catch { /* fall through */ }
  }
  return DEFAULT_LEAVE_APPROVERS
}

/**
 * Approve / reject / cancel a leave request. On APPROVE (role-gated; ADMIN
 * overrides): inside a transaction, mark APPROVED, bump LeaveBalance.taken, and
 * write one AttendanceRecord per leave day (PAID_LEAVE or UNPAID_LEAVE by type).
 */
export async function transitionLeaveRequest(db: Db, requestId: string, action: 'approve' | 'reject' | 'cancel', user: LeaveUser, reason?: string) {
  const reqRow = await db.leaveRequest.findUnique({ where: { id: requestId }, include: { leaveType: true } })
  if (!reqRow) throw new Error('Leave request not found')
  if (reqRow.status !== 'PENDING') throw new Error(`Cannot ${action} a request in status ${reqRow.status}`)

  if (action === 'reject') return db.leaveRequest.update({ where: { id: requestId }, data: { status: 'REJECTED', approvedById: user.userId, approvedAt: new Date() } })
  if (action === 'cancel') return db.leaveRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED' } })

  // approve
  const roles = await approverRolesFor(db, reqRow.leaveTypeId)
  if (user.role !== 'ADMIN' && !roles.includes(user.role)) throw new Error(`Your role (${user.role}) is not authorized to approve this leave`)

  const client = db as unknown as { $transaction?: <T>(fn: (tx: Db) => Promise<T>) => Promise<T> }
  const work = async (tx: Db) => {
    // balance: create-if-absent then increment taken
    const bal = await tx.leaveBalance.findUnique({ where: { employeeId_leaveTypeId: { employeeId: reqRow.employeeId, leaveTypeId: reqRow.leaveTypeId } } })
    if (bal) await tx.leaveBalance.update({ where: { id: bal.id }, data: { taken: roundMoney(bal.taken + reqRow.days) } })
    else await tx.leaveBalance.create({ data: { employeeId: reqRow.employeeId, leaveTypeId: reqRow.leaveTypeId, accrued: 0, taken: reqRow.days } })

    // write leave days into attendance (single source for the aggregator)
    const status = reqRow.leaveType.paid ? 'PAID_LEAVE' : 'UNPAID_LEAVE'
    for (const day of daysBetween(reqRow.startDate, reqRow.endDate)) {
      await tx.attendanceRecord.upsert({
        where: { employeeId_date: { employeeId: reqRow.employeeId, date: day } },
        update: { status, source: 'MANUAL', note: `Leave: ${reqRow.leaveType.name}` },
        create: { employeeId: reqRow.employeeId, date: day, status, source: 'MANUAL', note: `Leave: ${reqRow.leaveType.name}` },
      })
    }
    return tx.leaveRequest.update({ where: { id: requestId }, data: { status: 'APPROVED', approvedById: user.userId, approvedAt: new Date(), reason: reason ?? reqRow.reason } })
  }
  // Call $transaction directly on the client so `this` stays bound; fall back to
  // running inline when a transaction client (no $transaction) was passed in.
  return typeof client.$transaction === 'function' ? client.$transaction(work) : work(db)
}

/**
 * Accrue leave for one employee (or all active employees when employeeId is
 * omitted): add each active leave type's monthly rate to the balance, capped by
 * maxCarryForward. Idempotent per call is NOT guaranteed — run it once per
 * period (e.g. at period close). Returns the number of balances touched.
 */
export async function accrueLeave(db: Db, opts: { companyId: string; employeeId?: string } = { companyId: '' }): Promise<number> {
  const types = await db.leaveType.findMany({ where: { companyId: opts.companyId, status: 'ACTIVE', accrualDaysPerMonth: { gt: 0 } } })
  if (!types.length) return 0
  const employees = opts.employeeId
    ? [{ id: opts.employeeId }]
    : await db.employee.findMany({ where: { companyId: opts.companyId, status: 'ACTIVE' }, select: { id: true } })
  let touched = 0
  for (const emp of employees) {
    for (const t of types) {
      const bal = await db.leaveBalance.findUnique({ where: { employeeId_leaveTypeId: { employeeId: emp.id, leaveTypeId: t.id } } })
      const currentAccrued = bal?.accrued ?? 0
      let next = roundMoney(currentAccrued + t.accrualDaysPerMonth)
      if (t.maxCarryForward != null) next = Math.min(next, t.maxCarryForward + (bal?.taken ?? 0))
      if (bal) await db.leaveBalance.update({ where: { id: bal.id }, data: { accrued: next } })
      else await db.leaveBalance.create({ data: { employeeId: emp.id, leaveTypeId: t.id, accrued: next, taken: 0 } })
      touched++
    }
  }
  return touched
}
