// Seeds the Universal Credit Management Framework (Phase 1 — config +
// classification) for TIPS: the module identity ("Signed Bills"), two shared
// no-op interest/penalty policies (TIPS charges neither), and the six credit
// groups — Admin, Director, Customer, Staff, Tips Bills, DJ Bills — each mapped
// 1:1 to the existing fixed billType vocabulary in lib/bill-types.ts via
// legacyBillTypeCode, so today's SignedBills classify with no data migration.
//
// Purely additive & idempotent (upsert / create-only-if-absent): re-running
// never clobbers an admin's later edits in Credit Settings, and creating no
// rows at all leaves today's hardcoded behavior unchanged. See
// docs/credit-management-framework-design.md.

// Settlement method presets — "Both (configurable)": each group carries the
// full list of methods it ALLOWS plus the one it DEFAULTS to. Staff-facing
// groups (Admin/Director/Staff) can payroll-deduct; customer-facing ones can't.
const ALL_METHODS = ['PAYROLL_DEDUCTION', 'CASH', 'BANK', 'MOBILE_MONEY']
const STAFF_METHODS = ['PAYROLL_DEDUCTION', 'CASH']
const CASH_METHODS = ['CASH', 'BANK', 'MOBILE_MONEY']

interface GroupSeed {
  code: string
  name: string
  legacyBillTypeCode: string
  isCreditBearing: boolean
  requiresApproval: boolean
  settlementMethods: string[]
  defaultSettlementMethod: string
  paymentTermsDays: number
  approverRoles: string[]
  riskRating: string
  priority: number
  description: string
}

// The 6 TIPS groups ↔ the 6 legacy billType codes (lib/bill-types.ts).
//   ADMIN/DIRECTOR  → credit-bearing, auto-approved, payroll-deduction default
//   CUSTOMER/TIPS/DJ → credit-bearing, request-approval (REQUEST_BILL_TYPES), cash default
//   STAFF (=STAFF_LOSS) → internal shortage marker, NOT a receivable, settled from pay
const TIPS_GROUPS: GroupSeed[] = [
  { code: 'ADMIN', name: 'Admin', legacyBillTypeCode: 'ADMIN', isCreditBearing: true, requiresApproval: false, settlementMethods: ALL_METHODS, defaultSettlementMethod: 'PAYROLL_DEDUCTION', paymentTermsDays: 0, approverRoles: [], riskRating: 'LOW', priority: 10, description: 'Internal admin bills — auto-approved, payroll-deduction eligible.' },
  { code: 'DIRECTOR', name: 'Director', legacyBillTypeCode: 'DIRECTOR', isCreditBearing: true, requiresApproval: false, settlementMethods: ALL_METHODS, defaultSettlementMethod: 'PAYROLL_DEDUCTION', paymentTermsDays: 0, approverRoles: [], riskRating: 'LOW', priority: 20, description: 'Director bills — auto-approved, payroll-deduction eligible.' },
  { code: 'CUSTOMER', name: 'Customer', legacyBillTypeCode: 'CUSTOMER', isCreditBearing: true, requiresApproval: true, settlementMethods: CASH_METHODS, defaultSettlementMethod: 'CASH', paymentTermsDays: 30, approverRoles: ['MANAGER'], riskRating: 'MEDIUM', priority: 30, description: 'Customer signed bills — require sign-off; net-30, cash/bank/mobile settlement.' },
  { code: 'STAFF', name: 'Staff', legacyBillTypeCode: 'STAFF_LOSS', isCreditBearing: false, requiresApproval: false, settlementMethods: STAFF_METHODS, defaultSettlementMethod: 'PAYROLL_DEDUCTION', paymentTermsDays: 0, approverRoles: [], riskRating: 'LOW', priority: 40, description: 'Staff shortage/loss marker — internal, not a receivable; recovered from pay.' },
  { code: 'TIPS_BILLS', name: 'Tips Bills', legacyBillTypeCode: 'TIPS', isCreditBearing: true, requiresApproval: true, settlementMethods: CASH_METHODS, defaultSettlementMethod: 'CASH', paymentTermsDays: 0, approverRoles: ['MANAGER'], riskRating: 'MEDIUM', priority: 50, description: 'Tips bills — require sign-off.' },
  { code: 'DJ_BILLS', name: 'DJ Bills', legacyBillTypeCode: 'DJ', isCreditBearing: true, requiresApproval: true, settlementMethods: CASH_METHODS, defaultSettlementMethod: 'CASH', paymentTermsDays: 0, approverRoles: ['MANAGER'], riskRating: 'MEDIUM', priority: 60, description: 'DJ bills — require sign-off.' },
]

