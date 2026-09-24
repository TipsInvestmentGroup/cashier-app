// Receivable ledger math — the single source of truth shared by the Daily
// Receivable Summary report (app/api/receivable-summary/route.ts) and the
// Personal Ledger modal (app/api/receivable-summary/ledger/route.ts).
//
// The summary lists one row per (category, person); the ledger is drilled from
// a specific summary row, so it is scoped to the SAME category — that is what
// guarantees a row's Outstanding equals the ledger's Closing balance
// (Spec v2 §B.3 "maps cleanly onto the Personal Ledger"). A person who owes
// under two categories (e.g. STAFF_LOSS + CUSTOMER) is two rows, each drilling
// to its own category ledger. Omit the category to get a person-wide ledger.
//
// This deliberately differs from the existing per-bill /receivables report
// (lib/finance-receivables.ts): that floors each bill at 0 and is an as-of-now
// snapshot; this is a period-windowed net ledger (opening + CR − DR) that can
// show a credit balance (negative) when a person is net-overpaid. The two
// answer different questions, so their grand totals may differ for overpaid or
// unlinked-credit accounts — by design.
//
// Accounting convention (matches the Excel John maintains today):
//   CR (credit) = a signed bill  → debt the person INCURRED.
//   DR (debit)  = a paid bill    → money the person PAID toward that debt,
//                 plus any write-off (a receivable cleared without cash).
//   Running balance = Opening + Σ CR − Σ DR   (a debtor balance, ≥0 normally).
//
// "Business month" boundaries come from the Business Period Engine
// (lib/business-periods.ts getBusinessMonthRange) — NOT calendar months — so a
// 25th→24th outlet groups exactly like Close-the-Day and the Custodian Report.
//
// Person identity uses the FK when present and falls back to the normalized
// name otherwise (personId/signedBillId are nullable — see the person-link
// backfill). This keeps aggregation correct on legacy name-only rows instead
// of silently dropping or double-counting them; once the backfill enforces
// personId NOT NULL the name fallback simply stops being exercised.
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'
import { normalizeName } from '@/lib/nameMatch'
import { approvalGate } from '@/lib/bill-types'
import { PAID_BILL_CATEGORY_MAP } from '@/lib/bill-types'

/** Report section order + labels (Spec v2 §B.3). Maps 1:1 onto billType codes. */
export const RECEIVABLE_CATEGORIES: { code: string; label: string; hasCreditLimit: boolean }[] = [
  { code: 'ADMIN', label: 'Admins', hasCreditLimit: true },
  { code: 'DIRECTOR', label: 'Directors', hasCreditLimit: true },
  { code: 'CUSTOMER', label: 'Customers', hasCreditLimit: false },
  { code: 'STAFF_LOSS', label: 'Staff', hasCreditLimit: false },
  { code: 'DJ', label: 'DJ Bills', hasCreditLimit: false },
  { code: 'TIPS', label: 'Tips Bills', hasCreditLimit: false },
]
const CATEGORY_INDEX = new Map(RECEIVABLE_CATEGORIES.map((c, i) => [c.code, i]))

/** Stable grouping key: the FK when we have it, else the normalized name. */
export function personKeyOf(personId: string | null | undefined, name: string | null | undefined): string {
  return personId ? `id:${personId}` : `name:${normalizeName(name || '')}`
}

export interface SummaryPersonRow {
  key: string
  personId: string | null
  name: string
  creditLimit: number | null // only surfaced for Admin/Director (else null)
  opening: number
  totalSigned: number // period CR
  totalPaid: number // period DR
  outstanding: number // opening + CR − DR (balance at period end)
}
export interface SummaryCategory {
  code: string
  label: string
  hasCreditLimit: boolean
  rows: SummaryPersonRow[]
  subtotal: { totalSigned: number; totalPaid: number; outstanding: number }
}
export interface ReceivableSummary {
  categories: SummaryCategory[]
  grandTotal: { totalSigned: number; totalPaid: number; outstanding: number }
}

type Bucket = {
  personId: string | null
  name: string
  creditLimit: number | null
  opening: number
  totalSigned: number
  totalPaid: number
}

function outletScope(outletId?: string | null) {
  return outletId ? { outletId } : {}
}

