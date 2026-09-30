import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireActiveUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { sumChannelAmounts, legacyFixedFields, syncCollectionChannels, channelAmountsFor } from '@/lib/collection-channels'
import { isValidExcessReasonCode, excessReasonCategoryDb } from '@/lib/excess-reasons-db'
import { primaryChannelFromAmounts } from '@/lib/collection-channels'
import { generateBillReference } from '@/lib/bill-reference'
import { reverseJournalEntry, type Db } from '@/lib/ledger'
import { syncCreditForAccount, syncCreditForPerson } from '@/lib/credit-ledger'
import { classForReason } from '@/lib/reconciliation-classification'
import { isDayLocked } from '@/lib/day-lock'
import { liveCollectionEntryWhere } from '@/lib/collection-gl'
import { hasItemisedLines, rebuildCollection, writeChannelTotalLines } from '@/lib/collection-ledger'
import { startOfDay, endOfDay, format } from 'date-fns'

const ALLOWED = ['CASHIER', 'ADMIN', 'ACCOUNTANT']
// Roles allowed to edit/delete collections of ANY outlet; others are limited to their own.
const CROSS_OUTLET = ['ADMIN', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR']

// DayClosure types are generated on deploy; assert to avoid local type drift.
const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Update a collection. Everything runs in one transaction and ends with
 * rebuildCollection(), the single writer of the derived figures — staff loss /
 * excess, BusinessSession and the GL cash-in entry (reversed and re-posted when
 * the amounts change; before this, an edit left the GL at the old amounts).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.dailyCollection.findUnique({ where: { id }, include: { channels: true } })
  if (!existing) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
  if (!CROSS_OUTLET.includes(user.role) && user.outletId && existing.outletId !== user.outletId) {
    return NextResponse.json({ error: 'You can only edit collections from your own outlet' }, { status: 403 })
  }
  // Closed days are locked for EVERY role (was: cashiers only).
  if (await isDayLocked(prisma, existing.outletId, existing.date)) {
    return NextResponse.json({ error: 'This day is closed. It must be reopened (Unlock Requests) before this collection can be edited.' }, { status: 423 })
  }

  const body = await req.json()
  const { cash = 0, notes, outletId, date, staffName, systemSales = 0, discountReason } = body
  // channelAmounts: { CRDB: 12000, CRDB_LIPA_HAPA: 5000, ... } — any active PaymentChannel code.
  // Falls back to legacy crdb/stanbic/mpesa fields for any older caller that hasn't migrated.
  const channelAmounts: Record<string, number> = body.channelAmounts && typeof body.channelAmounts === 'object'
    ? body.channelAmounts
    : { CRDB: Number(body.crdb) || 0, STANBIC: Number(body.stanbic) || 0, MPESA: Number(body.mpesa) || 0 }
  const discount = roundMoney(Number(body.discount) || 0)
  const total = roundMoney(Number(cash) + sumChannelAmounts(channelAmounts))
  // Cashiers can never move a collection to another outlet.
  const usedOutletId = user.role === 'CASHIER' ? existing.outletId : (outletId || existing.outletId)
  const collDate = date ? new Date(date) : existing.date

  // Duplicate guard (exclude this record)
  if (staffName) {
    const dup = await prisma.dailyCollection.findFirst({
      where: {
        id: { not: id },
        outletId: usedOutletId,
        staffName,
        date: { gte: startOfDay(collDate), lte: endOfDay(collDate) },
      },
    })
    if (dup) {
      return NextResponse.json(
        { error: `Another collection for ${staffName} on ${format(collDate, 'dd MMM yyyy')} at this outlet already exists.` },
        { status: 409 }
      )
    }
  }

  // Moving the collection onto another (closed) day is no back door either.
  if ((usedOutletId !== existing.outletId || startOfDay(collDate).getTime() !== startOfDay(existing.date).getTime())
    && await isDayLocked(prisma, usedOutletId, collDate)) {
    return NextResponse.json({ error: 'The target day is closed. It must be reopened before a collection can be moved onto it.' }, { status: 423 })
  }

  // Itemised money (staff declarations / itemised cashier entries) can't be
  // overwritten by typed totals: those figures are derived from the
  // transactions themselves. Correct the transactions instead.
  const itemised = existing.ledgerBacked && await hasItemisedLines(prisma, id)
  if (itemised) {
    const current = channelAmountsFor(existing)
    const codes = new Set([...Object.keys(current), ...Object.keys(channelAmounts)])
    const moneyChanged = roundMoney(Number(cash) || 0) !== roundMoney(existing.cash)
      || [...codes].some((k) => roundMoney(Number(channelAmounts[k]) || 0) !== roundMoney(current[k] || 0))
    const identityChanged = (staffName || null) !== existing.staffName || usedOutletId !== existing.outletId
      || startOfDay(collDate).getTime() !== startOfDay(existing.date).getTime()
    if (moneyChanged || identityChanged) {
      return NextResponse.json({
        error: 'This collection\'s cash and channel amounts come from itemised transactions, so they can\'t be typed over. Correct the individual transactions instead.',
      }, { status: 409 })
    }
  }

  // Validate Difference Reasons BEFORE opening the transaction —
  // excessReasonCategoryDb can write-seed through the plain client, which would
  // deadlock against an open SQLite write transaction (see collections POST).
  type ExcessInput = { id: string | null; amount: number; reason: string; staffId: string | null; personId: string | null; notes: string | null }
  let excessItems: ExcessInput[] | null = null
  const categories = new Map<string, string>()
  if (Array.isArray(body.excessItems)) {
    const rawItems: { id?: string; amount: number; reason: string; staffId?: string; personId?: string; notes?: string }[] = body.excessItems
    excessItems = rawItems
      .map((it) => ({ id: it.id || null, amount: roundMoney(it.amount), reason: it.reason, staffId: it.staffId || null, personId: it.personId || null, notes: it.notes?.trim() || null }))
      .filter((it) => it.amount > 0)
    for (const it of excessItems) {
      if (!(await isValidExcessReasonCode(it.reason))) {
        return NextResponse.json({ error: 'Select a reason for each excess amount collected' }, { status: 400 })
      }
      const category = await excessReasonCategoryDb(it.reason)
      if (!category) return NextResponse.json({ error: 'Select a valid reason for each excess amount collected' }, { status: 400 })
      categories.set(it.reason, category)
      if (it.reason === 'STAFF_TIP' && !it.staffId) return NextResponse.json({ error: 'Select the staff name for the excess amount collected' }, { status: 400 })
      if (it.reason === 'CUSTOMER_EXCESS' && !it.personId) return NextResponse.json({ error: 'Select the customer name for the excess amount collected' }, { status: 400 })
    }
  }

  let result: { updated: Awaited<ReturnType<typeof prisma.dailyCollection.findUniqueOrThrow>>; shortfall: number }
  try {
    result = await prisma.$transaction(async (tx) => {
      const moneyFields = itemised ? {} : { cash: roundMoney(cash), ...legacyFixedFields(channelAmounts), total }
      await tx.dailyCollection.update({
        where: { id },
        data: {
          ...moneyFields,
          staffName: staffName || null, systemSales: roundMoney(systemSales),
          discount, discountReason: discountReason || null,
          notes, outletId: usedOutletId, date: collDate,
        },
      })
      if (existing.ledgerBacked) {
        // Un-itemised collection: the typed totals ARE its CHANNEL_TOTAL rows.
        if (!itemised) {
          await writeChannelTotalLines(tx, { collectionId: id, outletId: usedOutletId, date: collDate, staffName: staffName || null, cash: roundMoney(cash), channelAmounts })
        }
      } else {
        // Pre-ledger collection: typed totals stay the record (no synthetic rows).
        await syncCollectionChannels(tx, id, channelAmounts)
      }

      // Replace cancellations for this collection if the edit form sent them.
      if (Array.isArray(body.cancellations)) {
        await tx.cancellation.deleteMany({ where: { collectionId: id } })
        for (const cn of body.cancellations as { reason: string; productId?: string; productName: string; sellingPrice: number; quantity: number; amount: number }[]) {
          const qty = Number(cn.quantity) || 0
          const price = roundMoney(cn.sellingPrice)
          if (!cn.productName || qty <= 0) continue
          await tx.cancellation.create({
            data: {
              collectionId: id,
              reason: cn.reason || '',
              productId: cn.productId || null,
              productName: cn.productName,
              sellingPrice: price,
              quantity: qty,
              amount: roundMoney(Number(cn.amount) || price * qty),
              outletId: usedOutletId,
              cashierId: user.userId,
              date: collDate,
            },
          })
        }
      }

      // Sync submitted excess line items (upsert-by-id, preserving paidAmount and
      // blocking removal of settled rows — same rule as Cash Recon's excessItems).
      if (excessItems) {
        const items = excessItems
        const primaryChannelCode = primaryChannelFromAmounts(Number(cash) || 0, channelAmounts)
        const [staffRows, personRows] = await Promise.all([
          tx.user.findMany({ where: { id: { in: items.filter((i) => i.staffId).map((i) => i.staffId as string) } }, select: { id: true, name: true } }),
          tx.person.findMany({ where: { id: { in: items.filter((i) => i.personId).map((i) => i.personId as string) } }, select: { id: true, name: true } }),
        ])
        const priorItems = await tx.collectionExcess.findMany({ where: { collectionId: id } })
        const incomingIds = new Set(items.filter((it) => it.id).map((it) => it.id as string))
        const toRemove = priorItems.filter((p) => !incomingIds.has(p.id))
        const blockedRemoval = toRemove.find((p) => p.paidAmount > 0)
        if (blockedRemoval) {
          throw new EditConflict(`Cannot remove an excess item that already has ${blockedRemoval.paidAmount} settled — clear its payments in Excess Recon first`)
        }
        if (toRemove.length > 0) {
          await tx.collectionExcess.deleteMany({ where: { id: { in: toRemove.map((p) => p.id) } } })
        }
        for (const it of items) {
          const category = categories.get(it.reason)!
          const fields = {
            amount: it.amount, reason: it.reason, category, accountingClass: classForReason(it.reason, category), notes: it.notes, channelCode: primaryChannelCode,
            staffId: it.staffId, staffName: it.staffId ? staffRows.find((s) => s.id === it.staffId)?.name || null : null,
            personId: it.personId, personName: it.personId ? personRows.find((p) => p.id === it.personId)?.name || null : null,
          }
          if (it.id && priorItems.some((p) => p.id === it.id)) {
            await tx.collectionExcess.update({ where: { id: it.id }, data: fields })
          } else {
            const recordId = crypto.randomUUID()
            const ref = await generateBillReference(tx, {
              recordId, sourceModel: 'CollectionExcess', billTypeCode: 'EXS', date: collDate, personId: it.personId, outletId: usedOutletId,
            })
            await tx.collectionExcess.create({
              data: {
                id: recordId, collectionId: id, ...fields,
                internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
              },
            })
          }
        }
      }

      // The single writer of derived figures: re-derive ledger totals, staff
      // loss (nets approved cancellations) + excess true-up, BusinessSession,
      // and the GL cash-in entry (reverse + re-post if the amounts moved).
      const { shortfall } = await rebuildCollection(tx, id, user.userId)
      const updated = await tx.dailyCollection.findUniqueOrThrow({ where: { id }, include: { outlet: true } })

      // Before/after snapshot of the fields that actually changed, plus the
      // caller's stated reason (if any) — so an admin tracing a discrepancy back
      // through /audit sees exactly what changed and why, not just the new total.
      const CHANGED_FIELDS = ['cash', 'crdb', 'stanbic', 'mpesa', 'total', 'staffName', 'systemSales', 'discount', 'notes', 'outletId', 'date'] as const
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      for (const field of CHANGED_FIELDS) {
        const before = existing[field] instanceof Date ? existing[field].toISOString() : existing[field]
        const after = updated[field] instanceof Date ? updated[field].toISOString() : updated[field]
        if (before !== after) changes[field] = { from: before, to: after }
      }
      const channelsBefore = channelAmountsFor(existing)
      const channelsAfter = channelAmountsFor({ ...updated, channels: await tx.dailyCollectionChannel.findMany({ where: { collectionId: id } }) })
      for (const code of new Set([...Object.keys(channelsBefore), ...Object.keys(channelsAfter)])) {
        if ((channelsBefore[code] || 0) !== (channelsAfter[code] || 0)) changes[`channel:${code}`] = { from: channelsBefore[code] || 0, to: channelsAfter[code] || 0 }
      }

      await tx.auditLog.create({
        data: {
          userId: user.userId, action: 'UPDATE', entity: 'DailyCollection', entityId: id,
          details: JSON.stringify({ changes, staffLoss: shortfall > 0 ? shortfall : 0, reason: body.reason || null }),
        },
      })
      return { updated, shortfall }
    }, { timeout: 20000 })
  } catch (e) {
    // EditConflict = a business rule; anything else (e.g. a locked financial
    // period refusing the GL reversal) rolls the whole edit back.
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to update collection' }, { status: 409 })
  }

  const staffLoss = staffName && result.shortfall > 0 ? { amount: result.shortfall, staffName } : null
  return NextResponse.json({ ...result.updated, staffLoss })
}

