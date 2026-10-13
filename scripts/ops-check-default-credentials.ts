// READ-ONLY audit: which accounts still use the publicly-known credentials that older versions
// of the seed created? Prints account emails/names only - never hashes. Changes nothing.
//
//   DATABASE_URL=<target db url> npx tsx scripts/ops-check-default-credentials.ts
//
// Why this exists: before the Phase 1 security hardening, the seed (which runs on every deploy)
// created demo logins with fixed passwords (admin123, cashier123, ...), PIN-only floor staff with
// a fixed password (staffLogin123) and PIN 1234. Changing the seed cannot fix rows that already
// exist, so this finds them. For each hit: reset the password / set a new PIN in Setup -> Users
// (or deactivate the demo account).
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const isPg = /^postgres(ql)?:\/\//.test(url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter: isPg ? new PrismaPg({ connectionString: url }) : new PrismaBetterSqlite3({ url }) } as any)

// email -> the fixed password the old seed gave it
const DEMO: Record<string, string> = {
  'admin@lounge.com': 'admin123',
  'cashier@lounge.com': 'cashier123',
  'cashier2@lounge.com': 'cashier123',
  'manager@lounge.com': 'manager123',
  'director@lounge.com': 'director123',
  'accountant@lounge.com': 'accountant123',
  'outside.coco@lounge.com': 'waiter123',
  'abdul.coco@lounge.com': 'waiter123',
  'barlady.coco@lounge.com': 'waiter123',
  'outside.mikocheni@lounge.com': 'waiter123',
  'kitchen.mikocheni@lounge.com': 'waiter123',
  'barlady.mikocheni@lounge.com': 'waiter123',
}
const WEAK_PINS = ['1234', '0000', '1111', '4321']

async function main() {
  console.log(`Target: ${isPg ? 'postgres (remote)' : url}\n`)
  const users = await prisma.user.findMany({
    select: { email: true, name: true, role: true, isActive: true, password: true, pin: true },
  })

  const demoHits: string[] = []
  const placeholderHits: string[] = []
  const pinHits: string[] = []
  let checked = 0

  for (const u of users) {
    const email = u.email.toLowerCase()
    if (DEMO[email] && (await bcrypt.compare(DEMO[email], u.password))) {
      demoHits.push(`${u.email}  (${u.role}${u.isActive ? ', ACTIVE' : ', inactive'})  password is the public default`)
    }
    if (email.endsWith('@staff.internal') && (await bcrypt.compare('staffLogin123', u.password))) {
      // Email login is now refused for this domain, so this is low risk - listed for completeness.
      placeholderHits.push(`${u.name} <${u.email}>  fixed placeholder password (email login is blocked; PIN login unaffected)`)
    }
    if (u.pin) {
      for (const pin of WEAK_PINS) {
        if (await bcrypt.compare(pin, u.pin)) { pinHits.push(`${u.name} <${u.email}>  (${u.isActive ? 'ACTIVE' : 'inactive'})  PIN is ${pin}`); break }
      }
    }
    checked++
  }

  const section = (title: string, rows: string[]) => {
    console.log(`${title}: ${rows.length}`)
    rows.forEach((r) => console.log('  - ' + r))
    console.log()
  }
  section('1. Demo accounts still on their PUBLIC default password (fix first)', demoHits)
  section('2. Floor staff with a weak/default PIN (1234, 0000, 1111, 4321)', pinHits)
  section('3. Placeholder staff accounts with the old fixed password (informational)', placeholderHits)
  console.log(`Checked ${checked} accounts.`)
  if (demoHits.length || pinHits.length) {
    console.log('ACTION NEEDED: reset those passwords / set new PINs in Setup -> Users, or deactivate unused demo accounts.')
    process.exitCode = 1
  } else {
    console.log('No default credentials found.')
  }
}

main().catch((e) => { console.error(e); process.exit(2) }).finally(() => prisma.$disconnect())
