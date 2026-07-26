import type { SmokeCheck } from '../types'

// Business calendar: try the runtime status endpoint first (snapshot); fall
// back to the ADMIN-only config-list endpoint so this still passes for a
// non-admin smoke user, since either response proves the module is alive.
const check: SmokeCheck = async ({ client }) => {
  const snapshot = await client.get('/api/business-calendar/snapshot')
  if (snapshot.status === 200) {
    return { status: 'pass' }
  }
  if (snapshot.status === 404) {
    const config = await client.get('/api/business-calendar')
    if (config.status === 200) return { status: 'pass' }
    if (config.status === 403) {
      return { status: 'skip', message: 'smoke user lacks ADMIN role required for /api/business-calendar' }
    }
    return { status: 'fail', message: `GET /api/business-calendar returned ${config.status}` }
  }
  return { status: 'fail', message: `GET /api/business-calendar/snapshot returned ${snapshot.status}` }
}

export default check
