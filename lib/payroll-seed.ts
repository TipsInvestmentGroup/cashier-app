// Seeds the Universal Payroll Framework (Phase 1 — foundation) for TIPS: the
// module identity ("Payroll", DISABLED on install), the employee categories and
// pay groups, and one Employee per existing User (the actual workforce with
// logins). See docs/payroll-framework-design.md.
//
// Purely additive & idempotent (upsert / create-only-if-absent). Because the
// module ships enabled = false and nothing reads these tables yet, seeding
// changes no behaviour — the existing deduction report is untouched.
//
// Employee sourcing (Phase 1 decision): one Employee per USER, not per Person.
// Every login is a staff member, so Users are the reliable workforce roster.
// We do NOT auto-match a User to a Person by name — that is error-prone; the
// User↔Person link (Employee.personId, which lets a payroll run settle that
// person's signed bills in Phase 3) is a curated admin action, or a reviewed
// name-matching migration later. So Phase-1 Employees carry userId, personId = null.

interface CategorySeed {
  code: string
  name: string
  defaultPayFrequency: string
  isStatutoryExempt: boolean
  priority: number
  description: string
}

// Unlimited & admin-editable later; these are just sensible starting rows.
const TIPS_CATEGORIES: CategorySeed[] = [
  { code: 'PERMANENT', name: 'Permanent', defaultPayFrequency: 'MONTHLY', isStatutoryExempt: false, priority: 10, description: 'Full-time permanent staff.' },
  { code: 'DIRECTOR', name: 'Director', defaultPayFrequency: 'MONTHLY', isStatutoryExempt: false, priority: 20, description: 'Directors.' },
  { code: 'CASUAL', name: 'Casual', defaultPayFrequency: 'DAILY', isStatutoryExempt: false, priority: 30, description: 'Casual / event-day labour (User.isCasual).' },
  { code: 'CONTRACT', name: 'Contract', defaultPayFrequency: 'MONTHLY', isStatutoryExempt: false, priority: 40, description: 'Fixed-term contract staff.' },
  { code: 'INTERN', name: 'Intern', defaultPayFrequency: 'MONTHLY', isStatutoryExempt: false, priority: 50, description: 'Interns / trainees.' },
]

interface GroupSeed {
  code: string
  name: string
  approverRoles: string[]
  priority: number
  description: string
}

const TIPS_PAY_GROUPS: GroupSeed[] = [
  { code: 'MANAGEMENT', name: 'Management', approverRoles: ['DIRECTOR'], priority: 10, description: 'Directors, admins, managers, accountants — monthly salary.' },
  { code: 'FLOOR_STAFF', name: 'Floor Staff', approverRoles: ['MANAGER', 'DIRECTOR'], priority: 20, description: 'Waiters and floor service staff.' },
  { code: 'CASUAL_EVENT', name: 'Casual / Event', approverRoles: ['MANAGER'], priority: 30, description: 'Casual and event-day workers.' },
]

// Map a User (role + isCasual) to its seed category + pay-group codes.
function classifyUser(role: string, isCasual: boolean): { categoryCode: string; payGroupCode: string } {
  if (isCasual) return { categoryCode: 'CASUAL', payGroupCode: 'CASUAL_EVENT' }
  if (role === 'WAITER') return { categoryCode: 'PERMANENT', payGroupCode: 'FLOOR_STAFF' }
  if (role === 'DIRECTOR') return { categoryCode: 'DIRECTOR', payGroupCode: 'MANAGEMENT' }
  return { categoryCode: 'PERMANENT', payGroupCode: 'MANAGEMENT' }
}

// ── Phase 2: a demonstrative set of pay components + a formula + group
// assignments. Minimal but exercises every calcMethod path: FORMULA (base pay),
// PERCENTAGE (housing/pension), RATE_QTY (overtime), and SOURCED=CREDIT_BALANCE
// (staff purchases → the Credit-framework loop). Real amounts/rates are TIPS
// placeholders an admin edits later. Idempotent (create-only). ──
interface ComponentSeed {
  code: string
  name: string
  componentType: string
  calcMethod: string
  parameters?: Record<string, unknown>
  formulaCode?: string
  taxable: boolean
  pensionable: boolean
  priority: number
  proratable?: boolean
  glMappingKey?: string
  description: string
}

const PAYROLL_FORMULAS = [
  { code: 'BASE_PAY', name: 'Base Pay', expression: 'base', variables: ['base'], description: 'Basic salary = the employee base pay.' },
]

