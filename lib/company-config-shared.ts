// Company preferences shared between server code (lib/company-config.ts) and
// client components. Kept dependency-free (no prisma import) so client
// components can import this file directly — same split as
// collection-channels-shared.ts.
//
// The defaults ARE today's live values for this deployment, so a database
// with no companyConfig Setting row behaves exactly as the app always has.

export interface CompanyConfig {
  companyName: string // shown on letterheads and anywhere the business is named
  appName: string // the title in the sidebar header
  logoUrl: string // sidebar + MyPos header logo (a /public path or full URL)
  logoText: string // short word drawn on PDF letterhead bands (no images in jsPDF header)
  letterheadTitle: string // right-hand banner text on warning/reward letter PDFs
  currencyCode: string // ISO code for Intl.NumberFormat, e.g. "TZS"
  currencyLocale: string // Intl locale, e.g. "en-TZ"
  currencyLabel: string // short prefix used in emails/PDFs/targets, e.g. "TSh"
  receiptAmountSuffix: string // amount suffix on printed 80mm bills, e.g. "/="
  receiptDisclaimerText: string // small-print line on printed 80mm bills (may be empty)
  receiptFooterText: string // bold sign-off line on printed 80mm bills (may be empty)
  vatRate: number // 0.18 = 18%
}

export const DEFAULT_COMPANY_CONFIG: CompanyConfig = {
  companyName: 'TIPS Lounge',
  appName: 'Cashier Manager',
  logoUrl: '/tips-logo.png',
  logoText: 'tips',
  letterheadTitle: 'TIPS Lounge — Performance Management',
  currencyCode: 'TZS',
  currencyLocale: 'en-TZ',
  currencyLabel: 'TSh',
  receiptAmountSuffix: '/=',
  receiptDisclaimerText: 'Hii sio risiti halali ya malipo, huu ni mchanganuo',
  receiptFooterText: 'Karibu tena!',
  vatRate: 0.18,
}

/** Merge a stored/partial object over the defaults, dropping bad values. */
export function normalizeCompanyConfig(raw: unknown): CompanyConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (k: keyof CompanyConfig) => (typeof r[k] === 'string' && (r[k] as string).trim() ? (r[k] as string).trim() : DEFAULT_COMPANY_CONFIG[k] as string)
  const vat = Number(r.vatRate)
  return {
    companyName: str('companyName'),
    appName: str('appName'),
    logoUrl: str('logoUrl'),
    logoText: str('logoText'),
    letterheadTitle: str('letterheadTitle'),
    currencyCode: str('currencyCode'),
    currencyLocale: str('currencyLocale'),
    currencyLabel: str('currencyLabel'),
    // Deliberately NOT trimmed-or-defaulted: an empty value is a valid choice
    // (e.g. a company that wants no disclaimer/footer line at all).
    receiptAmountSuffix: typeof r.receiptAmountSuffix === 'string' ? r.receiptAmountSuffix : DEFAULT_COMPANY_CONFIG.receiptAmountSuffix,
    receiptDisclaimerText: typeof r.receiptDisclaimerText === 'string' ? r.receiptDisclaimerText : DEFAULT_COMPANY_CONFIG.receiptDisclaimerText,
    receiptFooterText: typeof r.receiptFooterText === 'string' ? r.receiptFooterText : DEFAULT_COMPANY_CONFIG.receiptFooterText,
    vatRate: Number.isFinite(vat) && vat >= 0 && vat < 1 ? vat : DEFAULT_COMPANY_CONFIG.vatRate,
  }
}

/** "TSh 1,234" — the label-prefixed style used in emails, PDFs and targets. */
export function formatAmountLabel(cfg: Pick<CompanyConfig, 'currencyLabel'>, n: number): string {
  return `${cfg.currencyLabel} ${Math.round(n || 0).toLocaleString('en-US')}`
}
