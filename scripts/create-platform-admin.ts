// Create the platform-owner identity (the product owner who manages the company directory).
// Create-only: refuses if the email already exists. Nothing is printed except the email.
//
//   PLATFORM_ADMIN_EMAIL=you@example.com PLATFORM_ADMIN_NAME="Your Name" PLATFORM_ADMIN_PASSWORD='<12+ chars>' \
//   DATABASE_URL=<target db url> npx tsx scripts/create-platform-admin.ts
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const isPg = /^postgres(ql)?:\/\//.test(url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter: isPg ? new PrismaPg({ connectionString: url }) : new PrismaBetterSqlite3({ url }) } as any)

async function main() {
  const email = (process.env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase()
  const name = (process.env.PLATFORM_ADMIN_NAME || 'Platform Owner').trim()
  const password = process.env.PLATFORM_ADMIN_PASSWORD || ''
  if (!email || !email.includes('@')) throw new Error('Set PLATFORM_ADMIN_EMAIL')
  if (password.length < 12) throw new Error('PLATFORM_ADMIN_PASSWORD must be at least 12 characters')
  if (await prisma.platformAdmin.findUnique({ where: { email } })) throw new Error(`A platform admin with ${email} already exists`)
  const admin = await prisma.platformAdmin.create({ data: { email, name, password: await bcrypt.hash(password, 12) } })
  await prisma.platformAuditLog.create({ data: { adminId: admin.id, action: 'CREATE_PLATFORM_ADMIN', entity: 'PlatformAdmin', entityId: admin.id, details: 'Created via script' } })
  console.log(`Platform admin created: ${email}`)
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) }).finally(() => prisma.$disconnect())
