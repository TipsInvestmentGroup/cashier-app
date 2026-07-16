import { getRequestManagers } from '@/lib/approvals'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()

/** Cashiers + the designated manager(s) (owner override) may file cancellation/bill requests. */
export async function canFileRequest(role?: string, email?: string): Promise<boolean> {
  const e = (email || '').toLowerCase()
  if (role === 'CASHIER' || (!!OWNER_EMAIL && e === OWNER_EMAIL)) return true
  return (await getRequestManagers()).includes(e)
}
