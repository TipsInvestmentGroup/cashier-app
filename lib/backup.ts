import { prisma } from '@/lib/prisma'

/**
 * Full logical backup of every table → a plain JSON object.
 * Used by the weekly cron (emails it to directors) and the on-demand download.
 * Note: includes hashed (not plaintext) user passwords so logins can be restored.
 */
export async function dumpDatabase() {
  const [
    users, outlets, dailyCollections, persons, signedBills, paidBills, billItems,
    pettyCash, pettyCashItems, cashRecon, cashReconExcess, bankRecon, settings, departments, pettyFunctions,
    products, cancellations, personCategories, paymentChannels, auditLogs,
    pettyFunds, pettyFundTxns,
    expenseModuleConfigs, requestTypes, expenseCategories, fundingSources, fundingSourceTxns,
    expenseRequests, expenseItems, expensePayments, paymentAllocations, verificationRecords, attachments,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.outlet.findMany(),
    prisma.dailyCollection.findMany(),
    prisma.person.findMany(),
    prisma.signedBill.findMany(),
    prisma.paidBill.findMany(),
    prisma.billItem.findMany(),
    prisma.pettyCash.findMany(),
    prisma.pettyCashItem.findMany(),
    prisma.cashRecon.findMany(),
    prisma.cashReconExcess.findMany(),
    prisma.bankRecon.findMany(),
    prisma.setting.findMany(),
    prisma.department.findMany(),
    prisma.pettyFunction.findMany(),
    prisma.product.findMany(),
    prisma.cancellation.findMany(),
    prisma.personCategory.findMany(),
    prisma.paymentChannel.findMany(),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5000 }),
    // Accountant-fund petty cash (legacy) — previously missing from the backup.
    prisma.pettyFund.findMany(),
    prisma.pettyFundTxn.findMany(),
    // Universal Expense & Disbursement Framework — previously entirely absent
    // from the backup, so any restore would silently lose all of this data.
    prisma.expenseModuleConfig.findMany(),
    prisma.requestType.findMany(),
    prisma.expenseCategory.findMany(),
    prisma.fundingSource.findMany(),
    prisma.fundingSourceTxn.findMany(),
    prisma.expenseRequest.findMany(),
    prisma.expenseItem.findMany(),
    prisma.expensePayment.findMany(),
    prisma.paymentAllocation.findMany(),
    prisma.verificationRecord.findMany(),
    prisma.attachment.findMany(),
  ])

  const data = {
    users, outlets, dailyCollections, persons, signedBills, paidBills, billItems,
    pettyCash, pettyCashItems, cashRecon, cashReconExcess, bankRecon, settings, departments, pettyFunctions,
    products, cancellations, personCategories, paymentChannels, auditLogs,
    pettyFunds, pettyFundTxns,
    expenseModuleConfigs, requestTypes, expenseCategories, fundingSources, fundingSourceTxns,
    expenseRequests, expenseItems, expensePayments, paymentAllocations, verificationRecords, attachments,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, (v as any[]).length]))

  return { version: 1, generatedAt: new Date().toISOString(), counts, data }
}
