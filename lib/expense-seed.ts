// Seeds the Universal Expense & Disbursement Framework (Phase 1 — config +
// core workflow) for TIPS: the module identity ("Petty Cash"), one request
// type ("Petty Cash Request") mapped to the existing PettyFunction/PettyFund
// data, and an ExpenseCategory per existing PettyFunction row (via
// legacyFunctionName) plus a FundingSource per existing PettyFund row (or one
// generic "Petty Cash" CASH source when no PettyFund exists yet).
//
// Purely additive & idempotent (upsert / create-only-if-absent): re-running
// never clobbers an admin's later edits in Expense Settings, and creating no
// rows at all leaves today's PettyCash behavior unchanged — this only seeds
// the NEW engine's screens, which nothing reads yet until they're built. See
// docs/expense-disbursement-framework-design.md.

const PETTY_CASH_REQUEST_TYPE_CODE = 'PETTY_CASH_REQUEST'
const DEFAULT_CASH_SOURCE_CODE = 'PETTY_CASH'
const DIGITAL_EXPENSE_REQUEST_TYPE_CODE = 'DIGITAL_EXPENSE_REQUEST'

// The Digital Expense Form's default fields (system — admins may relabel/
// reorder/require but not delete; they can add further custom fields on top
// via Expense Settings, with zero code changes).
const DIGITAL_EXPENSE_FIELDS = [
  { fieldKey: 'date', label: 'Date', fieldType: 'DATE', required: true, sortOrder: 0 },
  { fieldKey: 'payeeName', label: 'Payee Name', fieldType: 'TEXT', required: true, sortOrder: 1 },
  { fieldKey: 'accountOrWalletNumber', label: 'Account/Wallet Number', fieldType: 'TEXT', required: true, sortOrder: 2 },
  { fieldKey: 'phoneNumber', label: 'Phone Number', fieldType: 'PHONE', required: false, sortOrder: 3 },
  { fieldKey: 'paymentReason', label: 'Payment Reason', fieldType: 'TEXTAREA', required: true, sortOrder: 4 },
] as const

