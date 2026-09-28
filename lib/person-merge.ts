import type { Db } from '@/lib/ledger'
import { syncCreditForPerson } from '@/lib/credit-ledger'

/**
 * Merge one or more Person records into a kept one, inside the caller's
 * transaction. Reassigns every signed/paid bill to the kept person AND repairs
 * the credit side — repoints the moved bills' creditAccountId onto the kept
 * person's account (adopting a merged account if the kept person had none),
 * closes the now-empty merged accounts, and rebuilds the kept person's credit
 * ledger + materialized balance. Without the credit repair the reassigned bills
 * would still ledger against the merged-away (deactivated) person and go
 * uncounted. Soft-deactivates the merged persons; history stays intact.
 */
export async function mergePersons(
  db: Db,
  opts: { keepId: string; mergeIds: string[]; keepName: string; bestCreditLimit: number },
): Promise<{ signedBillsReassigned: number; paidBillsReassigned: number }> {
  const { keepId, mergeIds, keepName, bestCreditLimit } = opts

  const signedResult = await db.signedBill.updateMany({ where: { personId: { in: mergeIds } }, data: { personId: keepId } })
  const paidResult = await db.paidBill.updateMany({ where: { personId: { in: mergeIds } }, data: { personId: keepId } })
  await db.person.update({ where: { id: keepId }, data: { creditLimit: bestCreditLimit } })

  const mergedAccounts = await db.creditAccount.findMany({ where: { personId: { in: mergeIds } }, select: { id: true } })
  const mergedAccountIds = mergedAccounts.map((a: { id: string }) => a.id)
  let keepAccount = await db.creditAccount.findUnique({ where: { personId: keepId }, select: { id: true } })
  if (!keepAccount && mergedAccountIds.length) {
    // Kept person has no credit account — adopt one merged account (frees the old
    // owner's unique personId) and close the rest.
    const [adopt, ...rest] = mergedAccountIds
    await db.creditAccount.update({ where: { id: adopt }, data: { personId: keepId, displayName: keepName, status: 'ACTIVE' } })
    keepAccount = { id: adopt }
    if (rest.length) await db.creditAccount.updateMany({ where: { id: { in: rest } }, data: { status: 'CLOSED' } })
  } else if (keepAccount && mergedAccountIds.length) {
    await db.creditAccount.updateMany({ where: { id: { in: mergedAccountIds } }, data: { status: 'CLOSED' } })
  }
  if (keepAccount && mergedAccountIds.length) {
    await db.signedBill.updateMany({ where: { personId: keepId, creditAccountId: { in: mergedAccountIds } }, data: { creditAccountId: keepAccount.id } })
  }

  await db.person.updateMany({ where: { id: { in: mergeIds } }, data: { isActive: false } })
  await syncCreditForPerson(db, keepId)
  return { signedBillsReassigned: signedResult.count, paidBillsReassigned: paidResult.count }
}
