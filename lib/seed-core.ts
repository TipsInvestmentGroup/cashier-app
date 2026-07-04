import bcrypt from 'bcryptjs'
import personsData from '../prisma/persons.seed.json'

interface SeedPerson { name: string; phone: string | null; type: string; creditLimit: number }

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

  const users = [
    { email: 'admin@lounge.com', name: 'System Admin', role: 'ADMIN', pass: 'admin123', outletId: null },
    { email: 'cashier@lounge.com', name: 'Jane Cashier', role: 'CASHIER', pass: 'cashier123', outletId: mikocheni.id },
    { email: 'cashier2@lounge.com', name: 'Mary Cashier', role: 'CASHIER', pass: 'cashier123', outletId: cocoBeach.id },
    { email: 'manager@lounge.com', name: 'Peter Manager', role: 'MANAGER', pass: 'manager123', outletId: null },
    { email: 'director@lounge.com', name: 'Dr. James Director', role: 'DIRECTOR', pass: 'director123', outletId: null },
    { email: 'accountant@lounge.com', name: 'Sarah Accountant', role: 'ACCOUNTANT', pass: 'accountant123', outletId: null },
  ]
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { name: u.name, email: u.email, password: await bcrypt.hash(u.pass, 12), role: u.role, outletId: u.outletId },
    })
  }

  let personsCreated = 0
  const existing = await prisma.person.count()
  if (existing === 0) {
    for (const p of personsData as SeedPerson[]) {
      await prisma.person.create({
        data: { name: p.name, phone: p.phone ?? null, type: p.type, creditLimit: p.creditLimit ?? 0, isActive: true },
      })
      personsCreated++
    }
  }

  return { outlets: 2, users: users.length, personsCreated, personsExisting: existing }
}
