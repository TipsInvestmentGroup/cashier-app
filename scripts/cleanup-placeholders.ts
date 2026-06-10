import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import 'dotenv/config'

const prisma = new PrismaClient({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' }),
} as any)

const PLACEHOLDERS = ['Dr. James Director', 'Mr. Bob Admin']

async function main() {
  for (const name of PLACEHOLDERS) {
    const p = await prisma.person.findFirst({ where: { name } })
    if (!p) continue
    // delete dependent demo bills first
    await prisma.paidBill.deleteMany({ where: { personId: p.id } })
    await prisma.signedBill.deleteMany({ where: { personId: p.id } })
    await prisma.person.delete({ where: { id: p.id } })
    console.log(`Removed placeholder + demo bills: ${name}`)
  }

  const counts = {
    DIRECTOR: await prisma.person.count({ where: { type: 'DIRECTOR' } }),
    ADMIN: await prisma.person.count({ where: { type: 'ADMIN' } }),
    STAFF_LOSS: await prisma.person.count({ where: { type: 'STAFF_LOSS' } }),
  }
  console.log('\n✅ Final person counts:', counts)
}
main().finally(() => prisma.$disconnect())
