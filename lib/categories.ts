// Shared mapping between paid-bill payment categories and signed-bill types.
// Safe to import on both client and server (no prisma).
export const CATEGORY_TO_BILLTYPE: Record<string, string> = {
  'Customer': 'CUSTOMER',
  'Staff Loss': 'STAFF_LOSS',
  'Admin': 'ADMIN',
  'Director': 'DIRECTOR',
  'Sponsors & Partners': 'TIPS',
}

export const BILLTYPE_TO_CATEGORY: Record<string, string> = {
  CUSTOMER: 'Customer',
  STAFF_LOSS: 'Staff Loss',
  ADMIN: 'Admin',
  DIRECTOR: 'Director',
  TIPS: 'Sponsors & Partners',
}
