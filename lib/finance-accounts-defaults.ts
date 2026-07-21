// Bootstrap Chart of Accounts for a company — seeded once per company on
// first Finance API read (same "seed defaults on first read" convention as
// lib/payment-channels-defaults.ts). Every field is admin-editable
// afterward via /finance/accounts; isSystemAccount just protects these
// seeded rows (and anything FinanceAccountMapping falls back to) from
// deletion, not from renaming.
import type { AccountType } from '@/lib/ledger'

export interface DefaultAccount {
  code: string
  name: string
  type: AccountType
  mappingKey?: string // key this account is the fallback target for in FinanceAccountMapping
}

export const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  { code: '1000', name: 'Cash', type: 'ASSET', mappingKey: 'CASH' },
  { code: '1010', name: 'Bank', type: 'ASSET', mappingKey: 'BANK' },
  { code: '1020', name: 'Mobile Money Clearing', type: 'ASSET', mappingKey: 'MOBILE_MONEY' },
  { code: '1100', name: 'Inventory Asset', type: 'ASSET', mappingKey: 'INVENTORY_ASSET' },
  { code: '1200', name: 'VAT Input', type: 'ASSET', mappingKey: 'VAT_INPUT' },
  { code: '2000', name: 'Accounts Payable Accrual (GRN Clearing)', type: 'LIABILITY', mappingKey: 'AP_ACCRUAL' },
  { code: '2010', name: 'Accounts Payable Control', type: 'LIABILITY', mappingKey: 'AP_CONTROL' },
  { code: '2100', name: 'VAT Output', type: 'LIABILITY', mappingKey: 'VAT_OUTPUT' },
  { code: '4000', name: 'Sales Revenue', type: 'INCOME', mappingKey: 'SALES_REVENUE' },
  { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE', mappingKey: 'COGS' },
  { code: '5100', name: 'Purchases Expense (uncosted)', type: 'EXPENSE', mappingKey: 'PURCHASES_EXPENSE' },
  { code: '5900', name: 'Rounding / Variance', type: 'EXPENSE', mappingKey: 'ROUNDING' },
  // Stage 2 — Accounts Receivable
  { code: '1300', name: 'Accounts Receivable', type: 'ASSET', mappingKey: 'ACCOUNTS_RECEIVABLE' },
  { code: '5910', name: 'Bad Debt Expense', type: 'EXPENSE', mappingKey: 'BAD_DEBT_EXPENSE' },
  // Stage 3 — Banking & Cash Management
  { code: '5920', name: 'Bank Charges Expense', type: 'EXPENSE', mappingKey: 'BANK_CHARGES_EXPENSE' },
  { code: '4900', name: 'Interest Income', type: 'INCOME', mappingKey: 'INTEREST_INCOME' },
  // Reconciliation Workflow Engine — approved write-offs of reconciliation
  // discrepancies (cash shortages, unreconciled variances) post here.
  { code: '5930', name: 'Reconciliation Write-Off Expense', type: 'EXPENSE', mappingKey: 'WRITE_OFF_EXPENSE' },
  // Excess/Reconciliation accounting redesign (Phase 3) — GL targets for
  // settling reconciliation differences by accounting class:
  //   PAYABLE excess (kitchen-sales transfer, customer overpayment) accrues to
  //   a liability clearing account at collection and is relieved when paid out.
  //   Petty-cash outflow and cash over/short finally get a GL home too.
  { code: '2200', name: 'Excess Payable (Third-Party Collections Clearing)', type: 'LIABILITY', mappingKey: 'EXCESS_PAYABLE' },
  { code: '2210', name: 'Customer Refunds Payable', type: 'LIABILITY', mappingKey: 'CUSTOMER_REFUND_PAYABLE' },
  { code: '5940', name: 'Petty Cash Expense (unclassified)', type: 'EXPENSE', mappingKey: 'PETTY_CASH_EXPENSE' },
  { code: '5950', name: 'Cash Over / Short', type: 'EXPENSE', mappingKey: 'CASH_OVER_SHORT' },
  // Universal Payroll Framework (Phase 3) — GL targets a payroll run posts to.
  // Earnings debit expense; net + statutory/other deductions credit liabilities;
  // the staff-purchase deduction credits ACCOUNTS_RECEIVABLE (recovering the
  // signed-bill balance — closes Credit-framework Phase 5) via the existing 1300.
  { code: '5200', name: 'Salaries & Wages Expense', type: 'EXPENSE', mappingKey: 'SALARY_EXPENSE' },
  { code: '5210', name: 'Employer Contributions Expense', type: 'EXPENSE', mappingKey: 'EMPLOYER_CONTRIB_EXPENSE' },
  { code: '1310', name: 'Staff Advances Receivable', type: 'ASSET', mappingKey: 'STAFF_ADVANCE_RECEIVABLE' },
  { code: '2300', name: 'Net Pay Payable', type: 'LIABILITY', mappingKey: 'NET_PAY_PAYABLE' },
  { code: '2310', name: 'PAYE Payable', type: 'LIABILITY', mappingKey: 'PAYE_PAYABLE' },
  { code: '2320', name: 'Pension Payable', type: 'LIABILITY', mappingKey: 'PENSION_PAYABLE' },
  { code: '2330', name: 'Social Security Payable', type: 'LIABILITY', mappingKey: 'SSF_PAYABLE' },
  { code: '2340', name: 'Health Insurance Payable', type: 'LIABILITY', mappingKey: 'HEALTH_PAYABLE' },
  { code: '2350', name: 'Payroll Deductions Payable', type: 'LIABILITY', mappingKey: 'PAYROLL_DEDUCTIONS_PAYABLE' },
]
