// The Expense Module Upgrade's fund-class layer — the three custodian-owned
// funds (Cashier Cash / Petty Cash / Digital Expenses) expressed as a VIEW over
// the existing FundingSource.sourceType rather than a stored duplicate.
//
// Why derived and not a column: FundingSource already records how a fund is
// backed (CASHIER_DRAWER = a cashier's till, CASH = an allocated float,
// BANK/MOBILE_MONEY/CARD = a real company payment account), and
// lib/expense-ledger.ts getFundingSourceBalance() already branches on exactly
// that to resolve a balance. A second `fundClass` column would restate the same
// fact and could drift out of step with it — the dual-source-of-truth mistake
// docs/expense-disbursement-framework-design.md rejects throughout. So the
// brief's three types are computed here, in one place, and every consumer
// (grants, notification routing, balance display, allocation UI) reads them
// from this module.
//
// See docs/expense-module-upgrade-brief.md §2 and §5.
import type { FundingSourceType } from '@/lib/expense-config'

export const FUND_CLASSES = ['CASHIER_CASH', 'PETTY_CASH', 'DIGITAL'] as const
export type FundClass = (typeof FUND_CLASSES)[number]

/** §5's three allocation modes, one per fund class. */
export const ALLOCATION_MODES = ['ROLLING_CASH_BALANCE', 'FIXED_ALLOCATION', 'BANK_BALANCE'] as const
export type AllocationMode = (typeof ALLOCATION_MODES)[number]

/** Which sourceType values belong to each fund class. OTHER is deliberately
 *  absent: a director/project fund with no GL wrapper is none of the brief's
 *  three funds, and silently folding it into Petty Cash would put money under a
 *  custodian who never agreed to hold it. Such sources keep working exactly as
 *  they do today — they simply do not appear in the three fund screens. */
const SOURCE_TYPES_BY_CLASS: Record<FundClass, readonly FundingSourceType[]> = {
  CASHIER_CASH: ['CASHIER_DRAWER'],
  PETTY_CASH: ['CASH'],
  DIGITAL: ['BANK', 'MOBILE_MONEY', 'CARD'],
}

/** The fund class a funding source belongs to, or null when it belongs to none
 *  (sourceType OTHER, or an unrecognized value). Callers that need a class must
 *  handle null rather than defaulting — see the note above. */
export function fundClassOf(sourceType: string): FundClass | null {
  for (const fundClass of FUND_CLASSES) {
    if ((SOURCE_TYPES_BY_CLASS[fundClass] as readonly string[]).includes(sourceType)) return fundClass
  }
  return null
}

/** The sourceType values to filter a FundingSource query by, for one fund class
 *  — e.g. prisma.fundingSource.findMany({ where: { sourceType: { in: sourceTypesFor('DIGITAL') } } }). */
export function sourceTypesFor(fundClass: FundClass): readonly FundingSourceType[] {
  return SOURCE_TYPES_BY_CLASS[fundClass]
}

const ALLOCATION_MODE_BY_CLASS: Record<FundClass, AllocationMode> = {
  // Yesterday's closing cash + today's handover, computed live and never
  // allocated by hand (lib/cash-recon.ts computeAvailableCashToday).
  CASHIER_CASH: 'ROLLING_CASH_BALANCE',
  // An allocated float, topped up on approval (§8) and drawn down by payments.
  PETTY_CASH: 'FIXED_ALLOCATION',
  // Follows the wrapped CompanyPaymentAccount's GL balance; funded by the bank,
  // not by an allocation.
  DIGITAL: 'BANK_BALANCE',
}

export function allocationModeFor(fundClass: FundClass): AllocationMode {
  return ALLOCATION_MODE_BY_CLASS[fundClass]
}

/** §5's "hide/disable UI elements that don't apply": only a FIXED_ALLOCATION
 *  fund has an allocation amount to enter. A Cashier Cash fund's balance follows
 *  the till and a Digital fund's follows the bank, so an allocation field on
 *  either would write a figure nothing reads — lib/expense-ledger.ts
 *  replenishFundingSource() already throws for those source types, and this is
 *  the read-side test that keeps the UI from offering the action at all. */
export function supportsManualAllocation(fundClass: FundClass): boolean {
  return allocationModeFor(fundClass) === 'FIXED_ALLOCATION'
}

/** The same test starting from a raw sourceType — the form every UI actually has
 *  in hand. A source belonging to no fund class (OTHER) keeps today's behavior
 *  and stays allocatable: lib/expense-ledger.ts replenishFundingSource() accepts
 *  CASH and OTHER, and silently removing OTHER's allocation UI would strand any
 *  director/project float that relies on it. Single definition so the ledger
 *  screen and the Funding Sources editor can never disagree about whether a fund
 *  has an allocation field. */
export function allowsManualAllocation(sourceType: string): boolean {
  const fundClass = fundClassOf(sourceType)
  return fundClass ? supportsManualAllocation(fundClass) : true
}

/** Default display labels. Deliberately NOT the source of truth for what a
 *  tenant calls these — Expense Settings' terminology map (lib/expense-config.ts
 *  ExpenseTerminology) stays authoritative for admin-editable labels. These are
 *  the fallbacks used where no configured label exists. */
export const FUND_CLASS_LABELS: Record<FundClass, string> = {
  CASHIER_CASH: 'Cashier Cash',
  PETTY_CASH: 'Petty Cash',
  DIGITAL: 'Digital Expenses',
}

export function isFundClass(value: string | null | undefined): value is FundClass {
  return !!value && (FUND_CLASSES as readonly string[]).includes(value)
}

/**
 * The PAYABLE amount of an ExpenseRequest — the approved figure when an approver
 * adjusted it (a partial approval, or a top-up rounded to a whole cheque),
 * otherwise the requested amount. This, NOT `amount`, is the ceiling every
 * money-movement path must respect: outstanding balance, the PARTIALLY_PAID→PAID
 * transition, reserved funds, and the Ready-to-Pay queue. Defined once here so
 * those sites can never drift on which figure is authoritative.
 *
 * `allocatedAmount` is only meaningful once set (> 0); null or 0 means "not
 * adjusted — pay as requested", so requested `amount` stands.
 */
export function payableAmount(req: { amount: number; allocatedAmount?: number | null }): number {
  return req.allocatedAmount != null && req.allocatedAmount > 0 ? req.allocatedAmount : req.amount
}
