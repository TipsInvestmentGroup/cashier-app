import * as XLSX from 'xlsx'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import 'dotenv/config'

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

const FILE = 'C:/Users/HP/OneDrive/Desktop/CODE/DIRECTORS,ADIMN&STAFF.xlsx'

// Section header text -> Person.type used by the app
const SECTION_TYPE: Record<string, string> = {
  DIRECTORS: 'DIRECTOR',
  ADMINS: 'ADMIN',
  STAFF: 'STAFF_LOSS',
}

// Placeholder persons created by the seed (no real data) to clean up
const PLACEHOLDERS = [
  'Dr. James Director', 'Prof. Alice Director',
  'Mr. Bob Admin', 'Ms. Carol Admin',
  'Amina Waitress', 'Grace Waitress',
]

function toNumber(v: unknown): number {
  if (typeof v === 'number' && !isNaN(v)) return v
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''))
  return isNaN(n) ? 0 : n
}

async function main() {
  const wb = XLSX.readFile(FILE)
  const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: '',
  })

  type Entry = { name: string; type: string; creditLimit: number }
  const entries: Entry[] = []
  let currentType: string | null = null

  for (const row of rows) {
    const c0 = String(row[0] ?? '').trim()
    const c1 = row[1]
    if (!c0) continue

    const upper = c0.toUpperCase()

    // Section header?
    if (SECTION_TYPE[upper]) {
      currentType = SECTION_TYPE[upper]
      continue
    }
    // Skip column header & totals rows
    if (upper === 'NAME' || upper === 'TOTAL') continue
    if (!currentType) continue

    entries.push({
      name: c0,
      type: currentType,
      creditLimit: toNumber(c1),
    })
  }

  console.log(`Parsed ${entries.length} persons from Excel:`)
  const counts = entries.reduce<Record<string, number>>((a, e) => {
    a[e.type] = (a[e.type] || 0) + 1
    return a
  }, {})
  console.log('  By type:', counts)

  let created = 0
  let updated = 0
  for (const e of entries) {
    // Idempotent: match by name + type
    const existing = await prisma.person.findFirst({
      where: { name: e.name, type: e.type },
    })
    if (existing) {
      await prisma.person.update({
        where: { id: existing.id },
        data: { creditLimit: e.creditLimit, isActive: true },
      })
      updated++
    } else {
      await prisma.person.create({
        data: { name: e.name, type: e.type, creditLimit: e.creditLimit, isActive: true },
      })
      created++
    }
  }

  // Remove seed placeholders that have no transactions
  let removed = 0
  for (const name of PLACEHOLDERS) {
    const p = await prisma.person.findFirst({
      where: { name },
      include: { signedBills: true, paidBills: true },
    })
    if (p && p.signedBills.length === 0 && p.paidBills.length === 0) {
      await prisma.person.delete({ where: { id: p.id } })
      removed++
    }
  }

  console.log(`\n✅ Import complete: ${created} created, ${updated} updated, ${removed} placeholders removed`)

  // Summary
  for (const t of ['DIRECTOR', 'ADMIN', 'STAFF_LOSS']) {
    const list = await prisma.person.findMany({ where: { type: t }, orderBy: { name: 'asc' } })
    console.log(`\n${t} (${list.length}):`)
    list.forEach((p) =>
      console.log(`  - ${p.name.padEnd(28)} limit: ${p.creditLimit.toLocaleString()}`)
    )
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