/** Build the whole Daily Receivable Summary for a business-month window. */
export async function buildReceivableSummary(opts: {
  outletId?: string | null
  start: Date
  end: Date
}): Promise<ReceivableSummary> {
  const { outletId, start, end } = opts

  // Approved signed bills (CR) with their linked payments + write-offs (DR).
  // No status filter: a PAID or WRITTEN_OFF bill still contributes its CR and
  // the DR that cleared it — that's how the balance nets to zero correctly.
  const signed = await prisma.signedBill.findMany({
    where: { ...approvalGate(), ...outletScope(outletId) },
    select: {
      id: true, billType: true, personId: true, personName: true, amount: true, date: true,
      payments: { select: { amountPaid: true, date: true } },
      writeOffs: { select: { amount: true, createdAt: true } },
      person: { select: { creditLimit: true } },
    },
  })

  // Payments not linked to a signed bill (unallocated receipts) — attributed to
  // the person + category via payerCategory so they still reduce the balance.
  const unlinked = await prisma.paidBill.findMany({
    where: { signedBillId: null, ...outletScope(outletId) },
    select: { personId: true, payerName: true, payerCategory: true, amountPaid: true, date: true },
  })

  // (category, personKey) → running bucket.
  const buckets = new Map<string, Bucket>()
  const bucketFor = (category: string, personId: string | null, name: string, creditLimit: number | null) => {
    const k = `${category}||${personKeyOf(personId, name)}`
    let b = buckets.get(k)
    if (!b) {
      b = { personId: personId ?? null, name, creditLimit, opening: 0, totalSigned: 0, totalPaid: 0 }
      buckets.set(k, b)
    }
    // Prefer a non-null personId / a real credit limit if a later row supplies one.
    if (!b.personId && personId) b.personId = personId
    if ((b.creditLimit == null || b.creditLimit === 0) && creditLimit) b.creditLimit = creditLimit
    return b
  }
  const inPeriod = (d: Date) => d >= start && d <= end
  const before = (d: Date) => d < start

  for (const bill of signed) {
    const cat = (bill.billType || '').toUpperCase()
    if (!CATEGORY_INDEX.has(cat)) continue
    const limit = bill.person?.creditLimit ?? null
    const b = bucketFor(cat, bill.personId, bill.personName, limit)
    if (before(bill.date)) b.opening += bill.amount
    else if (inPeriod(bill.date)) b.totalSigned += bill.amount
    // CR (payments/write-offs) — same person + category bucket:
    for (const p of bill.payments) {
      if (before(p.date)) b.opening -= p.amountPaid
      else if (inPeriod(p.date)) b.totalPaid += p.amountPaid
    }
    for (const w of bill.writeOffs) {
      if (before(w.createdAt)) b.opening -= w.amount
      else if (inPeriod(w.createdAt)) b.totalPaid += w.amount
    }
  }

  for (const u of unlinked) {
    const cat = u.payerCategory
      ? (PAID_BILL_CATEGORY_MAP[u.payerCategory] || u.payerCategory.toUpperCase())
      : 'CUSTOMER'
    if (!CATEGORY_INDEX.has(cat)) continue
    const b = bucketFor(cat, u.personId, u.payerName, null)
    if (before(u.date)) b.opening -= u.amountPaid
    else if (inPeriod(u.date)) b.totalPaid += u.amountPaid
  }

  // Fold buckets into category sections.
  const byCat = new Map<string, SummaryPersonRow[]>()
  for (const [k, b] of buckets) {
    const category = k.split('||')[0]
    const meta = RECEIVABLE_CATEGORIES[CATEGORY_INDEX.get(category)!]
    const opening = roundMoney(b.opening)
    const totalSigned = roundMoney(b.totalSigned)
    const totalPaid = roundMoney(b.totalPaid)
    const outstanding = roundMoney(opening + totalSigned - totalPaid)
    // Drop all-zero phantom rows (e.g. a person fully settled before the period
    // with no activity in it) so the report stays scannable.
    if (opening === 0 && totalSigned === 0 && totalPaid === 0) continue
    const row: SummaryPersonRow = {
      key: k, personId: b.personId, name: b.name,
      creditLimit: meta.hasCreditLimit ? (b.creditLimit ?? 0) : null,
      opening, totalSigned, totalPaid, outstanding,
    }
    if (!byCat.has(category)) byCat.set(category, [])
    byCat.get(category)!.push(row)
  }

  const categories: SummaryCategory[] = RECEIVABLE_CATEGORIES.map((meta) => {
    const rows = (byCat.get(meta.code) || []).sort((a, b) => a.name.localeCompare(b.name))
    const subtotal = rows.reduce(
      (s, r) => ({
        totalSigned: s.totalSigned + r.totalSigned,
        totalPaid: s.totalPaid + r.totalPaid,
        outstanding: s.outstanding + r.outstanding,
      }),
      { totalSigned: 0, totalPaid: 0, outstanding: 0 },
    )
    return {
      code: meta.code, label: meta.label, hasCreditLimit: meta.hasCreditLimit, rows,
      subtotal: {
        totalSigned: roundMoney(subtotal.totalSigned),
        totalPaid: roundMoney(subtotal.totalPaid),
        outstanding: roundMoney(subtotal.outstanding),
      },
    }
  })

  const grandTotal = categories.reduce(
    (s, c) => ({
      totalSigned: s.totalSigned + c.subtotal.totalSigned,
      totalPaid: s.totalPaid + c.subtotal.totalPaid,
      outstanding: s.outstanding + c.subtotal.outstanding,
    }),
    { totalSigned: 0, totalPaid: 0, outstanding: 0 },
  )

  return {
    categories,
    grandTotal: {
      totalSigned: roundMoney(grandTotal.totalSigned),
      totalPaid: roundMoney(grandTotal.totalPaid),
      outstanding: roundMoney(grandTotal.outstanding),
    },
  }
}

