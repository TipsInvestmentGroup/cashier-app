import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'

export * from '@/lib/collection-channels-shared'

// Default digital channels used only when the PaymentChannel table is empty
// (mirrors the fixed crdb/stanbic/mpesa columns that predate that table).
const DEFAULT_DIGITAL_CHANNELS = [
  { code: 'CRDB', label: 'CRDB' },
  { code: 'STANBIC', label: 'Stanbic' },
  { code: 'MPESA', label: 'M-PESA' },
]

/** Active digital channels (everything except CASH). */
export async function getActiveDigitalChannels() {
  const all = await prisma.paymentChannel.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } })
  const list = all.filter((c) => c.code !== 'CASH')
  if (list.length === 0) return DEFAULT_DIGITAL_CHANNELS
  return list.map((c) => ({ code: c.code, label: c.label }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

/** Replace a collection's per-channel rows to match the given { code: amount } map. */
export async function syncCollectionChannels(tx: Tx, collectionId: string, channelAmounts: Record<string, number>) {
  await tx.dailyCollectionChannel.deleteMany({ where: { collectionId } })
  const entries = Object.entries(channelAmounts).filter(([, v]) => Number(v) > 0)
  for (const [channelCode, amount] of entries) {
    await tx.dailyCollectionChannel.create({ data: { collectionId, channelCode, amount: roundMoney(Number(amount)) } })
  }
}
