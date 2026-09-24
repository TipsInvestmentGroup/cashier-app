// The Finance Account Mapping resolver — decides which GL Account a business
// event (an inventory receipt, a supplier payment via a given channel, a
// sales collection, ...) posts to, without any account id being hardcoded in
// posting logic. Same scope/scopeId shape and narrowest-wins resolution as
// lib/collection-mode.ts's CollectionModeConfig, but falling back to the
// company's seeded system Account (see lib/finance-accounts-defaults.ts)
// instead of a fixed default — so an unconfigured company still posts
// correctly on day one, and admins only need to override where they want a
// different account than the standard chart.
import { prisma } from '@/lib/prisma'
import { DEFAULT_ACCOUNTS } from '@/lib/finance-accounts-defaults'
import type { Db } from '@/lib/ledger'

export const MAPPING_SCOPES = ['GLOBAL', 'COMPANY', 'OUTLET'] as const
export type MappingScope = (typeof MAPPING_SCOPES)[number]

/** Seeds the standard starter Chart of Accounts for a company. Cheap no-op
 *  once the company already has every default account code (the common
 *  case, so this doesn't turn into a query on every single posting call) —
 *  but still heals a company provisioned before a new default account was
 *  added (e.g. Stage 3 adding Bank Charges Expense/Interest Income). Checked
 *  by comparing the specific default codes present, not a raw row count —
 *  a company with its own extra custom accounts (e.g. one CompanyPaymentAccount
 *  GL account per bank account, Stage 3) would otherwise make a plain count
 *  look "done" even while missing an actual default. */
export async function ensureChartOfAccounts(db: Db, companyId: string) {
  const existingCodes = new Set((await db.account.findMany({ where: { companyId, code: { in: DEFAULT_ACCOUNTS.map((a) => a.code) } }, select: { code: true } })).map((a: { code: string }) => a.code))
  const missing = DEFAULT_ACCOUNTS.filter((a) => !existingCodes.has(a.code))
  if (!missing.length) return
  for (const a of missing) {
    await db.account.upsert({
      where: { companyId_code: { companyId, code: a.code } },
      update: {},
      create: { companyId, code: a.code, name: a.name, type: a.type, isSystemAccount: true },
    })
  }
}

/**
 * Resolves the GL Account id for a mapping key, checking narrowest to
 * widest scope: OUTLET -> COMPANY -> the company's seeded system account for
 * that key. Ensures the Chart of Accounts is seeded first so the fallback
 * always has something to resolve to.
 */
export async function resolveAccountId(db: Db, opts: { companyId: string; outletId?: string | null; key: string }): Promise<string> {
  await ensureChartOfAccounts(db, opts.companyId)

  const priority: { scope: MappingScope; scopeId: string | null }[] = []
  if (opts.outletId) priority.push({ scope: 'OUTLET', scopeId: opts.outletId })
  priority.push({ scope: 'COMPANY', scopeId: opts.companyId })

  const rows = await db.financeAccountMapping.findMany({
    where: { key: opts.key, OR: priority.map((p) => ({ scope: p.scope, scopeId: p.scopeId })) },
  })
  for (const p of priority) {
    const row = rows.find((r) => r.scope === p.scope && r.scopeId === p.scopeId)
    if (row) return row.accountId
  }

  const fallback = DEFAULT_ACCOUNTS.find((a) => a.mappingKey === opts.key)
  if (!fallback) throw new Error(`No default account configured for mapping key "${opts.key}"`)
  const account = await db.account.findUnique({ where: { companyId_code: { companyId: opts.companyId, code: fallback.code } } })
  if (!account) throw new Error(`Chart of Accounts is missing the default "${fallback.name}" account for this company`)
  return account.id
}

// Reserved categories that are NOT P&L expenses — they move money between the
// company's own funds/accounts (e.g. topping up a petty-cash float). If recorded
// through a disbursement they must post as a balance-sheet transfer (Dr Cash),
// never to an expense or the suspense account. The real top-up flow is a
// direction=IN ExpenseRequest (lib/expense-workflow.ts executeTopUpPayment,
// which likewise lands the money in Cash-on-Hand); this guard only stops a
// legacy "Fund Top-Up" category from inflating expenses if it is used directly.
const FUND_TRANSFER_CATEGORY_CODES = new Set(['FUND_TOPUP'])
const FUND_TRANSFER_CATEGORY_NAMES = new Set(['fund top-up', 'fund topup', 'fund top up'])
function isFundTransferCategory(code?: string | null, name?: string | null): boolean {
  if (code && FUND_TRANSFER_CATEGORY_CODES.has(code)) return true
  return FUND_TRANSFER_CATEGORY_NAMES.has((name ?? '').trim().toLowerCase())
}

