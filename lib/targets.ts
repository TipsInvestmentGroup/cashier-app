// Standardized sales-target reference data (from management's TARGET SYSTEM).
//
// Every target follows a consistent rule set, so we store only the weekly
// target (a 7-day figure) and derive the rest:
//   • Daily rate              = Weekly ÷ 7
//   • Monthly target          = Daily rate × days in the respective month (28/29/30/31)
//   • Issue-letter threshold  = Target ÷ 3   (≈ 33% — performance below this earns a warning letter)
//   • Reward consideration    = Target × 0.8 (80% — at/above this the staff/outlet is considered for a reward)
//   • Reward amount           = To be defined by management

export type TargetUnit = 'TZS' | 'COUNT'

export interface TargetDef {
  outlet: 'Mikocheni' | 'Coco'
  scope: 'Per Staff' | 'Per Outlet' | 'Per Manager'
  department: 'Total Collection' | 'Shisha Sales' | 'Food Sales'
  unit: TargetUnit
  weeklyTarget: number
}

export const TARGETS: TargetDef[] = [
  { outlet: 'Mikocheni', scope: 'Per Staff', department: 'Total Collection', unit: 'TZS', weeklyTarget: 12_000_000 },
  { outlet: 'Mikocheni', scope: 'Per Staff', department: 'Shisha Sales', unit: 'COUNT', weeklyTarget: 15 },
  { outlet: 'Mikocheni', scope: 'Per Outlet', department: 'Total Collection', unit: 'TZS', weeklyTarget: 125_000_000 },
  { outlet: 'Mikocheni', scope: 'Per Outlet', department: 'Shisha Sales', unit: 'COUNT', weeklyTarget: 150 },
  { outlet: 'Coco', scope: 'Per Staff', department: 'Total Collection', unit: 'TZS', weeklyTarget: 10_000_000 },
  { outlet: 'Coco', scope: 'Per Staff', department: 'Food Sales', unit: 'TZS', weeklyTarget: 500_000 },
  { outlet: 'Coco', scope: 'Per Manager', department: 'Total Collection', unit: 'TZS', weeklyTarget: 100_000_000 },
  { outlet: 'Coco', scope: 'Per Outlet', department: 'Food Sales', unit: 'TZS', weeklyTarget: 5_000_000 },
]

export const LETTER_RATIO = 1 / 3
export const REWARD_RATIO = 0.8

/**
 * Derive the standardized levels for a target at a given period.
 * Weekly = the stored 7-day figure. Monthly = daily rate × daysInMonth
 * (defaults to 30 if not supplied).
 */
export function targetLevels(t: TargetDef, period: 'weekly' | 'monthly', daysInMonth = 30) {
  const days = period === 'monthly' ? daysInMonth : 7
  const target = Math.round((t.weeklyTarget / 7) * days)
  return {
    target,
    letterBelow: Math.round(target * LETTER_RATIO),
    rewardFrom: Math.round(target * REWARD_RATIO),
  }
}

/** Format a target value by its unit. */
export function fmtTarget(v: number, unit: TargetUnit): string {
  if (unit === 'COUNT') return `${v.toLocaleString()} shisha`
  return 'TSh ' + v.toLocaleString('en-US')
}
