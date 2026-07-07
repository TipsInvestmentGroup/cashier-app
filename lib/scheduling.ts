// Staff scheduling domain logic — shift definitions and the transparent
// auto-scheduler heuristic. Kept pure (no DB access) so it's easy to test and
// reason about; the API route gathers data and calls generateWeekSchedule().

export type ShiftType = 'MORNING' | 'EVENING'

export const SHIFT_TYPES: ShiftType[] = ['MORNING', 'EVENING']

export const SHIFT_DEFS: Record<ShiftType, { label: string; start: string; end: string }> = {
  MORNING: { label: 'Morning', start: '09:00', end: '16:00' },
  EVENING: { label: 'Evening', start: '16:00', end: '05:00' },
}

// Roles a manager can assign on the roster (and at events, in Phase 2).
export const SCHEDULE_ROLES = ['WAITER', 'SUPERVISOR', 'BARTENDER', 'CASHIER', 'HOSTESS'] as const

// Roles auto-included as schedulable service staff for an outlet.
export const SERVICE_ROLES = ['WAITER']

// Who may generate/override schedules.
export const SCHEDULE_MANAGE_ROLES = ['MANAGER', 'DIRECTOR', 'ADMIN']

export const ABSENCE_REASONS = ['LEAVE', 'ABSENT', 'OTHER'] as const

