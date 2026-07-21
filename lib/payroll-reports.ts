// Payroll reports for the Universal Payroll Framework (Phase 5). All read the
// materialized run/payslip totals + the append-only PayslipLine ledger — never
// re-aggregating raw source history. See docs/payroll-framework-design.md §10.
import type { Db } from '@/lib/ledger'
import { roundMoney } from '@/lib/utils'

/**
 * Payroll register — one row per employee (gross / deductions / net / employer)
 * plus per-component totals across the run and grand totals.
 */
export async function payrollRegister(db: Db, runId: string) {
  const run = await db.payrollRun.findUnique({ where: { id: runId } })
  if (!run) throw new Error('Run not found')
  const payslips = await db.payslip.findMany({ where: { runId }, include: { lines: { orderBy: { sortOrder: 'asc' } } }, orderBy: { createdAt: 'asc' } })

  const employees = payslips.map((s) => ({
    payslipId: s.id, employeeId: s.employeeId, employeeNumber: s.employeeNumber,
    gross: s.gross, taxable: s.taxable, totalDeductions: s.totalDeductions, net: s.net, employerCost: s.employerCost, status: s.status,
  }))

  // Per-component totals (by code + bucket).
  const compMap = new Map<string, { code: string; name: string; bucket: string; total: number; count: number }>()
  for (const s of payslips) {
    for (const l of s.lines) {
      const cur = compMap.get(l.componentCode) || { code: l.componentCode, name: l.componentName, bucket: l.bucket, total: 0, count: 0 }
      cur.total = roundMoney(cur.total + l.amount)
      cur.count += 1
      compMap.set(l.componentCode, cur)
    }
  }

  return {
    run: { id: run.id, periodKey: run.periodKey, status: run.status, currency: run.currency },
    employees,
    components: [...compMap.values()].sort((a, b) => a.bucket.localeCompare(b.bucket) || b.total - a.total),
    totals: { gross: run.totalGross, deductions: run.totalDeductions, net: run.totalNet, employerCost: run.totalEmployerCost, employeeCount: run.employeeCount, totalCost: roundMoney(run.totalGross + run.totalEmployerCost) },
  }
}

/**
 * Statutory report — totals per STATUTORY / EMPLOYER_CONTRIBUTION component
 * across the run (what to remit to each authority), with employee counts.
 */
export async function statutoryReport(db: Db, runId: string) {
  const run = await db.payrollRun.findUnique({ where: { id: runId } })
  if (!run) throw new Error('Run not found')
  const lines = await db.payslipLine.findMany({
    where: { payslip: { runId }, componentType: { in: ['STATUTORY', 'EMPLOYER_CONTRIBUTION'] } },
    select: { componentCode: true, componentName: true, componentType: true, amount: true },
  })
  const map = new Map<string, { code: string; name: string; type: string; total: number; count: number }>()
  for (const l of lines) {
    const cur = map.get(l.componentCode) || { code: l.componentCode, name: l.componentName, type: l.componentType, total: 0, count: 0 }
    cur.total = roundMoney(cur.total + l.amount)
    cur.count += 1
    map.set(l.componentCode, cur)
  }
  const items = [...map.values()].sort((a, b) => b.total - a.total)
  return { run: { id: run.id, periodKey: run.periodKey }, items, total: roundMoney(items.reduce((s, i) => s + i.total, 0)) }
}

/** Variance between two runs (b − a) on the headline totals. */
export async function payrollVariance(db: Db, runIdA: string, runIdB: string) {
  const [a, b] = await Promise.all([
    db.payrollRun.findUnique({ where: { id: runIdA } }),
    db.payrollRun.findUnique({ where: { id: runIdB } }),
  ])
  if (!a || !b) throw new Error('Run not found')
  const delta = (x: number, y: number) => ({ from: x, to: y, change: roundMoney(y - x), pct: x !== 0 ? roundMoney(((y - x) / x) * 100) : null })
  return {
    from: { id: a.id, periodKey: a.periodKey },
    to: { id: b.id, periodKey: b.periodKey },
    gross: delta(a.totalGross, b.totalGross),
    deductions: delta(a.totalDeductions, b.totalDeductions),
    net: delta(a.totalNet, b.totalNet),
    employerCost: delta(a.totalEmployerCost, b.totalEmployerCost),
    headcount: delta(a.employeeCount, b.employeeCount),
  }
}
