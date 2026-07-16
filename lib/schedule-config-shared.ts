// Company-wide scheduling policy: shift display times and which weekdays
// count as "weekend" for the auto-scheduler's traffic uplift. Client-safe
// (no prisma) — see lib/schedule-config-db.ts for the server-side cached
// loader. The two-shift MORNING/EVENING structure itself stays fixed engine
// logic (lib/scheduling.ts) — only the times/weekend days are configurable.

export type ShiftType = 'MORNING' | 'EVENING'

export interface ShiftDef { label: string; start: string; end: string }

export interface ScheduleConfig {
  shiftDefs: Record<ShiftType, ShiftDef>
  weekendDows: number[] // JS day-of-week: 0=Sun..6=Sat
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  shiftDefs: {
    MORNING: { label: 'Morning', start: '09:00', end: '16:00' },
    EVENING: { label: 'Evening', start: '16:00', end: '05:00' },
  },
  weekendDows: [5, 6], // Fri, Sat
}

export function normalizeScheduleConfig(raw: unknown): ScheduleConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const shiftDefs = { ...DEFAULT_SCHEDULE_CONFIG.shiftDefs }
  const rd = r.shiftDefs as Record<string, Partial<ShiftDef>> | undefined
  if (rd && typeof rd === 'object') {
    for (const k of ['MORNING', 'EVENING'] as ShiftType[]) {
      const d = rd[k]
      if (d && typeof d === 'object') {
        shiftDefs[k] = {
          label: typeof d.label === 'string' && d.label.trim() ? d.label.trim() : shiftDefs[k].label,
          start: typeof d.start === 'string' && d.start.trim() ? d.start.trim() : shiftDefs[k].start,
          end: typeof d.end === 'string' && d.end.trim() ? d.end.trim() : shiftDefs[k].end,
        }
      }
    }
  }
  const wd = Array.isArray(r.weekendDows) ? r.weekendDows.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : null
  return { shiftDefs, weekendDows: wd && wd.length ? [...new Set(wd)] : [...DEFAULT_SCHEDULE_CONFIG.weekendDows] }
}
