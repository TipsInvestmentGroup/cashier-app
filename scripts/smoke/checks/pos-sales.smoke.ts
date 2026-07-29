import type { SmokeCheck } from '../types'

// POS: confirm the order-creation route is alive and validates its input —
// a bogus shiftId should 400 (route reachable, validation working), not 500
// (route broken) or 401 (auth broken). This deliberately avoids needing a
// real open PosShift fixture, keeping the check safe to run read-heavy.
const check: SmokeCheck = async ({ client }) => {
  const outlets = await client.get('/api/outlets')
  if (outlets.status !== 200) {
    return { status: 'fail', message: `GET /api/outlets returned ${outlets.status}` }
  }
  if (!Array.isArray(outlets.body) || outlets.body.length === 0) {
    return { status: 'skip', message: 'no outlets seeded — cannot exercise POS order validation' }
  }

  const res = await client.post('/api/pos/orders', {
    shiftId: 'smoke-test-nonexistent-shift',
    outletId: outlets.body[0].id,
  })
  if (res.status !== 400) {
    return { status: 'fail', message: `POST /api/pos/orders with an invalid shiftId returned ${res.status}, expected 400` }
  }
  return { status: 'pass' }
}

export default check
