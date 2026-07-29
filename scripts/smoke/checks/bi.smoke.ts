import type { SmokeCheck } from '../types'

// BI/analytics roll-up (Sales Import Center's category-agnostic analytics):
// read-only GET, no write path exists, so this check runs the same in both
// normal and --readonly mode.
const check: SmokeCheck = async ({ client }) => {
  const res = await client.get('/api/sales-imports/analytics')
  if (res.status !== 200) {
    return { status: 'fail', message: `GET /api/sales-imports/analytics returned ${res.status}` }
  }

  const body = res.body
  const requiredKeys = ['kpis', 'products', 'categories', 'staff', 'outlets', 'trend']
  const missing = requiredKeys.filter((k) => !(k in (body || {})))
  if (missing.length > 0) {
    return { status: 'fail', message: `response missing keys: ${missing.join(', ')}` }
  }

  return { status: 'pass' }
}

export default check