const PAYROLL_COMPONENTS: ComponentSeed[] = [
  { code: 'BASIC_SALARY', name: 'Basic Salary', componentType: 'EARNING', calcMethod: 'FORMULA', formulaCode: 'BASE_PAY', taxable: true, pensionable: true, priority: 0, proratable: true, glMappingKey: 'SALARY_EXPENSE', description: 'Monthly basic salary (prorated by days worked).' },
  { code: 'HOUSING_ALLOWANCE', name: 'Housing Allowance', componentType: 'ALLOWANCE', calcMethod: 'PERCENTAGE', parameters: { percent: 20, of: 'base' }, taxable: true, pensionable: false, priority: 10, proratable: true, glMappingKey: 'SALARY_EXPENSE', description: '20% of base pay (prorated by days worked).' },
  { code: 'OVERTIME', name: 'Overtime', componentType: 'EARNING', calcMethod: 'RATE_QTY', parameters: { rate: 5000, qtyVar: 'overtimeHours' }, taxable: true, pensionable: false, priority: 20, glMappingKey: 'SALARY_EXPENSE', description: 'Rate per overtime hour worked.' },
  { code: 'PENSION_EE', name: 'Pension (Employee)', componentType: 'DEDUCTION', calcMethod: 'PERCENTAGE', parameters: { percent: 10, of: 'pensionable' }, taxable: false, pensionable: false, priority: 10, glMappingKey: 'PENSION_PAYABLE', description: 'Employee pension contribution — 10% of pensionable pay.' },
  // Phase 4 — statutory: PAYE (employee income tax) + employer pension. Both
  // pull effective-dated rates from StatutoryRule via SOURCED=STATUTORY.
  { code: 'PAYE', name: 'PAYE (Income Tax)', componentType: 'STATUTORY', calcMethod: 'SOURCED', parameters: { source: 'STATUTORY', statutoryCode: 'PAYE' }, taxable: false, pensionable: false, priority: 30, glMappingKey: 'PAYE_PAYABLE', description: 'Pay-As-You-Earn income tax (TRA), progressive on taxable pay.' },
  { code: 'PSSSF_ER', name: 'Pension (Employer)', componentType: 'EMPLOYER_CONTRIBUTION', calcMethod: 'SOURCED', parameters: { source: 'STATUTORY', statutoryCode: 'PSSSF_ER' }, taxable: false, pensionable: false, priority: 40, glMappingKey: 'PENSION_PAYABLE', description: 'Employer pension contribution (PSSSF).' },
  { code: 'STAFF_PURCHASES', name: 'Staff Purchases', componentType: 'DEDUCTION', calcMethod: 'SOURCED', parameters: { source: 'CREDIT_BALANCE' }, taxable: false, pensionable: false, priority: 90, glMappingKey: 'ACCOUNTS_RECEIVABLE', description: 'Recovery of the employee’s outstanding signed-bill balance (Credit framework).' },
]

// Which components each pay group grants (group-level assignments).
const GROUP_COMPONENTS: Record<string, string[]> = {
  MANAGEMENT: ['BASIC_SALARY', 'HOUSING_ALLOWANCE', 'PENSION_EE', 'PAYE', 'PSSSF_ER', 'STAFF_PURCHASES'],
  FLOOR_STAFF: ['BASIC_SALARY', 'OVERTIME', 'PENSION_EE', 'PAYE', 'PSSSF_ER', 'STAFF_PURCHASES'],
  CASUAL_EVENT: ['BASIC_SALARY', 'PAYE', 'STAFF_PURCHASES'],
}

// ── Phase 4: TZ statutory pack, effective-dated. THESE ARE ILLUSTRATIVE
// STARTING VALUES an authorized person must verify against current TRA / PSSSF
// guidance — the framework guarantees the mechanism (correct rule for the run's
// date), not the rates. All admin-editable; effective 2023-07-01. ──
interface StatutorySeed {
  code: string
  name: string
  authority: string
  ruleType: string
  baseVar: string
  parameters?: Record<string, unknown>
  employeeRate?: number
  employerRate?: number
  glMappingKey: string
  isEmployer: boolean
}

// ── Phase 4b: leave types (config; admin-editable). Annual accrues 2.5 days/mo
// (30/yr), paid; Sick paid; Unpaid leave prorates pay down. ──
interface LeaveTypeSeed { code: string; name: string; paid: boolean; accrualDaysPerMonth: number; maxCarryForward: number | null; encashable: boolean; description: string }
const LEAVE_TYPES: LeaveTypeSeed[] = [
  { code: 'ANNUAL', name: 'Annual Leave', paid: true, accrualDaysPerMonth: 2.5, maxCarryForward: 30, encashable: true, description: 'Paid annual leave, accrues 2.5 days/month.' },
  { code: 'SICK', name: 'Sick Leave', paid: true, accrualDaysPerMonth: 0, maxCarryForward: null, encashable: false, description: 'Paid sick leave.' },
  { code: 'UNPAID', name: 'Unpaid Leave', paid: false, accrualDaysPerMonth: 0, maxCarryForward: null, encashable: false, description: 'Unpaid leave — prorates pay down.' },
]

