/** Stage-record statuses that count as "done" for progress displays — a
 * pending approval still counts, since the data was submitted, just not yet
 * signed off. Shared by the session list and session detail pages so their
 * progress math never drifts apart. */
export const DONE_STATUSES = new Set(['COMPLETED', 'APPROVED', 'PENDING_APPROVAL'])

/** Tailwind text-color class for a stage-record/session status badge. */
export function statusColor(status: string): string {
  if (status === 'PENDING_APPROVAL') return 'text-amber-600'
  if (status === 'REJECTED') return 'text-red-600'
  if (status === 'OPEN' || status === 'PENDING' || status === 'IN_PROGRESS') return 'text-gray-500'
  return 'text-emerald-600'
}
