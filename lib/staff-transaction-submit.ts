import { CollectionValidationError, notifyApprovers } from '@/lib/collection-stage-submit'

export { CollectionValidationError, notifyApprovers }

// Categories a service staff can self-declare. PAYMENT never needs approval;
// everything else always does (a fixed business rule per the Transaction
// Management brief — "Signed Bills, Discounts, Cancellations, Credit Sales").
const CATEGORIES_REQUIRING_APPROVAL = new Set(['SIGNED_BILL', 'DISCOUNT', 'CANCELLATION', 'CREDIT_SALE'])
export const APPROVER_ROLE = 'MANAGER'

export function categoryNeedsApproval(category: string): boolean {
  return CATEGORIES_REQUIRING_APPROVAL.has(category)
}

interface CreateArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any
  sessionId: string
  staffId: string
  category: string
  paymentMethod: string | null
  amount: number
  receivingAccount: string | null
  reference: string | null
  personName: string | null
}

/**
 * Creates one StaffTransaction. If its category requires sign-off, status
 * becomes PENDING_APPROVAL and a WorkflowApproval row is created (resolved
 * via the existing /api/collection-approvals decide endpoint) — otherwise it
 * is immediately DECLARED and counts toward the cashier's summary.
 */
export async function createStaffTransaction({ tx, sessionId, staffId, category, paymentMethod, amount, receivingAccount, reference, personName }: CreateArgs) {
  const needsApproval = categoryNeedsApproval(category)
  const transaction = await tx.staffTransaction.create({
    data: {
      sessionId,
      staffId,
      category,
      paymentMethod,
      amount,
      receivingAccount,
      reference,
      personName,
      status: needsApproval ? 'PENDING_APPROVAL' : 'DECLARED',
    },
  })

  if (needsApproval) {
    await tx.workflowApproval.create({
      data: {
        transactionId: transaction.id,
        requestedById: staffId,
        approverRole: APPROVER_ROLE,
        comment: `${category.replace('_', ' ')} of ${amount} declared`,
      },
    })
  }

  return transaction
}
