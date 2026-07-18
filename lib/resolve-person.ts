import { findBestPersonMatch } from '@/lib/nameMatch'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

/**
 * Resolve a free-text signed-bill name to a Person: use an explicit personId
 * from the caller when given (already confirmed in the UI), otherwise
 * fuzzy-match against existing persons of the same type, and auto-create a
 * new Person when nothing matches so the entry is never missing from
 * Accounts Receivable. Shared by the fixed Daily Collections form
 * (app/api/collections/route.ts) and the Transaction Management validate
 * route (app/api/transaction-sessions/[id]/validate/route.ts) — both need
 * the exact same "don't fragment the customer list" behavior.
 */
export async function resolvePerson(
  tx: Tx, name: string, type: string, personId?: string | null, confirmedNew?: boolean
) {
  if (personId) {
    const existing = await tx.person.findUnique({ where: { id: personId } })
    if (existing) return existing
  }
  if (!confirmedNew) {
    const candidates = await tx.person.findMany({ where: { type }, select: { id: true, name: true } })
    const result = findBestPersonMatch(name, candidates)
    if (result.kind === 'exact' || result.kind === 'similar') {
      return tx.person.findUnique({ where: { id: result.match.id } })
    }
  }
  return tx.person.create({ data: { name, type, isActive: true } })
}
