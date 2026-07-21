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
  glMappingKey?: string
  description: string
}

const PAYROLL_FORMULAS = [
  { code: 'BASE_PAY', name: 'Base Pay', expression: 'base', variables: ['base'], description: 'Basic salary = the employee base pay.' },
]

const PAYROLL_COMPONENTS: ComponentSeed[] = [
  { code: 'BASIC_SALARY', name: 'Basic Salary', componentType: 'EARNING', calcMethod: 'FORMULA', formulaCode: 'BASE_PAY', taxable: true, pensionable: true, priority: 0, glMappingKey: 'SALARY_EXPENSE', description: 'Monthly basic salary.' },
  { code: 'HOUSING_ALLOWANCE', name: 'Housing Allowance', componentType: 'ALLOWANCE', calcMethod: 'PERCENTAGE', parameters: { percent: 20, of: 'base' }, taxable: true, pensionable: false, priority: 10, glMappingKey: 'SALARY_EXPENSE', description: '20% of base pay.' },
  { code: 'OVERTIME', name: 'Overtime', componentType: 'EARNING', calcMethod: 'RATE_QTY', parameters: { rate: 5000, qtyVar: 'overtimeHours' }, taxable: true, pensionable: false, priority: 20, glMappingKey: 'SALARY_EXPENSE', description: 'Rate per overtime hour worked.' },
  { code: 'PENSION_EE', name: 'Pension (Employee)', componentType: 'DEDUCTION', calcMethod: 'PERCENTAGE', parameters: { percent: 10, of: 'pensionable' }, taxable: false, pensionable: false, priority: 10, glMappingKey: 'PENSION_PAYABLE', description: 'Employee pension contribution — 10% of pensionable pay.' },
  { code: 'STAFF_PURCHASES', name: 'Staff Purchases', componentType: 'DEDUCTION', calcMethod: 'SOURCED', parameters: { source: 'CREDIT_BALANCE' }, taxable: false, pensionable: false, priority: 90, glMappingKey: 'ACCOUNTS_RECEIVABLE', description: 'Recovery of the employee’s outstanding signed-bill balance (Credit framework).' },
]

// Which components each pay group grants (group-level assignments).
const GROUP_COMPONENTS: Record<string, string[]> = {
  MANAGEMENT: ['BASIC_SALARY', 'HOUSING_ALLOWANCE', 'PENSION_EE', 'STAFF_PURCHASES'],
  FLOOR_STAFF: ['BASIC_SALARY', 'OVERTIME', 'PENSION_EE', 'STAFF_PURCHASES'],
  CASUAL_EVENT: ['BASIC_SALARY', 'STAFF_PURCHASES'],
}

/**
 * Idempotent. Seeds the payroll module config (GLOBAL, disabled), the employee
 * categories and pay groups, then create-if-absent one Employee per User.
 * Returns counts for the seed summary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seedPayrollFramework(prisma: any): Promise<{ categories: number; payGroups: number; employees: number; components: number; assignments: number }> {
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

  return { categories: TIPS_CATEGORIES.length, payGroups: TIPS_PAY_GROUPS.length, employees: employeesCreated, components: PAYROLL_COMPONENTS.length, assignments: assignmentsCreated }
}
