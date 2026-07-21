// Financial Period Management — Stage 4. Periods can nest (a MONTHLY period
// inside its QUARTERLY, inside its ANNUAL "financial year"); lib/ledger.ts's
// assertPeriodOpen() already checks every period covering a date, so locking
// at any level blocks posting into it.
//
// The 12 MONTHLY periods (and, so they nest cleanly, the quarter/annual
// boundaries) follow the configured Financial Month start day from the
// Business Period engine — a "25th → 24th" business books its accounting months
// as 25 Jun → 24 Jul, not 1–31. When the start day is 1 (default / zero-config)
// this reduces to calendar months, byte-identical to the previous behaviour.
import { format } from 'date-fns'
import { prisma } from './prisma'
import { resolveEffectivePeriodFields } from './business-periods'
import { generateMonthlyPeriods, monthlyPeriodForDate } from './business-periods-shared'

export const PERIOD_TYPES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const
export type PeriodType = (typeof PERIOD_TYPES)[number]

/** End-of-day of the inclusive last day, for a period's stored endDate. */
function endOfDay(d: Date): Date {
  const e = new Date(d)
  e.setHours(23, 59, 59, 999)
  return e
}

/**
 * "Financial Year Management" — generates the full standard set (1 ANNUAL +
 * 4 QUARTERLY + 12 MONTHLY, all OPEN, all nested under the year) for a
 * company in one action, instead of creating 17 periods by hand. Safe to
 * call repeatedly / after partial setup — skips any period whose name
 * already exists (the @@unique([companyId, name]) constraint) rather than
 * erroring the whole batch.
 *
 * The 12 months align to the company's configured Financial Month start day
 * (resolved effective as of `yearStartDate`); the year is anchored to the start
 * of the financial month containing `yearStartDate` so every month nests inside
 * exactly one quarter and the annual period.
 */
export async function generateFinancialYearPeriods(companyId: string, yearStartDate: Date): Promise<{ created: number; skipped: number }> {
  let created = 0
  let skipped = 0

  const { financialMonthStartDay } = await resolveEffectivePeriodFields({ companyId, date: yearStartDate })

  // Anchor the year to the financial-month boundary so nesting is exact.
  const fyStart = monthlyPeriodForDate(yearStartDate, financialMonthStartDay).start
  const months = generateMonthlyPeriods(fyStart, financialMonthStartDay, 12)

  // Label the financial year by the intended start year the caller passed.
  const yearLabel = format(yearStartDate, 'yyyy')

  const upsertPeriod = async (name: string, periodType: PeriodType, startDate: Date, endDate: Date, parentPeriodId: string | null) => {
    const existing = await prisma.financialPeriod.findUnique({ where: { companyId_name: { companyId, name } } })
    if (existing) { skipped++; return existing }
    created++
    return prisma.financialPeriod.create({ data: { companyId, name, periodType, startDate, endDate, parentPeriodId } })
  }

  const annual = await upsertPeriod(`FY${yearLabel}`, 'ANNUAL', months[0].start, endOfDay(months[11].end), null)

  for (let q = 0; q < 4; q++) {
    const qMonths = months.slice(q * 3, q * 3 + 3)
    const quarter = await upsertPeriod(`FY${yearLabel}-Q${q + 1}`, 'QUARTERLY', qMonths[0].start, endOfDay(qMonths[2].end), annual.id)

    for (const m of qMonths) {
      // Name by the period's end-month key (e.g. "2026-07" for 25 Jun → 24 Jul),
      // which is exactly "yyyy-MM" for calendar months — no name collisions.
      await upsertPeriod(m.key, 'MONTHLY', m.start, endOfDay(m.end), quarter.id)
    }
  }

  return { created, skipped }
}
