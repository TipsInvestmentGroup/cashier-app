// Sales-target domain math, shared by server routes and the Targets page.
// The target DATA lives in the SalesTarget table (managed on /targets by an
// Admin; see lib/sales-targets.ts for the server loader) — this file holds
// only the pure derivation rules, which are core engine logic:
//   • Daily rate              = Weekly ÷ 7
//   • Monthly target          = Daily rate × days in the respective month (28/29/30/31)
//   • Issue-letter threshold  = Target ÷ 3   (≈ 33% — performance below this earns a warning letter)
//   • Reward consideration    = Target × 0.8 (80% — at/above this the staff/outlet is considered for a reward)
//   • Reward amount           = To be defined by management

import { formatAmount } from '@/lib/utils'

export type TargetUnit = 'TZS' | 'COUNT'

export const TARGET_SCOPES = ['Per Staff', 'Per Outlet', 'Per Manager'] as const
export type TargetScope = (typeof TARGET_SCOPES)[number]

export interface TargetDef {
  id: string
  outletId: string
  outletName: string
  scope: string
  department: string
  unit: TargetUnit
  unitLabel?: string | null
  weeklyTarget: number
}

export const LETTER_RATIO = 1 / 3
export const REWARD_RATIO = 0.8

/**
 * Derive the standardized levels for a target at a given period.
 * Weekly = the stored 7-day figure. Monthly = daily rate × daysInMonth
 * (defaults to 30 if not supplied).
 */
export function targetLevels(t: Pick<TargetDef, 'weeklyTarget'>, period: 'weekly' | 'monthly', daysInMonth = 30) {
  const days = period === 'monthly' ? daysInMonth : 7
  const target = Math.round((t.weeklyTarget / 7) * days)
  return {
    target,
    letterBelow: Math.round(target * LETTER_RATIO),
    rewardFrom: Math.round(target * REWARD_RATIO),
  }
}

/** Which actuals bucket a target's department measures. Keyword-matched so
 *  admin-renamed departments ("VIP Shisha Sales") still classify correctly. */
export function targetDeptKey(department: string): 'collection' | 'shisha' | 'food' {
  const d = department.toLowerCase()
  if (d.includes('shisha')) return 'shisha'
  if (d.includes('food')) return 'food'
  return 'collection'
}

/** Format a target value by its unit. */
export function fmtTarget(v: number, unit: TargetUnit, unitLabel?: string | null): string {
  if (unit === 'COUNT') return `${v.toLocaleString()} ${unitLabel || 'shisha'}`
  return formatAmount(v)
}
