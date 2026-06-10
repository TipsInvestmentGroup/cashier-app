import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { seedCore } from '../lib/seed-core'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

async function main() {
  console.log('🌱 Seeding database...')
  const result = await seedCore(prisma)
  console.log(`✅ Outlets: ${result.outlets}, Users: ${result.users}, Persons created: ${result.personsCreated} (existing: ${result.personsExisting})`)
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