export interface LedgerEntry {
  date: string // ISO
  reference: string
  cr: number // signed bill
  dr: number // paid bill / write-off
  balance: number // running balance after this entry
}
export interface PersonLedger {
  personId: string | null
  name: string
  opening: number
  entries: LedgerEntry[]
  closing: number
  hasPrior: boolean // any activity before `start` → opening balance is drillable
}

/** One person's ledger for a single business month (Spec v2 Task 2). Pass
 *  `category` (the billType of the summary row it was drilled from) so the
 *  ledger's Closing reconciles exactly with that row's Outstanding; omit it for
 *  a person-wide ledger across all categories. */
export async function buildPersonLedger(opts: {
  personId?: string | null
  personName?: string | null
  category?: string | null
  outletId?: string | null
  start: Date
  end: Date
}): Promise<PersonLedger> {
  const { personId, personName, category, outletId, start, end } = opts
  const catFilter = category ? { billType: category } : {}
  // Same normalization the summary groups by — so a name-only person whose
  // rows differ only in case/whitespace ("John Doe" vs "JOHN DOE") resolves to
  // the SAME set here as in the summary bucket (findings HIGH-2).
  const norm = personId ? null : normalizeName(personName || '')
  const mappedCat = (payerCategory: string | null) =>
    payerCategory ? (PAID_BILL_CATEGORY_MAP[payerCategory] || payerCategory.toUpperCase()) : 'CUSTOMER'

  const signedRows = await prisma.signedBill.findMany({
    where: { ...approvalGate(), ...outletScope(outletId), ...catFilter, ...(personId ? { personId } : { personId: null }) },
    select: {
      id: true, amount: true, date: true, personName: true, billType: true,
      displayReference: true, voucherNumber: true, legacyReference: true,
      payments: { select: { amountPaid: true, date: true, billRef: true, displayReference: true } },
      writeOffs: { select: { amount: true, createdAt: true } },
    },
  })
  const signed = norm == null ? signedRows : signedRows.filter((r) => normalizeName(r.personName) === norm)

  const unlinkedRows = await prisma.paidBill.findMany({
    where: { signedBillId: null, ...outletScope(outletId), ...(personId ? { personId } : { personId: null }) },
    select: { amountPaid: true, date: true, payerName: true, payerCategory: true, billRef: true, displayReference: true },
  })
  const unlinkedPaid = unlinkedRows.filter((r) => {
    if (norm != null && normalizeName(r.payerName) !== norm) return false
    // When category-scoped, only receipts that map to this category count —
    // mirrors the summary's unlinked-payment bucketing exactly.
    if (category && mappedCat(r.payerCategory) !== category) return false
    return true
  })

  const name =
    signed[0]?.personName || unlinkedPaid[0]?.payerName || personName || 'Unknown'

  type Raw = { date: Date; ref: string; cr: number; dr: number }
  const raw: Raw[] = []
  for (const b of signed) {
    raw.push({
      date: b.date,
      ref: b.displayReference || b.voucherNumber || b.legacyReference || 'Signed bill',
      cr: b.amount, dr: 0,
    })
    for (const p of b.payments) {
      raw.push({ date: p.date, ref: p.displayReference || p.billRef || 'Payment', cr: 0, dr: p.amountPaid })
    }
    for (const w of b.writeOffs) {
      raw.push({ date: w.createdAt, ref: 'Write-off', cr: 0, dr: w.amount })
    }
  }
  for (const u of unlinkedPaid) {
    raw.push({ date: u.date, ref: u.displayReference || u.billRef || 'Payment', cr: 0, dr: u.amountPaid })
  }

  raw.sort((a, b) => a.date.getTime() - b.date.getTime())

  const priorItems = raw.filter((r) => r.date < start)
  const opening = roundMoney(priorItems.reduce((s, r) => s + r.cr - r.dr, 0))
  const hasPrior = priorItems.length > 0

  let running = opening
  const entries: LedgerEntry[] = raw
    .filter((r) => r.date >= start && r.date <= end)
    .map((r) => {
      running = roundMoney(running + r.cr - r.dr)
      return { date: r.date.toISOString(), reference: r.ref, cr: roundMoney(r.cr), dr: roundMoney(r.dr), balance: running }
    })

  return { personId: personId ?? null, name, opening, entries, closing: running, hasPrior }
}
