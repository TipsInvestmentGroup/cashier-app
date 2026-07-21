// Attendance aggregation for the Universal Payroll Framework (Phase 4b). Turns
// per-day AttendanceRecord rows into the period-level variables the calc engine
// consumes: overtimeHours (drives RATE_QTY overtime) and unpaidDays (drives
// proration of proratable earnings). AttendanceRecord is the single source of
// truth; leave approval writes into it, so there is no dual-counting.
// See docs/payroll-framework-design.md §8.
import type { Db } from '@/lib/ledger'
import { roundMoney } from '@/lib/utils'

// Statuses that count as an UNPAID absence (reduce pay via proration).
const UNPAID_STATUSES = ['ABSENT', 'UNPAID_LEAVE']

export interface AttendanceAggregate {
  overtimeHours: number
  unpaidDays: number
  recordCount: number
}

/** Normalize a Date to midnight UTC (date-only key), so one calendar day = one row. */
export function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * Aggregate an employee's attendance across [start, end] (inclusive) into the
 * period variables. Unpaid days = count of ABSENT / UNPAID_LEAVE rows; overtime
 * = sum of overtimeHours. A HALF_DAY counts as 0.5 unpaid. No rows ⇒ zeros
 * (⇒ full-period pay, no overtime) — the same default the calc used pre-4b.
 */
export async function aggregateAttendance(db: Db, employeeId: string, start: Date, end: Date): Promise<AttendanceAggregate> {
  const rows = await db.attendanceRecord.findMany({
    where: { employeeId, date: { gte: dateOnly(start), lte: dateOnly(end) } },
    select: { status: true, overtimeHours: true },
  })
  let overtime = 0
  let unpaid = 0
  for (const r of rows) {
    overtime += r.overtimeHours || 0
    if (UNPAID_STATUSES.includes(r.status)) unpaid += 1
    else if (r.status === 'HALF_DAY') unpaid += 0.5
  }
  return { overtimeHours: roundMoney(overtime), unpaidDays: unpaid, recordCount: rows.length }
}

/** Upsert one day's attendance (latest write wins on the [employeeId, date] key). */
export async function upsertAttendance(db: Db, input: { employeeId: string; date: Date; status?: string; source?: string; hoursWorked?: number; overtimeHours?: number; outletId?: string | null; note?: string | null }) {
  const date = dateOnly(input.date)
  return db.attendanceRecord.upsert({
    where: { employeeId_date: { employeeId: input.employeeId, date } },
    update: { status: input.status, source: input.source, hoursWorked: input.hoursWorked, overtimeHours: input.overtimeHours, outletId: input.outletId ?? null, note: input.note ?? null },
    create: { employeeId: input.employeeId, date, status: input.status ?? 'PRESENT', source: input.source ?? 'MANUAL', hoursWorked: input.hoursWorked ?? 0, overtimeHours: input.overtimeHours ?? 0, outletId: input.outletId ?? null, note: input.note ?? null },
  })
}
