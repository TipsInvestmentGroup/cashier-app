import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import 'dotenv/config'

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

async function main() {
  // Find the bills touched by PAYROLL payments
  const payrollPays = await prisma.paidBill.findMany({
    where: { paymentMethod: 'PAYROLL' },
    select: { id: true, signedBillId: true },
  })
  const billIds = [...new Set(payrollPays.map((p) => p.signedBillId).filter(Boolean))] as string[]

  // Delete the PAYROLL payments
  const del = await prisma.paidBill.deleteMany({ where: { paymentMethod: 'PAYROLL' } })

  // Recompute status of affected bills
  for (const id of billIds) {
    const bill = await prisma.signedBill.findUnique({ where: { id }, select: { amount: true } })
    if (!bill) continue
    const agg = await prisma.paidBill.aggregate({ where: { signedBillId: id }, _sum: { amountPaid: true } })
    const totalPaid = agg._sum.amountPaid || 0
    const status = totalPaid >= bill.amount ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID'
    await prisma.signedBill.update({ where: { id }, data: { status } })
  }

  console.log(`Restored: deleted ${del.count} PAYROLL payments, reset ${billIds.length} bills`)
}
main().finally(() => prisma.$disconnect())
