// #111 residual — Subledger ↔ General Ledger reconciliation diagnostic.
//
// Proves (or disproves) that the GL control accounts tie to the operational
// subledgers that feed them — the core "book of record" test. Read-only: it
// posts nothing and changes nothing, it just reports each control account's GL
// balance, the independent subledger total, and the variance.
//
// Checks per company:
//   1. GL trial balance is balanced (Σ debit == Σ credit, non-reversed).
//   2. Accounts Receivable (1300)  vs outstanding POSTED credit-bearing bills.
//   3. Staff-loss receivable        — outstanding STAFF_LOSS bills that never
//      reach the GL at all (the known residual gap; GL representation is 0).
//   4. Excess Payable (2200)        vs outstanding PAYABLE collection excess.
//   5. Customer Deposits (2400)     — GL balance (informational; no single table).
//   6. Inventory Asset (1100)       vs stock-on-hand at standard cost.
//
// Usage:  npx tsx scripts/reconcile-subledgers-to-gl.ts
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { resolveAccountId } from '../lib/finance-mapping'
import { classForReason } from '../lib/reconciliation-classification'
import { CREDIT_BILL_TYPES } from '../lib/bill-types'
import { roundMoney } from '../lib/utils'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Net GL balance for an account (non-reversed lines): debit - credit. */
async function glNet(accountId: string): Promise<number> {
  const a = await prisma.journalLine.aggregate({
    where: { accountId, journalEntry: { status: { not: 'REVERSED' } } },
    _sum: { debit: true, credit: true },
  })
  return roundMoney((a._sum.debit || 0) - (a._sum.credit || 0))
}

function line(label: string, sub: number, gl: number, note?: string) {
  const variance = roundMoney(sub - gl)
  const flag = Math.abs(variance) < 0.01 ? 'OK  ' : '>>> '
  console.log(`  ${flag}${label.padEnd(30)} subledger ${money(sub).padStart(14)}  GL ${money(gl).padStart(14)}  variance ${money(variance).padStart(12)}${note ? '  ' + note : ''}`)
}

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } })
  for (const company of companies) {
    console.log(`\n=== ${company.name} ===`)

    // 1. Trial balance
    const tb = await prisma.journalLine.aggregate({
      where: { journalEntry: { companyId: company.id, status: { not: 'REVERSED' } } },
      _sum: { debit: true, credit: true },
    })
    const tbDr = roundMoney(tb._sum.debit || 0), tbCr = roundMoney(tb._sum.credit || 0)
    console.log(`  ${Math.abs(tbDr - tbCr) < 0.01 ? 'OK  ' : '>>> '}Trial balance                  debits ${money(tbDr).padStart(14)}  credits ${money(tbCr).padStart(11)}`)

    // Paid-per-bill (across all this company's bills at once).
    const bills = await prisma.signedBill.findMany({
      where: { outlet: { companyId: company.id } },
      select: { id: true, billType: true, amount: true, status: true, journalEntryId: true, payments: { select: { amountPaid: true } } },
    })
    const outstanding = (b: (typeof bills)[number]) => roundMoney(b.amount - b.payments.reduce((s, p) => s + p.amountPaid, 0))

    // 2. Accounts Receivable — outstanding on POSTED credit-bearing bills.
    const arAccountId = await resolveAccountId(prisma as never, { companyId: company.id, key: 'ACCOUNTS_RECEIVABLE' })
    const arSub = roundMoney(bills
      .filter((b) => b.journalEntryId && b.status !== 'WRITTEN_OFF' && CREDIT_BILL_TYPES.includes(b.billType as (typeof CREDIT_BILL_TYPES)[number]))
      .reduce((s, b) => s + outstanding(b), 0))
    line('Accounts Receivable (1300)', arSub, await glNet(arAccountId))

    // 3. Staff-loss receivable — outstanding STAFF_LOSS bills. These never post
    //    to the GL, so their GL representation is 0: the whole balance is the gap.
    const staffSub = roundMoney(bills
      .filter((b) => b.billType === 'STAFF_LOSS' && b.status !== 'WRITTEN_OFF')
      .reduce((s, b) => s + outstanding(b), 0))
    line('Staff-loss receivable', staffSub, 0, staffSub > 0.01 ? '<- unrepresented in GL' : '')

    // 4. Excess Payable — outstanding PAYABLE-class collection excess.
    const excessAccountId = await resolveAccountId(prisma as never, { companyId: company.id, key: 'EXCESS_PAYABLE' })
    const excesses = await prisma.collectionExcess.findMany({
      where: { collection: { outlet: { companyId: company.id } } },
      select: { amount: true, paidAmount: true, reason: true, category: true, accountingClass: true },
    })
    const excessSub = roundMoney(excesses
      .filter((e) => (e.accountingClass || classForReason(e.reason, e.category)) === 'PAYABLE')
      .reduce((s, e) => s + Math.max(0, roundMoney(e.amount - e.paidAmount)), 0))
    // Liability: normal balance is a credit, so compare the subledger to the GL
    // credit balance (-glNet), not the debit-normal net.
    line('Excess Payable (2200)', excessSub, -(await glNet(excessAccountId)))

    // 5. Customer Deposits — informational (no single feeder table to total).
    const depAccountId = await resolveAccountId(prisma as never, { companyId: company.id, key: 'CUSTOMER_DEPOSITS' })
    console.log(`  --- Customer Deposits (2400)        GL balance ${money(-(await glNet(depAccountId))).padStart(14)}  (liability; informational)`)

    // 6. Inventory Asset — stock on hand at standard cost (buyingPrice).
    const invAccountId = await resolveAccountId(prisma as never, { companyId: company.id, key: 'INVENTORY_ASSET' })
    const levels = await prisma.stockLevel.findMany({ select: { quantity: true, product: { select: { buyingPrice: true } } } })
    const invSub = roundMoney(levels.reduce((s, l) => s + (l.quantity * (l.product?.buyingPrice || 0)), 0))
    line('Inventory Asset (1100)', invSub, await glNet(invAccountId), '(standard cost)')
  }
  console.log('')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
