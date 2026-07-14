// Pure, isomorphic helpers for Daily Collection per-channel amounts — safe to
// import from client components. DB-touching helpers live in collection-channels.ts.
import { roundMoney } from '@/lib/utils'

export type CollectionWithChannels = { crdb: number; stanbic: number; mpesa: number; channels?: { channelCode: string; amount: number }[] }

/** Per-channel amounts for a collection: prefer the dynamic table, fall back
 *  to the legacy fixed columns for rows recorded before this table existed. */
export function channelAmountsFor(c: CollectionWithChannels): Record<string, number> {
  if (c.channels && c.channels.length > 0) {
    const out: Record<string, number> = {}
    for (const ch of c.channels) out[ch.channelCode] = ch.amount
    return out
  }
  const legacy: Record<string, number> = {}
  if (c.crdb) legacy.CRDB = c.crdb
  if (c.stanbic) legacy.STANBIC = c.stanbic
  if (c.mpesa) legacy.MPESA = c.mpesa
  return legacy
}

/** Sum of all digital channel amounts for a collection (excludes cash). */
export function digitalTotal(c: CollectionWithChannels): number {
  return roundMoney(Object.values(channelAmountsFor(c)).reduce((s, v) => s + (v || 0), 0))
}

/** Sum of a raw { code: amount } map — same as digitalTotal but for form input, pre-save. */
export function sumChannelAmounts(channelAmounts: Record<string, number>): number {
  return roundMoney(Object.values(channelAmounts).reduce((s, v) => s + (Number(v) || 0), 0))
}

/** The 3 legacy fixed columns, derived from a { code: amount } map so old
 *  read paths (dashboard, reports, cash-recon, ...) keep working unmodified. */
export function legacyFixedFields(channelAmounts: Record<string, number>) {
  return {
    crdb: roundMoney(Number(channelAmounts.CRDB) || 0),
    stanbic: roundMoney(Number(channelAmounts.STANBIC) || 0),
    mpesa: roundMoney(Number(channelAmounts.MPESA) || 0),
  }
}
