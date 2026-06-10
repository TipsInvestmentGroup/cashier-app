import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import 'dotenv/config'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

async function main() {
  console.log('🌱 Seeding database...')

  // Create outlets
  const mikocheni = await prisma.outlet.upsert({
    where: { name: 'Mikocheni Outlet' },
    update: {},
    create: { name: 'Mikocheni Outlet', location: 'Mikocheni, Dar es Salaam' },
  })
  const cocoBeach = await prisma.outlet.upsert({
    where: { name: 'Coco Beach Outlet' },
    update: {},
    create: { name: 'Coco Beach Outlet', location: 'Coco Beach, Dar es Salaam' },
  })
  console.log('✅ Outlets created')

  // Hash passwords
  const adminPass = await bcrypt.hash('admin123', 12)
  const cashierPass = await bcrypt.hash('cashier123', 12)
  const managerPass = await bcrypt.hash('manager123', 12)
  const directorPass = await bcrypt.hash('director123', 12)
  const accountantPass = await bcrypt.hash('accountant123', 12)

  // Create users
  await prisma.user.upsert({
    where: { email: 'admin@lounge.com' },
    update: {},
    create: { name: 'System Admin', email: 'admin@lounge.com', password: adminPass, role: 'ADMIN' },
  })
  await prisma.user.upsert({
    where: { email: 'cashier@lounge.com' },
    update: {},
    create: { name: 'Jane Cashier', email: 'cashier@lounge.com', password: cashierPass, role: 'CASHIER', outletId: mikocheni.id },
  })
  await prisma.user.upsert({
    where: { email: 'cashier2@lounge.com' },
    update: {},
    create: { name: 'Mary Cashier', email: 'cashier2@lounge.com', password: cashierPass, role: 'CASHIER', outletId: cocoBeach.id },
  })
  await prisma.user.upsert({
    where: { email: 'manager@lounge.com' },
    update: {},
    create: { name: 'Peter Manager', email: 'manager@lounge.com', password: managerPass, role: 'MANAGER' },
  })
  await prisma.user.upsert({
    where: { email: 'director@lounge.com' },
    update: {},
    create: { name: 'Dr. James Director', email: 'director@lounge.com', password: directorPass, role: 'DIRECTOR' },
  })
  await prisma.user.upsert({
    where: { email: 'accountant@lounge.com' },
    update: {},
    create: { name: 'Sarah Accountant', email: 'accountant@lounge.com', password: accountantPass, role: 'ACCOUNTANT' },
  })
  console.log('✅ Users created')

  // Create persons (directors, admins, customers)
  const existingPersons = await prisma.person.count()
  if (existingPersons === 0) await prisma.person.createMany({
    data: [
      { name: 'Dr. James Director', phone: '+255712000001', type: 'DIRECTOR', creditLimit: 1000000 },
      { name: 'Prof. Alice Director', phone: '+255712000002', type: 'DIRECTOR', creditLimit: 800000 },
      { name: 'Mr. Bob Admin', phone: '+255712000003', type: 'ADMIN', creditLimit: 300000 },
      { name: 'Ms. Carol Admin', phone: '+255712000004', type: 'ADMIN', creditLimit: 250000 },
      { name: 'John Customer', phone: '+255712000005', type: 'CUSTOMER' },
      { name: 'Fatima Customer', phone: '+255712000006', type: 'CUSTOMER' },
      { name: 'DJ Bongo', phone: '+255712000007', type: 'DJ' },
      { name: 'DJ Fire', phone: '+255712000008', type: 'DJ' },
      { name: 'Amina Waitress', phone: '+255712000009', type: 'STAFF_LOSS' },
      { name: 'Grace Waitress', phone: '+255712000010', type: 'STAFF_LOSS' },
    ],
  })
  console.log('✅ Persons created')

  console.log('\n🎉 Database seeded successfully!')
  console.log('\n📋 Login Credentials:')
  console.log('  Admin:       admin@lounge.com       / admin123')
  console.log('  Cashier:     cashier@lounge.com     / cashier123')
  console.log('  Manager:     manager@lounge.com     / manager123')
  console.log('  Director:    director@lounge.com    / director123')
  console.log('  Accountant:  accountant@lounge.com  / accountant123')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
