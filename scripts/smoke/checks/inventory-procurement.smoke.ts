import type { SmokeCheck } from '../types'

// No dedicated Inventory or Procurement UI module exists yet (only
// app/api/inventory/* sub-routes). This exercises the closest read-only
// representative — stock-levels — and explicitly logs Procurement as
// unbuilt rather than faking coverage for a module that doesn't exist.
const check: SmokeCheck = async ({ client }) => {
  const outlets = await client.get('/api/outlets')
  if (outlets.status !== 200 || !Array.isArray(outlets.body) || outlets.body.length === 0) {
    return { status: 'skip', message: 'no outlets seeded — cannot exercise inventory stock-levels' }
  }

  const res = await client.get(`/api/inventory/stock-levels?outletId=${outlets.body[0].id}`)
  if (res.status === 403) {
    return { status: 'skip', message: 'smoke user lacks a management role required for /api/inventory/stock-levels' }
  }
  if (res.status !== 200 || !Array.isArray(res.body?.rows)) {
    return { status: 'fail', message: `GET /api/inventory/stock-levels returned ${res.status}` }
  }
  return { status: 'pass', message: 'Inventory: stock-levels checked. Procurement: no module/API built yet, skipped.' }
}

export default check
