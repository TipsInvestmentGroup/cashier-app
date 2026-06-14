import { prisma } from '@/lib/prisma'
import { generateVoucherNumber, roundMoney } from '@/lib/utils'

interface ItemInput { productId?: string; productName?: string; unitPrice?: number; quantity?: number }
interface BillRequestArgs {
  billType: string
  personName: string
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
 */
export async function createBillRequest(a: BillRequestArgs) {
  const itemsInput = (a.items || []).filter((it) => it.productName && Number(it.quantity) > 0)
  const itemsTotal = roundMoney(itemsInput.reduce((s, it) => s + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0), 0))
  const finalAmount = roundMoney(itemsInput.length ? itemsTotal : Number(a.amount))

  const bill = await prisma.signedBill.create({
    data: {
      billType: a.billType,
      personName: a.personName,
      amount: finalAmount,
      serviceStaff: a.serviceStaff || null,
      voucherNumber: generateVoucherNumber(),
      status: 'UNPAID',
      approvalStatus: 'PENDING',
      outletId: a.outletId,
      cashierId: a.cashierId,
      date: a.date ? new Date(a.date) : new Date(),
    },
  })

  for (const it of itemsInput) {
    const qty = Number(it.quantity) || 0
    const price = roundMoney(it.unitPrice)
    await prisma.billItem.create({
      data: { signedBillId: bill.id, productId: it.productId || null, productName: it.productName as string, unitPrice: price, quantity: qty, amount: roundMoney(price * qty) },
    })
  }

  return bill
}