class EditConflict extends Error {}

/** Reverse a posted GL entry if it exists and isn't already reversed. The
 *  Finance Platform's rule is "never delete, only reverse" (see lib/ledger.ts),
 *  so when a collection's auto bills / receipts are removed we post an
 *  equal-and-opposite entry rather than deleting the JournalEntry row. */
async function reverseIfPosted(tx: Db, journalEntryId: string | null | undefined, userId: string, reason: string): Promise<boolean> {
  if (!journalEntryId) return false
  const je = await tx.journalEntry.findUnique({ where: { id: journalEntryId }, select: { status: true } })
  if (!je || je.status === 'REVERSED') return false
  await reverseJournalEntry(tx, { journalEntryId, userId, reason })
  return true
}

/**
 * Delete a collection AND every record that collection created for that
 * staff/day/session — atomically. A collection session owns:
 *   • its channel breakdown + excess line items (DB cascade),
 *   • its cancellations (FK collectionId),
 *   • the auto staff-loss bill "SL-<id>" and the auto voucher bills
 *     "VCH-<id>-N" it generated (matched by autoKey / autoSourceCollectionId),
 *     together with their line items (DB cascade) and any write-offs, and
 *   • the recovery paid bills it recorded ("COL-<id>", plus any payment sitting
 *     on one of the auto bills).
 * Deleting a recovery payment that was applied to a *pre-existing* unrelated
 * bill un-applies it (that bill's status/balance is recomputed) but never
 * deletes that bill. Every GL posting these bills/receipts made is reversed
 * (not deleted), and every affected credit account/person balance is rebuilt
 * from the now-reduced source data. Cash Requests (PettyCash) are deliberately
 * left untouched — they have no ownership link to a collection.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const existing = await prisma.dailyCollection.findUnique({ where: { id }, include: { outlet: { select: { name: true } } } })
  if (!existing) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
  if (!CROSS_OUTLET.includes(user.role) && user.outletId && existing.outletId !== user.outletId) {
    return NextResponse.json({ error: 'You can only delete collections from your own outlet' }, { status: 403 })
  }
  // Closed days are locked for EVERY role (was: cashiers only).
  if (await isDayLocked(prisma, existing.outletId, existing.date)) {
    return NextResponse.json({ error: 'This day is closed. It must be reopened (Unlock Requests) before this collection can be deleted.' }, { status: 423 })
  }
  const excessItems = await db.collectionExcess.findMany({ where: { collectionId: id } })
  if (excessItems.some((it: { paidAmount: number }) => it.paidAmount > 0)) {
    return NextResponse.json({ error: 'This collection has a settled excess amount in Excess Recon — it cannot be deleted.' }, { status: 409 })
  }

  const reason = `Collection ${id} deleted`
  let summary: { autoBills: number; paidBills: number; writeOffs: number; externalBillsRecomputed: number; reversedEntries: number; removedStaffLoss: boolean }
  try {
    summary = await prisma.$transaction(async (tx) => {
      const txAny = tx as unknown as typeof db

      // 1) This collection's own auto-generated signed bills: the staff-loss
      //    voucher (SL-<id>) and one voucher per signed-bill line (VCH-<id>-N),
      //    plus anything explicitly tagged back to this collection.
      const autoBills = await tx.signedBill.findMany({
        where: { OR: [
          { autoKey: `SL-${id}` },
          { autoKey: { startsWith: `VCH-${id}-` } },
          { autoSourceCollectionId: id },
        ] },
        select: { id: true, autoKey: true, journalEntryId: true, creditAccountId: true, personId: true },
      })
      const autoBillIds = autoBills.map((b) => b.id)
      const removedStaffLoss = autoBills.some((b) => b.autoKey === `SL-${id}`)

      // 2) Recovery paid bills this session recorded (billRef COL-<id>), plus
      //    any payment attached to one of the auto bills above.
      const paidBillOr: Record<string, unknown>[] = [{ billRef: `COL-${id}` }]
      if (autoBillIds.length) paidBillOr.push({ signedBillId: { in: autoBillIds } })
      const paidBills = await tx.paidBill.findMany({
        where: { OR: paidBillOr },
        select: { id: true, journalEntryId: true, signedBillId: true, personId: true },
      })

      // 3) Write-offs booked against the auto bills (no DB cascade on the FK,
      //    so they must be cleared explicitly or the bill delete would fail).
      const writeOffs = autoBillIds.length
        ? await tx.signedBillWriteOff.findMany({ where: { signedBillId: { in: autoBillIds } }, select: { id: true, journalEntryId: true } })
        : []

      // Pre-existing bills (not this collection's own) that a removed recovery
      // payment was applied to — their status/balance is recomputed afterwards.
      const externalBillIds = [...new Set(
        paidBills.map((p) => p.signedBillId).filter((sid): sid is string => !!sid && !autoBillIds.includes(sid))
      )]

      // The collection's OWN cash-in posting (Dr Cash/Bank per channel / Cr
      // Sales Revenue [+ Cr Excess-Payable]) is posted at create time with
      // sourceType='DailyCollection'/sourceId=<id> and its JE id is NOT stored
      // on any row (DailyCollection has no journalEntryId column), so it can
      // only be found by source. Without reversing it the GL would overstate
      // cash and revenue by the deleted collection's total forever.
      const collectionEntries = await tx.journalEntry.findMany({
        where: liveCollectionEntryWhere(id), // excludes earlier reversal entries
        select: { id: true },
      })

      // ── Reverse GL first (post equal-and-opposite; never delete a JE) ──
      let reversedEntries = 0
      for (const je of collectionEntries) if (await reverseIfPosted(tx, je.id, user.userId, reason)) reversedEntries++
      for (const p of paidBills) if (await reverseIfPosted(tx, p.journalEntryId, user.userId, reason)) reversedEntries++
      for (const w of writeOffs) if (await reverseIfPosted(tx, w.journalEntryId, user.userId, reason)) reversedEntries++
      for (const b of autoBills) if (await reverseIfPosted(tx, b.journalEntryId, user.userId, reason)) reversedEntries++

      // ── Delete records (children first) ──
      if (paidBills.length) await tx.paidBill.deleteMany({ where: { id: { in: paidBills.map((p) => p.id) } } })
      if (writeOffs.length) await tx.signedBillWriteOff.deleteMany({ where: { id: { in: writeOffs.map((w) => w.id) } } })
      if (autoBillIds.length) await tx.signedBill.deleteMany({ where: { id: { in: autoBillIds } } }) // BillItems cascade
      await tx.cancellation.deleteMany({ where: { collectionId: id } })

      // Transaction Ledger: the typed CHANNEL_TOTAL rows belong to this
      // collection and go with it; staff declarations are released (unlinked,
      // unlocked) so the cashier can re-validate them, and their session is
      // reopened for that.
      await tx.staffTransaction.deleteMany({ where: { collectionId: id, source: 'CHANNEL_TOTAL' } })
      const released = await tx.staffTransaction.findMany({ where: { collectionId: id }, select: { sessionId: true } })
      await tx.staffTransaction.updateMany({ where: { collectionId: id }, data: { collectionId: null, lockedAt: null } })
      const sessionIds = [...new Set(released.map((r) => r.sessionId).filter((s): s is string => !!s))]
      if (sessionIds.length) await tx.transactionSession.updateMany({ where: { id: { in: sessionIds }, status: 'VALIDATED' }, data: { status: 'OPEN' } })

      await tx.dailyCollection.delete({ where: { id } }) // channels + excess cascade

      // The BI layer's BusinessSession row is denormalized from this collection
      // (one row per staff/outlet/day). Nothing re-syncs it on delete, so
      // without this the dashboard's Staff Performance widget keeps showing the
      // deleted collection's staff/days/dailyLoss. Target by sourceCollectionId
      // so a session re-synced from a *different* surviving collection for the
      // same staff/outlet/day is left intact.
      await txAny.businessSession.deleteMany({ where: { sourceCollectionId: id } })

      // ── Un-apply removed payments from pre-existing bills (recompute status) ──
      for (const bid of externalBillIds) {
        const bill = await tx.signedBill.findUnique({ where: { id: bid }, select: { amount: true, status: true } })
        if (!bill || bill.status === 'WRITTEN_OFF') continue
        const [pay, wo] = await Promise.all([
          tx.paidBill.aggregate({ where: { signedBillId: bid }, _sum: { amountPaid: true } }),
          tx.signedBillWriteOff.aggregate({ where: { signedBillId: bid }, _sum: { amount: true } }),
        ])
        const tot = roundMoney((pay._sum.amountPaid || 0) + (wo._sum.amount || 0))
        await tx.signedBill.update({ where: { id: bid }, data: { status: tot >= bill.amount ? 'PAID' : tot > 0 ? 'PARTIAL' : 'UNPAID' } })
      }

      // ── Rebuild affected credit ledgers/balances from the reduced source ──
      const accountIds = new Set<string>()
      const personIds = new Set<string>()
      for (const b of autoBills) { if (b.creditAccountId) accountIds.add(b.creditAccountId); else if (b.personId) personIds.add(b.personId) }
      for (const p of paidBills) if (p.personId) personIds.add(p.personId)
      if (externalBillIds.length) {
        const ext = await tx.signedBill.findMany({ where: { id: { in: externalBillIds } }, select: { creditAccountId: true, personId: true } })
        for (const b of ext) { if (b.creditAccountId) accountIds.add(b.creditAccountId); else if (b.personId) personIds.add(b.personId) }
      }
      for (const accId of accountIds) await syncCreditForAccount(tx, accId)
      for (const pid of personIds) await syncCreditForPerson(tx, pid)

      // Full snapshot of the deleted record (not just its id) — once deleted,
      // dailyCollection.findUnique(entityId) returns nothing, so this audit row
      // is the ONLY place an admin can later see what the record contained
      // (staff, amounts, outlet, date) alongside who deleted it, when, why, and
      // exactly how much related data was cascaded away.
      await tx.auditLog.create({
        data: {
          userId: user.userId, action: 'DELETE', entity: 'DailyCollection', entityId: id,
          details: JSON.stringify({
            reason: body.reason || null,
            removedStaffLoss,
            cascade: {
              signedBills: autoBillIds.length, paidBills: paidBills.length, writeOffs: writeOffs.length,
              reversedJournalEntries: reversedEntries, externalBillsRecomputed: externalBillIds.length,
            },
            snapshot: {
              date: existing.date.toISOString(), outletName: existing.outlet.name, staffName: existing.staffName,
              total: existing.total, cash: existing.cash, crdb: existing.crdb, stanbic: existing.stanbic, mpesa: existing.mpesa,
              systemSales: existing.systemSales, creditSales: existing.creditSales, paymentsReceived: existing.paymentsReceived,
              discount: existing.discount, notes: existing.notes, createdAt: existing.createdAt.toISOString(),
            },
          }),
        },
      })

      return { autoBills: autoBillIds.length, paidBills: paidBills.length, writeOffs: writeOffs.length, externalBillsRecomputed: externalBillIds.length, reversedEntries, removedStaffLoss }
    }, { timeout: 20000 })
  } catch (e) {
    // Reversals post-date to today (lib/ledger.ts reverseJournalEntry uses
    // new Date()), so a locked *current* financial period will reject them and
    // roll the whole delete back. Surface the message verbatim so the user
    // knows to reopen that period rather than seeing a generic 500.
    const message = e instanceof Error ? e.message : 'Failed to delete collection'
    return NextResponse.json({ error: message }, { status: 409 })
  }

  return NextResponse.json({ ok: true, removedStaffLoss: summary.removedStaffLoss, cascade: summary })
}
