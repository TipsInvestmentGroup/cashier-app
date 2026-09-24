// Client-safe view model + formatter for the "current approver" of a pending
// expense request. Kept dependency-free (no prisma) so the Expense Requests
// list and detail pages can import it; the SERVER shape it mirrors is
// CurrentApprover in lib/expense-workflow.ts (resolveCurrentApprover), which is
// what the API actually sends.

export interface CurrentApproverView {
  stageGrant: string
  roleLabel: string
  stageNumber: number
  stageCount: number
  approvers: { id: string; name: string }[]
}

/**
 * The "Waiting for: …" text that replaces the generic "PENDING APPROVAL" label.
 * e.g. "Asha Mnyika (First Approver) · level 1 of 2", or "unassigned (First
 * Approver)" when nobody holds the stage grant yet (so the gap is visible, not
 * a misleading blank). `youId` renders the signed-in user as "You", matching the
 * rest of these screens.
 */
export function waitingForText(ca: CurrentApproverView, youId?: string | null): string {
  const names = ca.approvers.length
    ? ca.approvers.map((a) => (a.id === youId ? 'You' : a.name)).join(', ')
    : 'unassigned'
  const level = ca.stageCount > 1 ? ` · level ${ca.stageNumber} of ${ca.stageCount}` : ''
  return `${names} (${ca.roleLabel})${level}`
}
