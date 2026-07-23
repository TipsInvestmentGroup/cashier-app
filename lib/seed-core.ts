import bcrypt from 'bcryptjs'
import fs from 'fs'
import path from 'path'
import { seedStandardCollectionTemplate } from './collection-template-seed'
import { seedCreditFramework } from './credit-seed'
import { seedExpenseFramework } from './expense-seed'
import { seedPayrollFramework } from './payroll-seed'
import { RECONCILIATION_STAGE_RESOURCES as RSR, WRITE_OFF_RESOURCES as WOR } from './rbac'
import { classForReason } from './reconciliation-classification'

// Sensible role defaults for the Reconciliation Workflow Engine + Write-Off
// resources. Each entry lists the roles GRANTED that resource; every other
// role resolves to deny (no row). Seeded create-only-if-absent so it never
// overrides a choice the owner later makes in Reconciliation Settings.
// Write-off APPROVE is kept above the requesters (DIRECTOR/ADMIN only) to
// preserve separation of duties. See docs/reconciliation-workflow-engine-design.md §7/§12.4.
const RECON_ROLE_DEFAULTS: Record<string, string[]> = {
  [RSR.VIEW_RECONCILIATION_STAGES]: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'],
  [RSR.CLOSE_CASHIER_RECON]: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN'],
  [RSR.CLOSE_FINANCE_RECON]: ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'],
  [RSR.CLOSE_FINANCIAL_CLOSE]: ['DIRECTOR', 'ADMIN'],
  [RSR.UNLOCK_RECONCILIATION_STAGE]: ['MANAGER', 'DIRECTOR', 'ADMIN'],
  [RSR.APPROVE_RECONCILIATION_UNLOCK]: ['MANAGER', 'DIRECTOR', 'ADMIN'],
  [RSR.MANAGE_RECONCILIATION_CONFIG]: ['DIRECTOR', 'ADMIN'],
  [RSR.VERIFY_PAYMENT]: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN'],
  [RSR.VIEW_RECONCILIATION_AUDIT_LOG]: ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'],
  [WOR.REQUEST_WRITE_OFF]: ['CASHIER', 'ACCOUNTANT', 'MANAGER'],
  [WOR.APPROVE_WRITE_OFF]: ['DIRECTOR', 'ADMIN'],
  [WOR.VIEW_WRITE_OFFS]: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'],
}