/**
 * The GL account a disbursement should DEBIT, given how it's classified.
 * - A fund-transfer category (e.g. "Fund Top-Up") is NOT an expense — it debits
 *   Cash so the entry is a balance-sheet transfer, never the P&L.
 * - Otherwise prefers the ExpenseCategory's chosen budgetAccountId so
 *   category-level cost reporting lands on a real operating-cost account (Rent,
 *   Utilities, …); falls back to the PETTY_CASH_EXPENSE suspense bucket (9000)
 *   only when the category is unknown or still unmapped, so posting never blocks
 *   on setup.
 *
 * Petty-cash records classify via a free-text functionName that bridges to
 * ExpenseCategory.legacyFunctionName (matched trimmed, case-insensitively);
 * the structured expense-request engine passes categoryId directly. Either
 * identifier resolves through the same category → account rule here.
 */
export async function resolveExpenseDebitAccount(
  db: Db,
  opts: { companyId: string; outletId?: string | null; categoryId?: string | null; functionName?: string | null },
): Promise<string> {
  let category: { code: string | null; name: string | null; budgetAccountId: string | null } | null = null
  if (opts.categoryId) {
    category = await db.expenseCategory.findFirst({
      where: { id: opts.categoryId, companyId: opts.companyId },
      select: { code: true, name: true, budgetAccountId: true },
    })
  }
  const fn = (opts.functionName ?? '').trim()
  if (!category && fn) {
    // SQLite has no case-insensitive equals in Prisma; match in JS over this
    // company's categories (a handful of rows) so "Gas Refill" == "gas refill".
    const cats = await db.expenseCategory.findMany({
      where: { companyId: opts.companyId },
      select: { code: true, name: true, legacyFunctionName: true, budgetAccountId: true },
    })
    const lc = fn.toLowerCase()
    category = cats.find((c) => (c.legacyFunctionName ?? '').trim().toLowerCase() === lc)
      || cats.find((c) => (c.name ?? '').trim().toLowerCase() === lc)
      || null
  }

  // Fund transfer (top-up) → Cash, so the disbursement is a transfer, not a cost.
  if (isFundTransferCategory(category?.code, category?.name) || (!category && isFundTransferCategory(null, fn))) {
    return resolveAccountId(db, { companyId: opts.companyId, outletId: opts.outletId, key: 'CASH' })
  }
  if (category?.budgetAccountId) return category.budgetAccountId
  return resolveAccountId(db, { companyId: opts.companyId, outletId: opts.outletId, key: 'PETTY_CASH_EXPENSE' })
}

/** Falls back to the single/first Company row — matches today's
 *  single-company reality, and keeps working unmodified once a second
 *  Company is added (whichever record needs a real company id, e.g. a
 *  no-PO Grn, should prefer a resolvable outlet/PO company over this). */
export async function resolveDefaultCompanyId(db: Db): Promise<string | null> {
  const company = await db.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
  return company?.id || null
}

/**
 * Resolves the Cash/Bank/Mobile-Money GL account for a PaymentChannel code
 * (e.g. "CASH", "CRDB", a custom digital channel) — cascading from most to
 * least specific: (1) the channel's default CompanyPaymentAccount (Stage 3
 * — an outlet-scoped default beats a company-wide one), (2) the channel's
 * own simple `glAccountId` (Stage 1, for a business that never set up
 * Company Payment Accounts), (3) the company's default CASH/MOBILE_MONEY
 * account. Note: not implemented via lib/finance-banking.ts's
 * resolveDefaultCompanyAccountId() to avoid a circular import between the
 * two files — this queries CompanyPaymentAccount directly instead. Shared
 * by every posting path that takes money in/out through a payment channel
 * (Daily Collections, AR receipts, AP payments) so the cascade lives in
 * exactly one place.
 */
export async function resolveChannelAccountId(db: Db, opts: { companyId: string; channelCode: string; outletId?: string | null }): Promise<string> {
  const channel = await db.paymentChannel.findUnique({ where: { code: opts.channelCode } })
  if (channel) {
    if (opts.outletId) {
      const outletDefault = await db.companyPaymentAccount.findFirst({
        where: { companyId: opts.companyId, paymentChannelId: channel.id, outletId: opts.outletId, isDefault: true, isActive: true },
      })
      if (outletDefault) return outletDefault.glAccountId
    }
    const companyDefault = await db.companyPaymentAccount.findFirst({
      where: { companyId: opts.companyId, paymentChannelId: channel.id, outletId: null, isDefault: true, isActive: true },
    })
    if (companyDefault) return companyDefault.glAccountId
    if (channel.glAccountId) return channel.glAccountId
  }
  return resolveAccountId(db, { companyId: opts.companyId, key: opts.channelCode === 'CASH' ? 'CASH' : 'MOBILE_MONEY' })
}

/** Upsert one mapping override. COMPANY/OUTLET only in this phase — there is
 *  no meaningful GLOBAL account since an Account always belongs to one
 *  company. */
export async function setAccountMapping(scope: MappingScope, scopeId: string, key: string, accountId: string) {
  return prisma.financeAccountMapping.upsert({
    where: { scope_scopeId_key: { scope, scopeId, key } },
    update: { accountId },
    create: { scope, scopeId, key, accountId },
  })
}