/**
 * Idempotent. Seeds the expense module config, the "Petty Cash Request"
 * request type, one ExpenseCategory per existing PettyFunction, and one
 * FundingSource per existing PettyFund (or a single generic CASH source when
 * none exist). Returns counts for the seed summary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seedExpenseFramework(prisma: any): Promise<{ categories: number; fundingSources: number }> {
  const company = await prisma.company.upsert({
    where: { name: 'TIPS Investment Group' },
    update: {},
    create: { name: 'TIPS Investment Group', legalName: 'TIPS INVESTMENT LTD', tin: '132-051-100', vrn: '40-028205-X' },
  })

  // ── Module config (GLOBAL). scopeId is null, so a compound-unique upsert
  // can't dedupe on SQLite (NULL != NULL) — use findFirst + create, same
  // pattern as seedCreditFramework. ──
  const existingConfig = await prisma.expenseModuleConfig.findFirst({ where: { scope: 'GLOBAL', scopeId: null } })
  if (!existingConfig) {
    await prisma.expenseModuleConfig.create({
      data: {
        scope: 'GLOBAL',
        scopeId: null,
        moduleName: 'Petty Cash',
        terminology: JSON.stringify({ module: 'Petty Cash', requestType: 'Request Type', category: 'Function', fundingSource: 'Fund', request: 'Petty Cash Request' }),
        enabled: true,
        defaultCurrency: 'TZS',
        requireReceiptDefault: true,
        allowMixedPayment: true,
        allowOverBudget: 'WARN',
      },
    })
  }

  // ── ExpenseCategory per existing PettyFunction (create-only: never clobber
  // admin edits made in Expense Settings). ──
  const functions = await prisma.pettyFunction.findMany({ where: { isActive: true } })
  let categoriesCreated = 0
  const categoryIds: string[] = []
  for (const fn of functions) {
    const code = String(fn.name).trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_')
    if (!code) continue
    const existing = await prisma.expenseCategory.findUnique({ where: { companyId_code: { companyId: company.id, code } } })
    if (existing) {
      categoryIds.push(existing.id)
      continue
    }
    const category = await prisma.expenseCategory.create({
      data: { companyId: company.id, code, name: fn.name, legacyFunctionName: fn.name, isActive: true },
    })
    categoryIds.push(category.id)
    categoriesCreated++
  }

  // ── FundingSource per existing PettyFund, or one generic CASH fallback when
  // none exist yet — "Petty Cash" is the funding source a fresh TIPS-shaped
  // company actually uses today. ──
  const funds = await prisma.pettyFund.findMany({ where: { isActive: true } })
  let fundingSourcesCreated = 0
  const fundingSourceIds: string[] = []
  if (funds.length) {
    for (const fund of funds) {
      const code = `FUND_${fund.id}`
      const existing = await prisma.fundingSource.findUnique({ where: { companyId_code: { companyId: company.id, code } } })
      if (existing) {
        fundingSourceIds.push(existing.id)
        continue
      }
      const balance = await computePettyFundBalance(prisma, fund.id, fund.openingBalance)
      const source = await prisma.fundingSource.create({
        data: {
          companyId: company.id, code, name: fund.name, sourceType: 'CASH',
          outletId: fund.outletId ?? null, openingBalance: fund.openingBalance, currentBalance: balance,
          responsibleUserId: fund.ownerId ?? null, currency: 'TZS', isActive: true,
        },
      })
      fundingSourceIds.push(source.id)
      fundingSourcesCreated++
    }
  } else {
    const existing = await prisma.fundingSource.findUnique({ where: { companyId_code: { companyId: company.id, code: DEFAULT_CASH_SOURCE_CODE } } })
    if (existing) {
      fundingSourceIds.push(existing.id)
    } else {
      const source = await prisma.fundingSource.create({
        data: { companyId: company.id, code: DEFAULT_CASH_SOURCE_CODE, name: 'Petty Cash', sourceType: 'CASH', currency: 'TZS', isActive: true },
      })
      fundingSourceIds.push(source.id)
      fundingSourcesCreated++
    }
  }

  // ── The one Phase-1 request type — create-only: never clobber admin edits. ──
  await prisma.requestType.upsert({
    where: { companyId_code: { companyId: company.id, code: PETTY_CASH_REQUEST_TYPE_CODE } },
    update: {},
    create: {
      companyId: company.id,
      code: PETTY_CASH_REQUEST_TYPE_CODE,
      name: 'Petty Cash Request',
      description: 'Generalizes the existing PettyCash flow — a cash/fund request for a named purpose, approved before disbursement.',
      isActive: true,
      allowedCategoryIds: categoryIds.length ? JSON.stringify(categoryIds) : null,
      allowedFundingSourceIds: fundingSourceIds.length ? JSON.stringify(fundingSourceIds) : null,
      budgetValidation: 'NONE',
      approverRoles: JSON.stringify(['MANAGER']),
    },
  })

  // ── Digital Expense Request — a second, independent request type restricted
  // to digital (BANK/MOBILE_MONEY/CARD) funding sources, with its 5 default
  // custom fields. create-only: never clobber admin edits made in Expense
  // Settings on a re-run. ──
  const digitalSources = await prisma.fundingSource.findMany({
    where: { companyId: company.id, sourceType: { in: ['BANK', 'MOBILE_MONEY', 'CARD'] }, isActive: true },
    select: { id: true },
  })
  const digitalExpenseType = await prisma.requestType.upsert({
    where: { companyId_code: { companyId: company.id, code: DIGITAL_EXPENSE_REQUEST_TYPE_CODE } },
    update: {},
    create: {
      companyId: company.id,
      code: DIGITAL_EXPENSE_REQUEST_TYPE_CODE,
      name: 'Digital Expense Request',
      description: 'A simple form for expenses paid electronically (bank/mobile money/card) — independent of the Petty Cash form, same approve/pay/verify workflow underneath.',
      isActive: true,
      allowedFundingSourceIds: digitalSources.length ? JSON.stringify(digitalSources.map((s: { id: string }) => s.id)) : null,
      budgetValidation: 'NONE',
      approverRoles: JSON.stringify(['MANAGER']),
    },
  })
  for (const f of DIGITAL_EXPENSE_FIELDS) {
    await prisma.requestTypeField.upsert({
      where: { requestTypeId_fieldKey: { requestTypeId: digitalExpenseType.id, fieldKey: f.fieldKey } },
      update: {},
      create: { requestTypeId: digitalExpenseType.id, fieldKey: f.fieldKey, label: f.label, fieldType: f.fieldType, required: f.required, sortOrder: f.sortOrder, isSystem: true },
    })
  }

  return { categories: categoriesCreated, fundingSources: fundingSourcesCreated }
}

// balance = openingBalance + Σsigned PettyFundTxn.amount (same arithmetic the
// existing petty-fund screens use) — computed once at seed time so a freshly
// seeded FundingSource shows a correct balance immediately, matching
// lib/credit-seed.ts's reconcileAllCreditLedgers() call for the same reason.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function computePettyFundBalance(prisma: any, fundId: string, openingBalance: number): Promise<number> {
  const txns = await prisma.pettyFundTxn.findMany({ where: { fundId }, select: { amount: true } })
  return txns.reduce((sum: number, t: { amount: number }) => sum + t.amount, openingBalance)
}
