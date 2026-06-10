import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import 'dotenv/config'

const prisma = new PrismaClient({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' }),
} as any)

async function main() {
  const persons = await prisma.person.findMany({
    where: { isActive: true },
    select: { name: true, phone: true, type: true, creditLimit: true },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  })
  const out = join(process.cwd(), 'prisma', 'persons.seed.json')
  writeFileSync(out, JSON.stringify(persons, null, 2))
  console.log(`Exported ${persons.length} persons to prisma/persons.seed.json`)
}
main().finally(() => prisma.$disconnect())
