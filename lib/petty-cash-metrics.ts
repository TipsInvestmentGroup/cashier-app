import { roundMoney } from '@/lib/utils'

export interface PettyCashStatusAmount {
  status: string
  amount: number
}

/** Approved petty-cash spend from a set of already-fetched PettyCash rows —
 *  "committed/approved spend", not necessarily disbursed yet. Used by the
 *  Daily Report and the daily summary email's Cash-in-Hand figure. This is a
 *  deliberately different question from lib/cash-recon.ts's computeCash(),
 *  which answers "cash physically out of the drawer today"
 *  (paymentStatus=PAID, pettyType=CASHIER) — don't unify the two formulas,
 *  just keep each one implemented in exactly one place. */
export function sumApprovedPettyCash(rows: PettyCashStatusAmount[]): number {
  return roundMoney(rows.filter((p) => p.status === 'APPROVED').reduce((s, p) => s + p.amount, 0))
}