// ── Event Management ──────────────────────────────────────────────────────
export const EVENT_STATUSES = ['PLANNED', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as const
export type EventStatus = typeof EVENT_STATUSES[number]
// Staff roles available at an event (same vocabulary as the roster).
export const EVENT_ROLES = SCHEDULE_ROLES
export const EVENT_TYPES = ['Wedding', 'Corporate', 'Concert', 'Private Party', 'Product Launch', 'Other'] as const
// Original short list kept alongside the fuller Phase 1 category set so
// expense lines recorded before this phase still validate.
export const EVENT_EXPENSE_CATEGORIES = [
  'Transport', 'Equipment Hire', 'Food & Drinks', 'Decor', 'Staff Allowance', 'Other',
  'Casual Labour', 'Staff Allowances', 'Security', 'Fuel', 'Decorations', 'Entertainment',
  'Marketing & Advertising', 'Equipment Rental', 'Cleaning', 'Licenses & Permits', 'Utilities', 'Miscellaneous Expenses',
] as const
export const EXPENSE_PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const
export const SPONSORSHIP_TYPES = ['CASH', 'IN_KIND', 'MEDIA', 'OTHER'] as const
export const SPONSOR_AGREEMENT_STATUSES = ['PENDING', 'SIGNED', 'FULFILLED'] as const
export const EVENT_TARGET_TYPES = ['SALES', 'PROCUREMENT'] as const

export interface SchedConfig {
  morningWeight: number
  eveningWeight: number
  weekendMultiplier: number
  daysOffPerWeek: number
}

export const DEFAULT_CONFIG: SchedConfig = {
  morningWeight: 1,
  eveningWeight: 1.6,
  weekendMultiplier: 1.4,
  daysOffPerWeek: 1,
}

export interface StaffInput {
  id: string
  name: string
  // Performance signal — historical collection actual (TZS) over a trailing
  // window. Higher = stronger performer; used to bias toward peak shifts.
  perf: number
}

// shiftType null = whole day off.
export interface UnavailInput {
  staffId: string
  dayIndex: number // 0..6 within the week
  shiftType: ShiftType | null
}

export interface GeneratedAssignment {
  dayIndex: number
  shiftType: ShiftType
  staffId: string
  staffName: string
  reason: string
}

const isWeekendDow = (dow: number) => dow === 5 || dow === 6 // Fri, Sat

/**
 * Generate a fair, performance-aware weekly roster for ONE outlet.
 *
 * Transparent heuristic, per day:
 *  1. Skip staff marked unavailable for the whole day; honour per-shift
 *     unavailability when placing the rest.
 *  2. Give each staff `daysOffPerWeek` rest days, staggered by staff index so
 *     not everyone rests the same day.
 *  3. Split the working staff between Morning and Evening in proportion to the
 *     expected-traffic weights (with a weekend uplift on Fri/Sat).
 *  4. Put the strongest performers on the busier (peak) shift so they get the
 *     most sales opportunity — but subtract a fairness penalty for every peak
 *     shift a staffer has already been given that week, so peak slots rotate.
 *
 * `weekDows[i]` is the JS day-of-week (0=Sun..6=Sat) for day i of the week,
 * letting the caller anchor the week on any start day.
 */
export function generateWeekSchedule(opts: {
  staff: StaffInput[]
  unavailable: UnavailInput[]
  config: SchedConfig
  weekDows: number[] // length 7
}): GeneratedAssignment[] {
  const { staff, unavailable, weekDows } = opts
  if (staff.length === 0) return []

  // Clamp defensively here too, not just at the API route that currently
  // calls this — daysOffPerWeek=7 would mark every staffer "resting" every
  // day of the week (nobody ever gets scheduled, with no error), and this
  // function is exported/reusable, so a future direct caller shouldn't have
  // to remember to re-implement the route's clamp.
  const config = { ...opts.config, daysOffPerWeek: Math.min(6, Math.max(0, Math.round(opts.config.daysOffPerWeek))) }

  // Normalize performance to 0..1 within the outlet (baseline 0.5 if all flat).
  const maxPerf = Math.max(0, ...staff.map((s) => s.perf))
  const perfScore = (s: StaffInput) => (maxPerf > 0 ? s.perf / maxPerf : 0.5)

  // Whole-day and per-shift unavailability lookups.
  const dayOff = new Set<string>() // `${staffId}:${dayIndex}`
  const shiftOff = new Set<string>() // `${staffId}:${dayIndex}:${shiftType}`
  for (const u of unavailable) {
    if (u.shiftType === null) dayOff.add(`${u.staffId}:${u.dayIndex}`)
    else shiftOff.add(`${u.staffId}:${u.dayIndex}:${u.shiftType}`)
  }

  // Rest days: stagger `daysOffPerWeek` per staff across the 7-day week.
  const restDays = new Map<string, Set<number>>()
  const step = Math.max(1, Math.floor(7 / Math.max(1, config.daysOffPerWeek)))
  staff.forEach((s, i) => {
    const set = new Set<number>()
    for (let k = 0; k < config.daysOffPerWeek; k++) set.add((i + k * step) % 7)
    restDays.set(s.id, set)
  })

  const peakGiven = new Map<string, number>() // fairness: peak shifts already assigned
  staff.forEach((s) => peakGiven.set(s.id, 0))
  const FAIRNESS = 0.35

  const out: GeneratedAssignment[] = []

  for (let d = 0; d < 7; d++) {
    const dow = weekDows[d]
    const wkndMult = isWeekendDow(dow) ? config.weekendMultiplier : 1
    const mW = config.morningWeight * wkndMult
    const eW = config.eveningWeight * wkndMult
    const peak: ShiftType = eW >= mW ? 'EVENING' : 'MORNING'
    const off: ShiftType = peak === 'EVENING' ? 'MORNING' : 'EVENING'

    // Working staff today: not whole-day unavailable and not resting.
    const working = staff.filter((s) => !dayOff.has(`${s.id}:${d}`) && !restDays.get(s.id)!.has(d))
    if (working.length === 0) continue

    const peakW = peak === 'EVENING' ? eW : mW
    const offW = off === 'EVENING' ? eW : mW
    // Both weights can be saved as 0 (a manager zeroing out traffic weights in
    // the config modal) — dividing by (peakW + offW) === 0 would produce NaN
    // and silently break the "at least one on peak" guarantee below. Fall
    // back to an even split when there's no usable weight signal.
    const totalW = peakW + offW
    let peakCount = totalW > 0 ? Math.round((working.length * peakW) / totalW) : Math.ceil(working.length / 2)
    peakCount = Math.min(working.length, Math.max(1, peakCount)) // at least one on peak

    // Forced placements from per-shift unavailability.
    const forcedPeak: StaffInput[] = []
    const forcedOff: StaffInput[] = []
    const flexible: StaffInput[] = []
    for (const s of working) {
      const canPeak = !shiftOff.has(`${s.id}:${d}:${peak}`)
      const canOff = !shiftOff.has(`${s.id}:${d}:${off}`)
      if (canPeak && !canOff) forcedPeak.push(s)
      else if (!canPeak && canOff) forcedOff.push(s)
      else if (!canPeak && !canOff) {/* unavailable both shifts → skip */}
      else flexible.push(s)
    }

    // Rank flexible staff for the peak shift: performance minus a fairness
    // penalty for peak shifts already received this week.
    flexible.sort((a, b) => {
      const sa = perfScore(a) - FAIRNESS * (peakGiven.get(a.id) || 0)
      const sb = perfScore(b) - FAIRNESS * (peakGiven.get(b.id) || 0)
      return sb - sa
    })

    const remainingPeak = Math.max(0, peakCount - forcedPeak.length)
    const toPeak = [...forcedPeak, ...flexible.slice(0, remainingPeak)]
    const toOff = [...forcedOff, ...flexible.slice(remainingPeak)]

    for (const s of toPeak) {
      peakGiven.set(s.id, (peakGiven.get(s.id) || 0) + 1)
      out.push({
        dayIndex: d, shiftType: peak, staffId: s.id, staffName: s.name,
        reason: `Peak ${SHIFT_DEFS[peak].label} — performer (${Math.round(perfScore(s) * 100)}%)${isWeekendDow(dow) ? ', weekend' : ''}`,
      })
    }
    for (const s of toOff) {
      out.push({
        dayIndex: d, shiftType: off, staffId: s.id, staffName: s.name,
        reason: `${SHIFT_DEFS[off].label} cover (perf ${Math.round(perfScore(s) * 100)}%)`,
      })
    }
  }

  return out
}
