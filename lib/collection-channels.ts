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

/** "The" payment channel a collection's money came in through — the largest
 *  single amount among cash + digital channels — for auto-inheriting onto a
 *  payable excess record so nobody re-enters it (Excess Collection §4). */
export function primaryChannelFromAmounts(cash: number, channelAmounts: Record<string, number>): string {
  const entries: [string, number][] = [['CASH', Number(cash) || 0], ...Object.entries(channelAmounts).map(([k, v]) => [k, Number(v) || 0] as [string, number])]
  return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best), entries[0])[0]
}

/** Same as primaryChannelFromAmounts, resolved from an already-saved DailyCollection. */
export async function primaryChannelForCollection(tx: Tx, collectionId: string): Promise<string | null> {
  const collection = await tx.dailyCollection.findUnique({ where: { id: collectionId }, select: { cash: true } })
  if (!collection) return null
  const channels = await tx.dailyCollectionChannel.findMany({ where: { collectionId }, select: { channelCode: true, amount: true } })
  const channelAmounts: Record<string, number> = {}
  for (const c of channels) channelAmounts[c.channelCode] = c.amount
  return primaryChannelFromAmounts(collection.cash, channelAmounts)
}