const TZ_STATUTORY_EFFECTIVE_FROM = new Date('2023-07-01T00:00:00.000Z')
const TZ_STATUTORY: StatutorySeed[] = [
  // Resident individual monthly PAYE (marginal bands) — verify vs TRA.
  { code: 'PAYE', name: 'PAYE (Income Tax)', authority: 'TRA', ruleType: 'TAX_BAND', baseVar: 'taxable', parameters: { bands: [[0, 0], [270000, 0.08], [520000, 0.20], [760000, 0.25], [1000000, 0.30]] }, glMappingKey: 'PAYE_PAYABLE', isEmployer: false },
  { code: 'PSSSF_EE', name: 'Pension — Employee (PSSSF)', authority: 'PSSSF', ruleType: 'FLAT_RATE', baseVar: 'pensionable', employeeRate: 0.10, glMappingKey: 'PENSION_PAYABLE', isEmployer: false },
  { code: 'PSSSF_ER', name: 'Pension — Employer (PSSSF)', authority: 'PSSSF', ruleType: 'FLAT_RATE', baseVar: 'pensionable', employerRate: 0.10, glMappingKey: 'PENSION_PAYABLE', isEmployer: true },
]

/**
 * Idempotent. Seeds the payroll module config (GLOBAL, disabled), the employee
 * categories and pay groups, then create-if-absent one Employee per User.
 * Returns counts for the seed summary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seedPayrollFramework(prisma: any): Promise<{ categories: number; payGroups: number; employees: number; components: number; assignments: number; statutoryRules: number; leaveTypes: number }> {
  const company = await prisma.company.upsert({
    where: { name: 'TIPS Investment Group' },
    update: {},
    create: { name: 'TIPS Investment Group', legalName: 'TIPS INVESTMENT LTD', tin: '132-051-100', vrn: '40-028205-X' },
  })

  // ── Module config (GLOBAL, DISABLED). scopeId is null, so a compound-unique
  // upsert can't dedupe on SQLite (NULL != NULL) — use findFirst + create. ──
  const existingConfig = await prisma.payrollModuleConfig.findFirst({ where: { scope: 'GLOBAL', scopeId: null } })
  if (!existingConfig) {
    await prisma.payrollModuleConfig.create({
      data: {
        scope: 'GLOBAL',
        scopeId: null,
        moduleName: 'Payroll',
        terminology: JSON.stringify({ module: 'Payroll', employee: 'Employee', payslip: 'Payslip', run: 'Pay Run', earning: 'Earning', deduction: 'Deduction' }),
        enabled: false, // installing the framework changes nothing until an admin enables it
        defaultCurrency: 'TZS',
        exchangeRatePolicy: 'RUN_DATE',
        approvalRequiredDefault: true,
        roundingPolicy: 'NEAREST_1',
        negativeNetPolicy: 'CARRY_FORWARD',
        payElementVisibilityDefault: 'SUMMARY',
      },
    })
  }

  // ── Employee categories (create-only: never clobber admin edits) ──
  const categoryByCode: Record<string, string> = {}
  for (const c of TIPS_CATEGORIES) {
    const row = await prisma.employeeCategory.upsert({
      where: { companyId_code: { companyId: company.id, code: c.code } },
      update: {},
      create: {
        companyId: company.id,
        code: c.code,
        name: c.name,
        description: c.description,
        status: 'ACTIVE',
        defaultPayFrequency: c.defaultPayFrequency,
        isStatutoryExempt: c.isStatutoryExempt,
        priority: c.priority,
      },
    })
    categoryByCode[c.code] = row.id
  }

  // ── Pay groups (create-only) ──
  const payGroupByCode: Record<string, string> = {}
  for (const g of TIPS_PAY_GROUPS) {
    const row = await prisma.payGroup.upsert({
      where: { companyId_code: { companyId: company.id, code: g.code } },
      update: {},
      create: {
        companyId: company.id,
        code: g.code,
        name: g.name,
        description: g.description,
        status: 'ACTIVE',
        approverRoles: g.approverRoles.length ? JSON.stringify(g.approverRoles) : null,
        priority: g.priority,
      },
    })
    payGroupByCode[g.code] = row.id
  }

  // ── One Employee per User (create-if-absent, keyed on the unique userId) ──
  let employeesCreated = 0
  const users = await prisma.user.findMany({ select: { id: true, role: true, isCasual: true, outletId: true, createdAt: true } })
  for (const u of users) {
    const existing = await prisma.employee.findUnique({ where: { userId: u.id } })
    if (existing) continue
    const { categoryCode, payGroupCode } = classifyUser(u.role, u.isCasual)
    await prisma.employee.create({
      data: {
        userId: u.id,
        // personId left null on purpose — see the file header (no fuzzy matching).
        categoryId: categoryByCode[categoryCode],
        payGroupId: payGroupByCode[payGroupCode],
        companyId: company.id,
        outletId: u.outletId ?? null,
        hireDate: u.createdAt ?? null,
        status: 'ACTIVE',
        baseCurrency: 'TZS',
        baseSalary: 0, // admin sets real base pay in Phase 2
        paymentMethod: 'BANK',
      },
    })
    employeesCreated++
  }

  // ── Phase 2: formulas, components, and group-level assignments (create-only) ──
  const formulaByCode: Record<string, string> = {}
  for (const f of PAYROLL_FORMULAS) {
    const row = await prisma.payrollFormula.upsert({
      where: { companyId_code: { companyId: company.id, code: f.code } },
      update: {},
      create: { companyId: company.id, code: f.code, name: f.name, description: f.description, expression: f.expression, variables: JSON.stringify(f.variables), returnType: 'NUMBER' },
    })
    formulaByCode[f.code] = row.id
  }

  const componentByCode: Record<string, string> = {}
  for (const c of PAYROLL_COMPONENTS) {
    const row = await prisma.payComponent.upsert({
      where: { companyId_code: { companyId: company.id, code: c.code } },
      update: {},
      create: {
        companyId: company.id,
        code: c.code,
        name: c.name,
        description: c.description,
        status: 'ACTIVE',
        componentType: c.componentType,
        calcMethod: c.calcMethod,
        parameters: c.parameters ? JSON.stringify(c.parameters) : null,
        formulaId: c.formulaCode ? formulaByCode[c.formulaCode] : null,
        taxable: c.taxable,
        pensionable: c.pensionable,
        priority: c.priority,
        proratable: c.proratable ?? false,
        glMappingKey: c.glMappingKey ?? null,
      },
    })
    componentByCode[c.code] = row.id
  }

  // Group-level assignments — create-if-absent (no natural unique key, so guard
  // on componentId + payGroupId with employeeId null).
  let assignmentsCreated = 0
  for (const [groupCode, codes] of Object.entries(GROUP_COMPONENTS)) {
    const payGroupId = payGroupByCode[groupCode]
    if (!payGroupId) continue
    for (const code of codes) {
      const componentId = componentByCode[code]
      if (!componentId) continue
      const existing = await prisma.componentAssignment.findFirst({ where: { componentId, payGroupId, employeeId: null } })
      if (existing) continue
      await prisma.componentAssignment.create({ data: { componentId, payGroupId } })
      assignmentsCreated++
    }
  }

  // ── Phase 4: TZ statutory pack (create-only, effective-dated) ──
  for (const s of TZ_STATUTORY) {
    await prisma.statutoryRule.upsert({
      where: { companyId_code_effectiveFrom: { companyId: company.id, code: s.code, effectiveFrom: TZ_STATUTORY_EFFECTIVE_FROM } },
      update: {},
      create: {
        companyId: company.id,
        code: s.code,
        name: s.name,
        jurisdiction: 'TZ',
        authority: s.authority,
        ruleType: s.ruleType,
        baseVar: s.baseVar,
        parameters: s.parameters ? JSON.stringify(s.parameters) : null,
        employeeRate: s.employeeRate ?? null,
        employerRate: s.employerRate ?? null,
        glMappingKey: s.glMappingKey,
        isEmployer: s.isEmployer,
        effectiveFrom: TZ_STATUTORY_EFFECTIVE_FROM,
      },
    })
  }

  // ── Phase 4b: leave types (create-only) ──
  for (const l of LEAVE_TYPES) {
    await prisma.leaveType.upsert({
      where: { companyId_code: { companyId: company.id, code: l.code } },
      update: {},
      create: { companyId: company.id, code: l.code, name: l.name, description: l.description, status: 'ACTIVE', paid: l.paid, accrualDaysPerMonth: l.accrualDaysPerMonth, maxCarryForward: l.maxCarryForward, encashable: l.encashable, requiresApproval: true },
    })
  }

  return { categories: TIPS_CATEGORIES.length, payGroups: TIPS_PAY_GROUPS.length, employees: employeesCreated, components: PAYROLL_COMPONENTS.length, assignments: assignmentsCreated, statutoryRules: TZ_STATUTORY.length, leaveTypes: LEAVE_TYPES.length }
}
