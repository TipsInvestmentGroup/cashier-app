import { prisma } from '@/lib/prisma'

/**
 * Full logical backup of every table → a plain JSON object.
 * Used by the weekly cron (emails it to directors) and the on-demand download.
 * Note: includes hashed (not plaintext) user passwords so logins can be restored.
 */
export async function dumpDatabase() {
  const [
    users, outlets, dailyCollections, persons, signedBills, paidBills, billItems,
    pettyCash, cashRecon, bankRecon, settings, departments, pettyFunctions,
    products, cancellations, personCategories, paymentChannels, auditLogs,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.outlet.findMany(),
    prisma.dailyCollection.findMany(),
    prisma.person.findMany(),
    prisma.signedBill.findMany(),
    prisma.paidBill.findMany(),
    prisma.billItem.findMany(),
    prisma.pettyCash.findMany(),
    prisma.cashRecon.findMany(),
    prisma.bankRecon.findMany(),
    prisma.setting.findMany(),
    prisma.department.findMany(),
    prisma.pettyFunction.findMany(),
    prisma.product.findMany(),
    prisma.cancellation.findMany(),
    prisma.personCategory.findMany(),
    prisma.paymentChannel.findMany(),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5000 }),
  ])

  const data = {
    users, outlets, dailyCollections, persons, signedBills, paidBills, billItems,
    pettyCash, cashRecon, bankRecon, settings, departments, pettyFunctions,
    products, cancellations, personCategories, paymentChannels, auditLogs,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, (v as any[]).length]))

  return { version: 1, generatedAt: new Date().toISOString(), counts, data }
}
