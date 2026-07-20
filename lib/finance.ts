// Accounts Payable — Supplier Invoice and Supplier Payment logic. Both
// functions post through lib/ledger.ts's postJournalEntry(), the single
// General Ledger choke point; neither touches Grn/StockLevel math, which
// stays owned by lib/stock.ts.
import { prisma } from './prisma'
import { roundMoney } from './utils'
import { postJournalEntry, type Db } from './ledger'
import { resolveAccountId, resolveChannelAccountId } from './finance-mapping'

async function nextSequenceNumber(db: Db, prefix: string, count: () => Promise<number>): Promise<string> {
  const n = (await count()) + 1
  return `${prefix}-${String(n).padStart(6, '0')}`
}

export interface CreateSupplierInvoiceInput {
  grnId: string
  companyId: string
  supplierId: string
  supplierInvoiceRef?: string | null
  invoiceDate: Date
  dueDate?: Date | null
  subtotal: number
  vatAmount?: number
  total: number
  createdById: string
}

/**
 * Formalizes a GRN's provisional accrual into a real supplier invoice.
 * Clears the GRN's Accounts Payable Accrual (from receiveGrn's Dr Inventory
 * / Cr AP Accrual posting) into Accounts Payable Control, posting any cost
 * variance between the accrual and the actual invoiced total to the
 * Rounding/Variance account. If the GRN never got an accrual posted (no
 * cost was known at receipt — Grn.needsCosting), this instead costs the
 * inventory for the first time: Dr Inventory Asset / Cr AP Control for the
 * full invoice total, and clears needsCosting.
 */
export async function createSupplierInvoice(input: CreateSupplierInvoiceInput): Promise<{ id: string; invoiceNumber: string }> {
  return prisma.$transaction(async (tx) => {
    const grn = await tx.grn.findUnique({ where: { id: input.grnId }, include: { items: true } })
    if (!grn) throw new Error('GRN not found')

    // grnId has no DB-level unique constraint (a large GRN could legitimately
    // be invoiced in parts in a future phase), so the one-invoice-per-GRN
    // rule Phase 1 actually implements is enforced here — without this, a
    // double-submit would double-post the accrual clearing and, on the
    // needsCosting path, double-cost the inventory.
    const existingInvoice = await tx.supplierInvoice.findFirst({ where: { grnId: input.grnId, status: { not: 'CANCELLED' } } })
    if (existingInvoice) throw new Error(`GRN ${grn.grnNumber} already has an invoice (${existingInvoice.invoiceNumber})`)

    const total = roundMoney(input.total)
    const apControlAccountId = await resolveAccountId(tx, { companyId: input.companyId, key: 'AP_CONTROL' })

    let lines: { accountId: string; debit?: number; credit?: number; description: string }[]

    if (grn.journalEntryId) {
      const accrualEntry = await tx.journalEntry.findUnique({ where: { id: grn.journalEntryId }, include: { lines: true } })
      const accrualLine = accrualEntry?.lines.find((l) => l.credit > 0)
      const accrualAmount = roundMoney(accrualLine?.credit || 0)
      const apAccrualAccountId = await resolveAccountId(tx, { companyId: input.companyId, key: 'AP_ACCRUAL' })
      const variance = roundMoney(total - accrualAmount)
      const varianceAccountId = variance !== 0 ? await resolveAccountId(tx, { companyId: input.companyId, key: 'ROUNDING' }) : null

      lines = [
        { accountId: apAccrualAccountId, debit: accrualAmount, description: `Clear accrual for GRN ${grn.grnNumber}` },
        { accountId: apControlAccountId, credit: total, description: `Supplier invoice for GRN ${grn.grnNumber}` },
      ]
      if (variance > 0) lines.push({ accountId: varianceAccountId!, debit: variance, description: 'Invoice/GRN cost variance' })
      if (variance < 0) lines.push({ accountId: varianceAccountId!, credit: -variance, description: 'Invoice/GRN cost variance' })
    } else {
      const inventoryAccountId = await resolveAccountId(tx, { companyId: input.companyId, key: 'INVENTORY_ASSET' })
      lines = [
        { accountId: inventoryAccountId, debit: total, description: `Cost GRN ${grn.grnNumber} on invoice` },
        { accountId: apControlAccountId, credit: total, description: `Supplier invoice for GRN ${grn.grnNumber}` },
      ]
    }

    const { id: journalEntryId } = await postJournalEntry(tx, {
      companyId: input.companyId, entryDate: input.invoiceDate, sourceModule: 'PROCUREMENT',
      sourceType: 'SupplierInvoice', sourceId: null, description: `Supplier invoice for GRN ${grn.grnNumber}`,
      createdById: input.createdById, lines,
    })

    const invoiceNumber = await nextSequenceNumber(tx, 'INV', () => tx.supplierInvoice.count())
    const invoice = await tx.supplierInvoice.create({
      data: {
        invoiceNumber, supplierId: input.supplierId, companyId: input.companyId, grnId: input.grnId,
        supplierInvoiceRef: input.supplierInvoiceRef || null, invoiceDate: input.invoiceDate, dueDate: input.dueDate || null,
        subtotal: roundMoney(input.subtotal), vatAmount: roundMoney(input.vatAmount || 0), total,
        createdById: input.createdById, journalEntryId,
      },
    })
    await tx.journalEntry.update({ where: { id: journalEntryId }, data: { sourceId: invoice.id } })

    if (grn.needsCosting) await tx.grn.update({ where: { id: grn.id }, data: { needsCosting: false } })

    return { id: invoice.id, invoiceNumber: invoice.invoiceNumber }
  })
}

