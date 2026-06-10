import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import 'dotenv/config'

const prisma = new PrismaClient({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' }),
} as any)

async function main() {
  for (const name of ['Dr. James Director', 'Mr. Bob Admin']) {
    const p = await prisma.person.findFirst({
      where: { name },
      include: { signedBills: true, paidBills: true },
    })
    console.log(name, '-> signedBills:', p?.signedBills.length, 'paidBills:', p?.paidBills.length)
  }
  console.log('Total signed bills in DB:', await prisma.signedBill.count())
}
main().finally(() => prisma.$disconnect())
