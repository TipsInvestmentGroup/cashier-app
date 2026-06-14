const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
// Manager(s) allowed to file requests alongside cashiers.
export const REQUEST_MANAGERS = ['alphonce.mvungi@tips.co.tz']

/** Cashiers + the designated manager(s) (owner override) may file cancellation/bill requests. */
export function canFileRequest(role?: string, email?: string) {
  const e = (email || '').toLowerCase()
  return role === 'CASHIER' || REQUEST_MANAGERS.includes(e) || (!!OWNER_EMAIL && e === OWNER_EMAIL)
}