/**
 * Idempotent. Seeds the credit module config, shared no-op policies, and the
 * six TIPS credit groups; then create-if-absent a 1:1 CreditAccount for every
 * existing Person, linking it to the group whose legacyBillTypeCode matches the
 * person's `type` (best-effort — unmatched persons still get an account).
 * Returns counts for the seed summary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seedCreditFramework(prisma: any): Promise<{ groups: number; accounts: number }> {
  const company = await prisma.company.upsert({
    where: { name: 'TIPS Investment Group' },
    update: {},
    create: { name: 'TIPS Investment Group', legalName: 'TIPS INVESTMENT LTD', tin: '132-051-100', vrn: '40-028205-X' },
  })

  // ── Module config (GLOBAL). scopeId is null, so a compound-unique upsert
  // can't dedupe on SQLite (NULL != NULL) — use findFirst + create/update. ──
  const existingConfig = await prisma.creditModuleConfig.findFirst({ where: { scope: 'GLOBAL', scopeId: null } })
  if (!existingConfig) {
    await prisma.creditModuleConfig.create({
      data: {
        scope: 'GLOBAL',
        scopeId: null,
        moduleName: 'Signed Bills',
        terminology: JSON.stringify({ module: 'Signed Bills', account: 'Person', invoice: 'Signed Bill', payment: 'Paid Bill', group: 'Bill Type' }),
        enabled: true,
        defaultCurrency: 'TZS',
        approvalRequiredDefault: false,
        allowPartialPayments: true,
        allowOverLimit: 'WARN',
        requireAttachmentsDefault: false,
      },
    })
  }

  // ── Shared no-op policies (TIPS charges no interest/penalty) ──
  const interestNone = await prisma.creditPolicy.upsert({
    where: { companyId_code: { companyId: company.id, code: 'CREDIT_INTEREST_NONE' } },
    update: {},
    create: { companyId: company.id, code: 'CREDIT_INTEREST_NONE', name: 'No Interest', policyType: 'INTEREST', method: 'NONE' },
  })
  const penaltyNone = await prisma.creditPolicy.upsert({
    where: { companyId_code: { companyId: company.id, code: 'CREDIT_PENALTY_NONE' } },
    update: {},
    create: { companyId: company.id, code: 'CREDIT_PENALTY_NONE', name: 'No Penalty', policyType: 'PENALTY', method: 'NONE' },
  })

  // ── The six groups ──
  const groupByLegacy: Record<string, string> = {}
  for (const g of TIPS_GROUPS) {
    const row = await prisma.creditGroup.upsert({
      where: { companyId_code: { companyId: company.id, code: g.code } },
      update: {}, // create-only: never clobber admin edits
      create: {
        companyId: company.id,
        code: g.code,
        name: g.name,
        description: g.description,
        status: 'ACTIVE',
        legacyBillTypeCode: g.legacyBillTypeCode,
        isCreditBearing: g.isCreditBearing,
        requiresApproval: g.requiresApproval,
        settlementMethods: JSON.stringify(g.settlementMethods),
        defaultSettlementMethod: g.defaultSettlementMethod,
        maxCredit: 0,
        paymentTermsDays: g.paymentTermsDays,
        gracePeriodDays: 0,
        interestPolicyId: interestNone.id,
        penaltyPolicyId: penaltyNone.id,
        approverRoles: g.approverRoles.length ? JSON.stringify(g.approverRoles) : null,
        riskRating: g.riskRating,
        priority: g.priority,
      },
    })
    groupByLegacy[g.legacyBillTypeCode] = row.id
  }

  // ── A CreditAccount per existing Person (1:1, create-if-absent), linked to
  // the group matching the person's type. Best-effort: an unmatched type still
  // gets an account (no group link) so no debtor is dropped. ──
  let accountsCreated = 0
  const persons = await prisma.person.findMany({ where: { creditAccount: null } })
  for (const p of persons) {
    const legacy = normalizePersonType(p.type)
    const account = await prisma.creditAccount.create({
      data: {
        companyId: company.id,
        accountType: legacy === 'STAFF_LOSS' ? 'STAFF' : 'INDIVIDUAL',
        displayName: p.name,
        personId: p.id,
        currency: 'TZS',
        creditLimitOverride: p.creditLimit && p.creditLimit > 0 ? p.creditLimit : null,
      },
    })
    accountsCreated++
    const groupId = legacy ? groupByLegacy[legacy] : undefined
    if (groupId) {
      await prisma.creditAccountGroup.create({ data: { accountId: account.id, groupId } })
    }
  }

  return { groups: TIPS_GROUPS.length, accounts: accountsCreated }
}

// Maps a Person.type value to a legacy billType code (the group bridge key).
// Person.type in TIPS uses the same vocabulary (ADMIN/DIRECTOR/CUSTOMER/STAFF/
// TIPS/DJ); STAFF → the STAFF_LOSS group. Returns null when it doesn't map.
function normalizePersonType(type: string | null | undefined): string | null {
  if (!type) return null
  const t = type.trim().toUpperCase()
  if (t === 'STAFF' || t === 'STAFF_LOSS') return 'STAFF_LOSS'
  if (['ADMIN', 'DIRECTOR', 'CUSTOMER', 'TIPS', 'DJ'].includes(t)) return t
  return null
}
