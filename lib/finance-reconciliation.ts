// Bank/Cash Account Reconciliation — Stage 5. Compares a Company Payment
// Account's GL activity for a period against a bank/mobile-money statement
// the user types in, auto-classifying every line as Matched / Unmatched /
// Missing / Duplicate, then requiring a separate approval step before it's
// final — same "entry role vs. verifier role" separation of duties this app
// already uses for cash-drawer verification (lib/cash-verify.ts).
import crypto from 'crypto'
import { prisma } from './prisma'
import { roundMoney } from './utils'

const DATE_TOLERANCE_DAYS = 5
const dayKey = (d: Date) => new Date(d).toISOString().slice(0, 10)
const daysBetween = (a: Date, b: Date) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000

export interface StatementLineInput {
  transactionDate: Date
  description?: string | null
  amount: number // signed as the statement shows it: positive = money in, negative = money out
}

/**
 * Starts a new reconciliation: snapshots this account's GL activity for the
 * period as SYSTEM items (signed the same way — debit-normal, since a
 * CompanyPaymentAccount's glAccountId is always an ASSET account), records
 * the user's STATEMENT lines, snapshots the GL balance as of periodEnd
 * (frozen so a later back-dated entry can't silently change an already-
 * approved reconciliation), and runs the matcher once immediately.
 */
export async function createReconciliation(opts: {
  companyPaymentAccountId: string
  periodStart: Date
  periodEnd: Date
  statementBalance: number
  statementLines: StatementLineInput[]
  createdById: string
}): Promise<{ id: string }> {
  const account = await prisma.companyPaymentAccount.findUnique({ where: { id: opts.companyPaymentAccountId } })
  if (!account) throw new Error('Company payment account not found')
  if (!account.isActive) throw new Error(`"${account.accountName}" is disabled — reactivate it before reconciling`)

  const priorLines = await prisma.journalLine.findMany({
    where: { accountId: account.glAccountId, journalEntry: { entryDate: { lte: opts.periodEnd } } },
    select: { debit: true, credit: true },
  })
  const glBalance = roundMoney(priorLines.reduce((s, l) => s + l.debit - l.credit, 0))

  const periodLines = await prisma.journalLine.findMany({
    where: { accountId: account.glAccountId, journalEntry: { entryDate: { gte: opts.periodStart, lte: opts.periodEnd } } },
    include: { journalEntry: { select: { entryDate: true, description: true } } },
  })

  const reconciliation = await prisma.$transaction(async (tx) => {
    const created = await tx.accountReconciliation.create({
      data: {
        companyPaymentAccountId: opts.companyPaymentAccountId, periodStart: opts.periodStart, periodEnd: opts.periodEnd,
        statementBalance: roundMoney(opts.statementBalance), glBalance, createdById: opts.createdById,
      },
    })
    for (const l of periodLines) {
      await tx.reconciliationItem.create({
        data: {
          reconciliationId: created.id, source: 'SYSTEM', transactionDate: l.journalEntry.entryDate,
          description: l.journalEntry.description, amount: roundMoney(l.debit - l.credit), sourceJournalLineId: l.id,
        },
      })
    }
    for (const s of opts.statementLines) {
      await tx.reconciliationItem.create({
        data: { reconciliationId: created.id, source: 'STATEMENT', transactionDate: s.transactionDate, description: s.description || null, amount: roundMoney(s.amount) },
      })
    }
    return created
  })

  await runMatching(reconciliation.id)
  return { id: reconciliation.id }
}

/**
 * Classifies every item as MATCHED / UNMATCHED / MISSING / DUPLICATE.
 * Duplicates are caught first and separately, WITHIN one source only (the
 * same amount+day+description appearing twice on the statement, or twice
 * in our own GL activity) — a same-source repeat is a distinct data
 * problem from a cross-source timing difference, so it's excluded from
 * matching rather than folded into MISSING/UNMATCHED. What's left is
 * matched cross-source by exact amount within a ±5-day window (statements
 * post a few days after the actual transaction date) — the closest date
 * wins when more than one candidate qualifies.
 */
export async function runMatching(reconciliationId: string): Promise<void> {
  const items = await prisma.reconciliationItem.findMany({ where: { reconciliationId } })

  const dedupe = (source: 'SYSTEM' | 'STATEMENT') => {
    const bucket = new Map<string, typeof items>()
    for (const i of items.filter((x) => x.source === source)) {
      const key = `${i.amount}|${dayKey(i.transactionDate)}|${i.description || ''}`
      bucket.set(key, [...(bucket.get(key) || []), i])
    }
    const duplicates = new Set<string>()
    const clean: typeof items = []
    for (const group of bucket.values()) {
      clean.push(group[0])
      group.slice(1).forEach((g) => duplicates.add(g.id))
    }
    return { clean, duplicates }
  }

  const sys = dedupe('SYSTEM')
  const stmt = dedupe('STATEMENT')
  const usedSystemIds = new Set<string>()
  const updates: { id: string; matchStatus: string; matchGroupId: string | null }[] = []

  for (const id of sys.duplicates) updates.push({ id, matchStatus: 'DUPLICATE', matchGroupId: null })
  for (const id of stmt.duplicates) updates.push({ id, matchStatus: 'DUPLICATE', matchGroupId: null })

  for (const s of stmt.clean) {
    const candidates = sys.clean
      .filter((sy) => !usedSystemIds.has(sy.id) && sy.amount === s.amount && daysBetween(sy.transactionDate, s.transactionDate) <= DATE_TOLERANCE_DAYS)
      .sort((a, b) => daysBetween(a.transactionDate, s.transactionDate) - daysBetween(b.transactionDate, s.transactionDate))
    const match = candidates[0]
    if (match) {
      usedSystemIds.add(match.id)
      const groupId = crypto.randomUUID()
      updates.push({ id: s.id, matchStatus: 'MATCHED', matchGroupId: groupId })
      updates.push({ id: match.id, matchStatus: 'MATCHED', matchGroupId: groupId })
    } else {
      updates.push({ id: s.id, matchStatus: 'MISSING', matchGroupId: null })
    }
  }
  for (const sy of sys.clean) {
    if (!usedSystemIds.has(sy.id)) updates.push({ id: sy.id, matchStatus: 'UNMATCHED', matchGroupId: null })
  }

  await prisma.$transaction(updates.map((u) => prisma.reconciliationItem.update({ where: { id: u.id }, data: { matchStatus: u.matchStatus, matchGroupId: u.matchGroupId } })))
}

export async function submitReconciliation(id: string, userId: string): Promise<void> {
  const rec = await prisma.accountReconciliation.findUniqueOrThrow({ where: { id } })
  if (rec.status !== 'DRAFT') throw new Error(`Only a draft reconciliation can be submitted (this one is ${rec.status})`)
  await prisma.accountReconciliation.update({ where: { id }, data: { status: 'PENDING_APPROVAL', submittedById: userId, submittedAt: new Date() } })
}

/** Finalizes a reconciliation. The approver must be different from whoever
 *  submitted it — separation of duties, same principle as
 *  lib/stock.ts's "you cannot approve your own purchase order". */
export async function approveReconciliation(id: string, userId: string): Promise<void> {
  const rec = await prisma.accountReconciliation.findUniqueOrThrow({ where: { id } })
  if (rec.status !== 'PENDING_APPROVAL') throw new Error(`Only a reconciliation pending approval can be approved (this one is ${rec.status})`)
  if (rec.submittedById === userId) throw new Error('You cannot approve a reconciliation you submitted yourself')
  await prisma.accountReconciliation.update({ where: { id }, data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() } })
}
