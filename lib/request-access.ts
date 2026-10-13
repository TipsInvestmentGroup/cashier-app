import { getRequestManagers } from '@/lib/approvals'
import { ownerEmail } from '@/lib/owner'

const OWNER_EMAIL = ownerEmail()

/** Cashiers + the designated manager(s) (owner override) may file cancellation/bill requests. */
export async function canFileRequest(role?: string, email?: string): Promise<boolean> {
  const e = (email || '').toLowerCase()
  if (role === 'CASHIER' || (!!OWNER_EMAIL && e === OWNER_EMAIL)) return true
  return (await getRequestManagers()).includes(e)
}
