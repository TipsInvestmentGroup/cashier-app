// Person Code assignment helper — a thin wrapper around the Bill Reference
// System's generic atomic sequence primitive (see lib/bill-reference.ts's
// nextGenericSequenceValue), reused here so Person.code numbering shares the
// exact same collision-safe counter mechanism as bill references, scoped per
// person `type` (scopeKey `PERSONCODE:<type>`). Used by app/api/persons/route.ts,
// app/api/persons/[id]/route.ts, and app/api/persons/bulk-assign-codes/route.ts.
//
// MUST be called inside the caller's own prisma.$transaction — the counter
// increment must be atomic with the Person row write, exactly like every
// other caller of nextGenericSequenceValue.
import { nextGenericSequenceValue } from './bill-reference'

// Loose type — works with both the prisma singleton and a $transaction
// client, same convention as lib/bill-reference.ts's `Tx`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

export const PERSON_CODE_PADDING = 3
const MAX_ATTEMPTS = 20

/** Returns a free, zero-padded sequential code for `type`, retrying past any
 *  collision with an existing (e.g. manually-assigned) code — mirrors the
 *  retry convention in generateBillReference's registry-insert loop. */
export async function nextFreePersonCode(tx: Tx, type: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const n = await nextGenericSequenceValue(tx, `PERSONCODE:${type}`)
    const code = String(n).padStart(PERSON_CODE_PADDING, '0')
    const clash = await tx.person.findFirst({ where: { type, code }, select: { id: true } })
    if (!clash) return code
  }
  throw new Error(`Could not find a free person code for type "${type}" after ${MAX_ATTEMPTS} attempts`)
}
