import type { SmokeCheck } from '../types'

// Read-only: confirms the RBAC-gated reconciliation-stages endpoint is alive
// and returns the expected shape. Safe to run in --readonly mode too.
const check: SmokeCheck = async ({ client }) => {
  const res = await client.get('/api/reconciliation-stages')
  if (res.status !== 200) {
    return { status: 'fail', message: `GET /api/reconciliation-stages returned ${res.status}` }
  }
  if (!Array.isArray(res.body?.stages)) {
    return { status: 'fail', message: 'response missing expected "stages" array' }
  }
  return { status: 'pass' }
}

export default check
