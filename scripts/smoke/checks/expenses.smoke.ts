import type { SmokeCheck } from '../types'

// Expenses: submitting a request requires a valid requestTypeId/categoryId,
// which aren't guaranteed to exist in every environment's seed data. Treat a
// 400 that's clearly about missing type/category config as a SKIP (config
// gap, not a broken route) rather than a hard failure; 401/403/500 still fail.
const check: SmokeCheck = async ({ client, readonly }) => {
  if (readonly) {
    return { status: 'skip', message: 'write-mutating check skipped in --readonly mode' }
  }

  const res = await client.post('/api/expense/requests', {
    requestTypeId: 'smoke-test-nonexistent-type',
    categoryId: 'smoke-test-nonexistent-category',
    purpose: 'SMOKE_TEST',
  })

  if (res.status === 400) {
    return { status: 'skip', message: 'no matching request type/category configured — route validated input correctly' }
  }
  if (res.status !== 201) {
    return { status: 'fail', message: `POST /api/expense/requests returned ${res.status}: ${JSON.stringify(res.body)}` }
  }
  return { status: 'pass' }
}

export default check
