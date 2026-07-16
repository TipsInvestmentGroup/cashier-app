import bcrypt from 'bcryptjs'
import fs from 'fs'
import path from 'path'

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

  return { outlets: 2, users: users.length, waitersSeeded: waitersCreated, personsCreated, personsExisting: existing }
}
