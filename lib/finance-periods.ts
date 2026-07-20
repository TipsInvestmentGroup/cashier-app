// Financial Period Management — Stage 4. Periods can nest (a MONTHLY period
// inside its QUARTERLY, inside its ANNUAL "financial year"); lib/ledger.ts's
// assertPeriodOpen() already checks every period covering a date, so locking
// at any level blocks posting into it.
import { startOfMonth, endOfMonth, addMonths, addYears, subDays, format } from 'date-fns'
import { prisma } from './prisma'

export const PERIOD_TYPES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const
export type PeriodType = (typeof PERIOD_TYPES)[number]

/**
 * "Financial Year Management" — generates the full standard set (1 ANNUAL +
 * 4 QUARTERLY + 12 MONTHLY, all OPEN, all nested under the year) for a
 * company in one action, instead of creating 17 periods by hand. Safe to
 * call repeatedly / after partial setup — skips any period whose name
 * already exists (the @@unique([companyId, name]) constraint) rather than
 * erroring the whole batch.
 */
export async function generateFinancialYearPeriods(companyId: string, yearStartDate: Date): Promise<{ created: number; skipped: number }> {
  let created = 0
  let skipped = 0

  const yearLabel = format(yearStartDate, 'yyyy')
  const yearEnd = subDays(addYears(yearStartDate, 1), 1)

  const upsertPeriod = async (name: string, periodType: PeriodType, startDate: Date, endDate: Date, parentPeriodId: string | null) => {
    const existing = await prisma.financialPeriod.findUnique({ where: { companyId_name: { companyId, name } } })
    if (existing) { skipped++; return existing }
    created++
    return prisma.financialPeriod.create({ data: { companyId, name, periodType, startDate, endDate, parentPeriodId } })
  }

  const annual = await upsertPeriod(`FY${yearLabel}`, 'ANNUAL', yearStartDate, yearEnd, null)

  for (let q = 0; q < 4; q++) {
    const qStart = addMonths(yearStartDate, q * 3)
    const qEnd = subDays(addMonths(qStart, 3), 1)
    const quarter = await upsertPeriod(`FY${yearLabel}-Q${q + 1}`, 'QUARTERLY', qStart, qEnd, annual.id)

    for (let m = 0; m < 3; m++) {
      const mStart = startOfMonth(addMonths(qStart, m))
      const mEnd = endOfMonth(mStart)
      await upsertPeriod(format(mStart, 'yyyy-MM'), 'MONTHLY', mStart, mEnd, quarter.id)
    }
  }

  return { created, skipped }
}