export interface CreateSupplierPaymentInput {
  companyId: string
  supplierId: string
  paymentChannelId: string
  amount: number
  paymentDate: Date
  reference?: string | null
  note?: string | null
  createdById: string
  allocations: { supplierInvoiceId: string; amount: number }[]
}

/**
 * Pays one or more open Supplier Invoices (partial or full), posting
 * Dr Accounts Payable Control / Cr the payment channel's mapped Cash/Bank
 * account. Allocation amounts must add up to the payment amount.
 */
export async function createSupplierPayment(input: CreateSupplierPaymentInput): Promise<{ id: string; paymentNumber: string }> {
  const amount = roundMoney(input.amount)
  if (!input.allocations.length) throw new Error('At least one invoice allocation is required')
  const allocSum = roundMoney(input.allocations.reduce((s, a) => s + roundMoney(a.amount), 0))
  if (allocSum !== amount) throw new Error(`Allocations (${allocSum}) must add up to the payment amount (${amount})`)

  return prisma.$transaction(async (tx) => {
    const channel = await tx.paymentChannel.findUnique({ where: { id: input.paymentChannelId } })
    if (!channel) throw new Error('Payment channel not found')
    // Cascades through a default Company Payment Account (Stage 3), then the
    // channel's own simple glAccountId (Stage 1), then the company's default
    // Cash/Mobile-Money account — see lib/finance-mapping.ts
    // resolveChannelAccountId(). Same fallback chain Daily Collections uses,
    // so a payment is never blocked for lack of setup.
    const paymentAccountId = await resolveChannelAccountId(tx, { companyId: input.companyId, channelCode: channel.code })

    const invoices = await tx.supplierInvoice.findMany({ where: { id: { in: input.allocations.map((a) => a.supplierInvoiceId) } } })
    for (const alloc of input.allocations) {
      const invoice = invoices.find((i) => i.id === alloc.supplierInvoiceId)
      if (!invoice) throw new Error('Supplier invoice not found')
      if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') throw new Error(`Invoice ${invoice.invoiceNumber} is already ${invoice.status.toLowerCase()}`)
      const outstanding = roundMoney(invoice.total - invoice.amountPaid)
      if (roundMoney(alloc.amount) > outstanding + 0.001) {
        throw new Error(`Allocation of ${alloc.amount} exceeds the outstanding balance (${outstanding}) on invoice ${invoice.invoiceNumber}`)
      }
    }

    const apControlAccountId = await resolveAccountId(tx, { companyId: input.companyId, key: 'AP_CONTROL' })
    const { id: journalEntryId } = await postJournalEntry(tx, {
      companyId: input.companyId, entryDate: input.paymentDate, sourceModule: 'PROCUREMENT',
      sourceType: 'SupplierPayment', sourceId: null, description: `Supplier payment via ${channel.label}`,
      createdById: input.createdById,
      lines: [
        { accountId: apControlAccountId, debit: amount, description: 'Supplier payment' },
        { accountId: paymentAccountId, credit: amount, description: `Paid via ${channel.label}` },
      ],
    })

    const paymentNumber = await nextSequenceNumber(tx, 'PAY', () => tx.supplierPayment.count())
    const payment = await tx.supplierPayment.create({
      data: {
        paymentNumber, supplierId: input.supplierId, companyId: input.companyId, paymentChannelId: input.paymentChannelId,
        amount, paymentDate: input.paymentDate, reference: input.reference || null, note: input.note || null,
        createdById: input.createdById, journalEntryId,
      },
    })
    await tx.journalEntry.update({ where: { id: journalEntryId }, data: { sourceId: payment.id } })

    for (const alloc of input.allocations) {
      const invoice = invoices.find((i) => i.id === alloc.supplierInvoiceId)!
      const allocAmount = roundMoney(alloc.amount)
      await tx.supplierPaymentAllocation.create({ data: { paymentId: payment.id, supplierInvoiceId: invoice.id, amount: allocAmount } })
      const newAmountPaid = roundMoney(invoice.amountPaid + allocAmount)
      await tx.supplierInvoice.update({
        where: { id: invoice.id },
        data: { amountPaid: newAmountPaid, status: newAmountPaid >= invoice.total - 0.001 ? 'PAID' : 'PARTIALLY_PAID' },
      })
    }

    return { id: payment.id, paymentNumber: payment.paymentNumber }
  })
}
