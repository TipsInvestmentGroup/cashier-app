// VAT (Value Added Tax) accounting — Tanzania standard rate 18%.
//
// Gated by CompanyConfig.vatEnabled, which ships OFF: until the business
// confirms VAT registration and turns it on, every helper here is a no-op that
// books the full amount to revenue/inventory exactly as before, so nothing is
// mis-stated. When enabled:
//   • Output VAT on sales   — Cr VAT Output (2100), a liability owed to TRA.
//   • Input VAT on purchases — Dr VAT Input (1200), an asset reclaimable.
//   • VAT return             — output − input over a period (net payable/refund).
// Pricing mode (vatInclusive) decides how output VAT is derived from a sale:
//   inclusive → the price already contains VAT (TZ hospitality norm): VAT =
//     gross × rate/(1+rate); net = gross − VAT. exclusive → VAT is added on top.
//
// EFD / TRA fiscal-receipt (Z-report) integration is a separate, later piece and
// is not part of this module.
import { getCompanyConfig } from './company-config'
import { roundMoney } from './utils'
import { resolveAccountId } from './finance-mapping'
import type { Db } from './ledger'

export interface VatConfig {
  enabled: boolean
  rate: number
  inclusive: boolean
}

export async function resolveVatConfig(): Promise<VatConfig> {
  const c = await getCompanyConfig()
  return { enabled: !!c.vatEnabled, rate: c.vatRate, inclusive: !!c.vatInclusive }
}

/** Split a VAT-inclusive gross into its net and VAT parts. */
export function splitInclusive(gross: number, rate: number): { net: number; vat: number } {
  const g = roundMoney(gross)
  if (rate <= 0) return { net: g, vat: 0 }
  const vat = roundMoney((g * rate) / (1 + rate))
  return { net: roundMoney(g - vat), vat }
}

/**
 * Given a sale/revenue figure and the VAT config, return the net revenue to
 * recognize and the output VAT to accrue. A no-op (vat 0) when VAT is disabled,
 * so callers can call it unconditionally.
 *   inclusive: the figure already contains VAT → split it out.
 *   exclusive: the figure is net → VAT is charged on top (added to what's owed).
 */
export function splitOutputVat(revenue: number, cfg: VatConfig): { net: number; vat: number } {
  const amt = roundMoney(revenue)
  if (!cfg.enabled || cfg.rate <= 0 || amt <= 0) return { net: amt, vat: 0 }
  if (cfg.inclusive) return splitInclusive(amt, cfg.rate)
  return { net: amt, vat: roundMoney(amt * cfg.rate) }
}

/**
 * Split a supplier-invoice total into the recoverable input VAT and the net
 * cost that should capitalize into inventory / expense. Prefers an explicit
 * vatAmount captured on the invoice; otherwise derives it from the total under
 * the configured pricing mode. No-op when VAT is disabled.
 */
export function splitInputVat(total: number, cfg: VatConfig, explicitVat?: number | null): { net: number; vat: number } {
  const amt = roundMoney(total)
  if (!cfg.enabled || cfg.rate <= 0 || amt <= 0) return { net: amt, vat: 0 }
  if (explicitVat != null && explicitVat > 0) {
    const vat = roundMoney(Math.min(explicitVat, amt))
    return { net: roundMoney(amt - vat), vat }
  }
  if (cfg.inclusive) return splitInclusive(amt, cfg.rate)
  // exclusive: total is net-of-VAT goods; VAT sits on top and is part of `total`
  // only if the caller included it — with no explicit figure, treat total as net.
  return { net: amt, vat: 0 }
}

/**
 * VAT return for a period, straight from the GL control accounts:
 *   output VAT = net credit movement on VAT Output (2100)  — VAT collected on sales
 *   input VAT  = net debit  movement on VAT Input (1200)   — VAT paid on purchases
 *   net payable = output − input  (positive → remit to TRA; negative → refund/credit)
 * Non-reversed and reversal lines both count (they cancel), matching the
 * canonical trial-balance convention.
 */
export async function vatReturn(db: Db, companyId: string, from: Date, to: Date): Promise<{
  from: string; to: string; outputVat: number; inputVat: number; netPayable: number
}> {
  const [outputId, inputId] = await Promise.all([
    resolveAccountId(db, { companyId, key: 'VAT_OUTPUT' }),
    resolveAccountId(db, { companyId, key: 'VAT_INPUT' }),
  ])
  const [out, inp] = await Promise.all([
    db.journalLine.aggregate({ where: { accountId: outputId, journalEntry: { companyId, entryDate: { gte: from, lte: to } } }, _sum: { debit: true, credit: true } }),
    db.journalLine.aggregate({ where: { accountId: inputId, journalEntry: { companyId, entryDate: { gte: from, lte: to } } }, _sum: { debit: true, credit: true } }),
  ])
  const outputVat = roundMoney((out._sum.credit || 0) - (out._sum.debit || 0)) // liability: credit-normal
  const inputVat = roundMoney((inp._sum.debit || 0) - (inp._sum.credit || 0)) // asset: debit-normal
  return { from: from.toISOString(), to: to.toISOString(), outputVat, inputVat, netPayable: roundMoney(outputVat - inputVat) }
}
