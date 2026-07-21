import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'
import { generateBillReference, resolveBillTypeCodeFromLegacy } from '@/lib/bill-reference'
import { postCreditSale } from '@/lib/finance-ar'
import { resolveCreditTags } from '@/lib/credit-config'

interface ItemInput { productId?: string; productName?: string; unitPrice?: number; quantity?: number }
interface BillRequestArgs {
  billType: string
  personName: string
  // Optional — used only to resolve the CreditAccount tag; the bill itself stays
  // name-only (personId is not written) to preserve today's request behavior.
  personId?: string | null
  serviceStaff?: string | null
  amount?: number
  items?: ItemInput[]
  outletId: string
  cashierId: string
  date?: string | Date | null
}

/**
 * Create a signed-bill REQUEST (Customer / Tips / DJ) filed as PENDING approval.
 * Amount = sum of product line items when provided, else the manual amount.
 * Finance Platform (Stage 2): also calls postCreditSale() — a no-op here
 * since CUSTOMER/TIPS/DJ are still PENDING approval; it actually posts once
 * the approve action flips approvalStatus to APPROVED (see
 * app/api/customer-bills/[id]/route.ts, app/api/tips-dj/[id]/route.ts). Kept
 * here anyway so every SignedBill creation/status-change site uniformly
 * calls it, rather than relying on remembering which ones need it.
 */
export async function createBillRequest(a: BillRequestArgs) {
  const itemsInput = (a.items || []).filter((it) => it.productName && Number(it.quantity) > 0)
  const itemsTotal = roundMoney(itemsInput.reduce((s, it) => s + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0), 0))
  const finalAmount = roundMoney(itemsInput.length ? itemsTotal : Number(a.amount))
  const billDate = a.date ? new Date(a.date) : new Date()

  const bill = await prisma.$transaction(async (tx) => {
    const recordId = crypto.randomUUID()
    const billTypeCode = await resolveBillTypeCodeFromLegacy(tx, 'SIGNED_BILL', a.billType)
    const ref = await generateBillReference(tx, {
      recordId, sourceModel: 'SignedBill', billTypeCode, date: billDate, outletId: a.outletId,
    })
    const tags = await resolveCreditTags(tx, { billType: a.billType, personId: a.personId || null, outletId: a.outletId })

    const bill = await tx.signedBill.create({
      data: {
        id: recordId,
        billType: a.billType,
        personName: a.personName,
        amount: finalAmount,
        serviceStaff: a.serviceStaff || null,
        voucherNumber: ref.displayReference,
        internalBillId: ref.internalBillId,
        displayReference: ref.displayReference,
        billTypeConfigId: ref.billTypeConfigId,
        creditGroupId: tags.creditGroupId,
        creditAccountId: tags.creditAccountId,
        status: 'UNPAID',
        approvalStatus: 'PENDING',
        outletId: a.outletId,
        cashierId: a.cashierId,
        date: billDate,
      },
    })

    for (const it of itemsInput) {
      const qty = Number(it.quantity) || 0
      const price = roundMoney(it.unitPrice)
      await tx.billItem.create({
        data: { signedBillId: bill.id, productId: it.productId || null, productName: it.productName as string, unitPrice: price, quantity: qty, amount: roundMoney(price * qty) },
      })
    }

    return bill
  })

  await postCreditSale(prisma, bill, a.cashierId)
  return bill
}
