// Petty Cash / Digital Payment Custodian management — mirrors lib/petty-access.ts's
// shape but for the new Expense & Disbursement Framework's FundingSourceCustodian
// join table (a FundingSource may have more than one responsible user, unlike the
// single optional FundingSource.responsibleUserId field).
import { prisma } from '@/lib/prisma'
import { fundClassOf, FUND_CLASS_LABELS } from '@/lib/expense-funds'
import { hasGrant } from '@/lib/expense-grants'

export async function listFundingSourceCustodians(fundingSourceId: string) {
  const rows = await prisma.fundingSourceCustodian.findMany({ where: { fundingSourceId } })
  if (!rows.length) return []
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true, email: true, role: true } })
  return rows.map((r) => ({ id: r.id, userId: r.userId, user: users.find((u) => u.id === r.userId) || null }))
}

/**
 * Assigns a user to hold a specific fund. §4 makes the access list the single
 * source of truth for "who CAN be assigned as a custodian", so this checks the
 * CUSTODIAN eligibility grant for the fund's class and outlet before writing
 * the assignment (see the eligibility-vs-assignment note in
 * lib/expense-grants.ts).
 *
 * Two deliberate escape hatches:
 *   • A fund whose sourceType maps to no fund class (OTHER) has no class to be
 *     eligible for, so it is exempt rather than unassignable.
 *   • `skipEligibilityCheck` exists for the backfill path only
 *     (backfillCustodianGrants derives grants FROM these assignments, so it
 *     cannot require them first).
 */
export async function assignFundingSourceCustodian(
  fundingSourceId: string,
  userId: string,
  opts: { skipEligibilityCheck?: boolean } = {},
) {
  if (!opts.skipEligibilityCheck) {
    const source = await prisma.fundingSource.findUnique({
      where: { id: fundingSourceId },
      select: { name: true, sourceType: true, outletId: true },
    })
    if (!source) throw new Error('Funding source not found')

    const fundClass = fundClassOf(source.sourceType)
    if (fundClass) {
      const eligible = await hasGrant(userId, 'CUSTODIAN', { fundClass, outletId: source.outletId })
      if (!eligible) {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
        throw new Error(
          `${user?.name || 'This user'} does not have ${FUND_CLASS_LABELS[fundClass]} Custodian access${source.outletId ? ' for this outlet' : ''}. ` +
          'Grant it under Setup → Expense Settings → Manage Access first.'
        )
      }
    }
  }

  return prisma.fundingSourceCustodian.upsert({
    where: { fundingSourceId_userId: { fundingSourceId, userId } },
    update: {},
    create: { fundingSourceId, userId },
  })
}

export async function removeFundingSourceCustodian(fundingSourceId: string, userId: string) {
  await prisma.fundingSourceCustodian.deleteMany({ where: { fundingSourceId, userId } })
}

export async function isCustodianOf(userId: string, fundingSourceId: string): Promise<boolean> {
  const row = await prisma.fundingSourceCustodian.findUnique({ where: { fundingSourceId_userId: { fundingSourceId, userId } } })
  return !!row
}

function parseIdList(raw: string | null | undefined): string[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : null
  } catch {
    return null
  }
}

/** Every user who custodians at least one funding source allowed for a given
 *  request type (or every active custodian, when the request type doesn't
 *  restrict funding sources) — used to notify custodians once a request is
 *  ready for payment (lib/expense-workflow.ts). Deduplicated by user id. */
export async function listCustodiansForRequestType(allowedFundingSourceIds: string | null): Promise<{ id: string; name: string; email: string | null }[]> {
  const restrictTo = parseIdList(allowedFundingSourceIds)
  const rows = await prisma.fundingSourceCustodian.findMany({
    where: restrictTo ? { fundingSourceId: { in: restrictTo } } : undefined,
  })
  if (!rows.length) return []
  const userIds = [...new Set(rows.map((r) => r.userId))]
  return prisma.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { id: true, name: true, email: true } })
}
