// One-off diagnostic for the "Ops: List users" workflow — prints email,
// role, and active status only. Never selects password/pin/resetToken, so
// it's safe to run against production without handling any credential.
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

async function main() {
  const users = await prisma.user.findMany({
    select: { email: true, role: true, isActive: true, outletId: true },
    orderBy: [{ role: 'asc' }, { email: 'asc' }],
  })
  console.log(`${users.length} user(s):\n`)
  for (const u of users) {
    console.log(`${u.isActive ? '✓' : '✗'} ${u.role.padEnd(12)} ${u.email}${u.outletId ? `  (outlet: ${u.outletId})` : ''}`)
  }
}

main().finally(() => prisma.$disconnect())