/**
 * Seeds default role grants for the reconciliation/write-off resources,
 * create-only-if-absent so re-running never clobbers the owner's later
 * customizations in Reconciliation Settings. Only writes `allowed: true`
 * rows for granted roles; denied roles simply have no row (resolves to deny).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seedReconciliationRoleDefaults(prisma: any): Promise<number> {
  let created = 0
  for (const [resource, roles] of Object.entries(RECON_ROLE_DEFAULTS)) {
    for (const role of roles) {
      const existing = await prisma.rolePermission.findUnique({ where: { role_resource: { role, resource } } })
      if (!existing) {
        await prisma.rolePermission.create({ data: { role, resource, allowed: true } })
        created++
      }
    }
  }
  return created
}

interface SeedPerson { name: string; phone: string | null; type: string; creditLimit: number }
interface RosterEntry { name: string; position: 'OUTSIDE STAFF' | 'BAR LADY' | 'VIP BAR' | 'SHISHA COUNTER' | 'KITCHEN COUNTER'; outlet: string }

// Real staff/customer names never live in this file or in git — only in the
// gitignored `*.local.json` sibling. A fresh clone falls back to the small
// placeholder file that IS committed, so seeding still works out of the box.
function loadSeedJson<T>(basename: string): T {
  const local = path.join(process.cwd(), 'prisma', `${basename}.local.json`)
  const sample = path.join(process.cwd(), 'prisma', `${basename}.json`)
  const file = fs.existsSync(local) ? local : sample
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
}

/**
 * Backfills accountingClass on every ExcessReason row from the reason code
 * (drift-proof — correct even where the legacy `category` drifted). Idempotent:
 * only writes rows whose class differs. Corrects deployments seeded before the
 * accounting-classification layer existed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function backfillExcessReasonAccountingClass(prisma: any): Promise<number> {
  const rows = await prisma.excessReason.findMany()
  let updated = 0
  for (const r of rows) {
    const cls = classForReason(r.code, r.category)
    if (r.accountingClass !== cls) {
      await prisma.excessReason.update({ where: { id: r.id }, data: { accountingClass: cls } })
      updated++
    }
  }
  return updated
}

/**
 * Idempotent seeding shared by the CLI seed (prisma/seed.ts) and the
 * /api/admin/seed endpoint. Creates the 2 outlets, the role login users,
 * and the Directors/Admins/Staff persons (from persons.seed.json).
 * Safe to run repeatedly: outlets/users are upserted; persons only created
 * if the table is empty.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seedCore(prisma: any) {
  const TAX = { legalName: 'TIPS INVESTMENT LTD', tin: '132-051-100', vrn: '40-028205-X' }
  const mikocheni = await prisma.outlet.upsert({
    where: { name: 'Mikocheni Outlet' },
    update: TAX,
    create: { name: 'Mikocheni Outlet', location: 'Mikocheni, Dar es Salaam', ...TAX },
  })
  const cocoBeach = await prisma.outlet.upsert({
    where: { name: 'Coco Beach Outlet' },
    update: TAX,
    create: { name: 'Coco Beach Outlet', location: 'Coco Beach, Dar es Salaam', ...TAX },
  })
  // Events-only outlet: never auto-rostered; staffed temporarily per event.
  await prisma.outlet.upsert({
    where: { name: 'Tips Events' },
    update: { isEventsOnly: true },
    create: { name: 'Tips Events', location: 'External events & functions', isEventsOnly: true },
  })
  // Central stock location that GRNs receive into and transfers issue out of.
  await prisma.warehouse.upsert({
    where: { name: 'Main Store' },
    update: {},
    create: { name: 'Main Store' },
  })

  // Collection Workflow Engine: Company + "Standard Staff Collection" template
  // metadata, and backfills both sales outlets' defaultTemplateId. Purely
  // additive — DailyCollection storage/behavior is unchanged.
  await seedStandardCollectionTemplate(prisma, [mikocheni.id, cocoBeach.id])

  const users = [
    { email: 'admin@lounge.com', name: 'System Admin', role: 'ADMIN', pass: 'admin123', outletId: null },
    { email: 'cashier@lounge.com', name: 'Jane Cashier', role: 'CASHIER', pass: 'cashier123', outletId: mikocheni.id },
    { email: 'cashier2@lounge.com', name: 'Mary Cashier', role: 'CASHIER', pass: 'cashier123', outletId: cocoBeach.id },
    { email: 'manager@lounge.com', name: 'Peter Manager', role: 'MANAGER', pass: 'manager123', outletId: null },
    { email: 'director@lounge.com', name: 'Dr. James Director', role: 'DIRECTOR', pass: 'director123', outletId: null },
    { email: 'accountant@lounge.com', name: 'Sarah Accountant', role: 'ACCOUNTANT', pass: 'accountant123', outletId: null },
    // Test waiters — one of each role in the order workflow, at both outlets,
    // so a full VIP prep / Main Bar direct-serve run can be tested end-to-end.
    // VIP model:    Outside → creates order → Abdul preps/serves at SHISHA/KITCHEN → notifies → Outside collects, prints & takes payment.
    // Main Bar:     Bar Lady → creates order → serves instantly at BAR/MAIN → prints & takes payment.
    { email: 'outside.coco@lounge.com', name: 'Fatuma Outside', role: 'WAITER', pass: 'waiter123', outletId: cocoBeach.id },
    { email: 'abdul.coco@lounge.com', name: 'Abdul VIP', role: 'WAITER', pass: 'waiter123', outletId: cocoBeach.id },
    { email: 'barlady.coco@lounge.com', name: 'Warda Bar Lady', role: 'WAITER', pass: 'waiter123', outletId: cocoBeach.id },
    { email: 'outside.mikocheni@lounge.com', name: 'Neema Outside', role: 'WAITER', pass: 'waiter123', outletId: mikocheni.id },
    { email: 'kitchen.mikocheni@lounge.com', name: 'Juma Kitchen', role: 'WAITER', pass: 'waiter123', outletId: mikocheni.id },
    { email: 'barlady.mikocheni@lounge.com', name: 'Rehema Bar Lady', role: 'WAITER', pass: 'waiter123', outletId: mikocheni.id },
  ]
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { name: u.name, email: u.email, password: await bcrypt.hash(u.pass, 12), role: u.role, outletId: u.outletId },
    })
  }

  // Real MyPos floor staff, from the business's staff roster (waiters.xlsx).
  // They sign in on the terminal via the PIN picker, not email+password, so
  // email here is just an internal placeholder to satisfy the unique
  // constraint — never shown to them. Default PIN "1234" for everyone on
  // first seed; change per-person via Setup → Users once live.
  const slug = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '')
  const DEFAULT_PIN = '1234'
  // outletTag ('mik'/'coco') feeds the generated placeholder email below —
  // kept exactly as before so re-running this against an already-seeded
  // database still upserts the same existing users instead of creating new ones.
  const OUTLET_BY_TAG: Record<string, { id: string; tag: string }> = {
    mikocheni: { id: mikocheni.id, tag: 'mik' },
    coco: { id: cocoBeach.id, tag: 'coco' },
  }
  const rosterData = loadSeedJson<RosterEntry[]>('waiter-roster')
  const waiterRoster = rosterData.map((w) => ({
    name: w.name,
    position: w.position,
    outletId: OUTLET_BY_TAG[w.outlet]?.id ?? mikocheni.id,
    outletTag: OUTLET_BY_TAG[w.outlet]?.tag ?? 'mik',
  }))
  const hashedDefaultPin = await bcrypt.hash(DEFAULT_PIN, 12)
  for (const w of waiterRoster) {
    const email = `${slug(w.name)}.${w.outletTag}@staff.internal`
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        name: w.name, email, password: await bcrypt.hash('staffLogin123', 12), role: 'WAITER',
        outletId: w.outletId, position: w.position, pin: hashedDefaultPin,
      },
    })
  }
  const waitersCreated = waiterRoster.length

  let personsCreated = 0
  const existing = await prisma.person.count()
  if (existing === 0) {
    const personsData = loadSeedJson<SeedPerson[]>('persons.seed')
    for (const p of personsData) {
      await prisma.person.create({
        data: { name: p.name, phone: p.phone ?? null, type: p.type, creditLimit: p.creditLimit ?? 0, isActive: true },
      })
      personsCreated++
    }
  }

  const reconRoleDefaults = await seedReconciliationRoleDefaults(prisma)
  const excessClassBackfill = await backfillExcessReasonAccountingClass(prisma)

  // Universal Credit Framework (Phase 1): module config + 6 TIPS credit groups
  // + a CreditAccount per Person. Idempotent, additive — safe to run after the
  // persons above exist so accounts can bind to them.
  const credit = await seedCreditFramework(prisma)

  // Universal Payroll Framework (Phase 1 — foundation): module config (DISABLED),
  // employee categories + pay groups, and one Employee per User. Idempotent,
  // additive — runs after users exist so employees can bind to them. Changes no
  // behaviour while the module is disabled.
  const payroll = await seedPayrollFramework(prisma)

  // Universal Expense & Disbursement Framework (Phase 1 — config + core
  // workflow): module config, one "Petty Cash Request" request type, an
  // ExpenseCategory per existing PettyFunction, and a FundingSource per
  // existing PettyFund. Idempotent, additive — PettyCash keeps working
  // unmodified; nothing reads these new rows yet until the engine's own
  // screens are built.
  const expense = await seedExpenseFramework(prisma)

  return { outlets: 2, users: users.length, waitersSeeded: waitersCreated, personsCreated, personsExisting: existing, reconRoleDefaults, excessClassBackfill, creditGroups: credit.groups, creditAccounts: credit.accounts, payrollCategories: payroll.categories, payrollPayGroups: payroll.payGroups, employees: payroll.employees, payrollComponents: payroll.components, payrollAssignments: payroll.assignments, payrollStatutoryRules: payroll.statutoryRules, payrollLeaveTypes: payroll.leaveTypes, expenseCategories: expense.categories, expenseFundingSources: expense.fundingSources }
}
