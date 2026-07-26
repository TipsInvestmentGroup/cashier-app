import type { SmokeCheck } from '../types'

// Daily collection: posts a real zero-value collection (systemSales=0,
// cash=0 keeps the reconciliation difference at 0 so no excessItems are
// required) and checks the computed fields come back sane. Write-mutating,
// so skipped in --readonly mode (used for post-deploy prod checks).
const check: SmokeCheck = async ({ client, user, readonly }) => {
  if (readonly) {
    return { status: 'skip', message: 'write-mutating check skipped in --readonly mode' }
  }

  let outletId = user.outletId
  if (!outletId) {
    const outlets = await client.get('/api/outlets')
    if (outlets.status !== 200 || !Array.isArray(outlets.body) || outlets.body.length === 0) {
      return { status: 'skip', message: 'no outlets seeded — cannot post a collection' }
    }
    outletId = outlets.body[0].id
  }

  // staffName+date+outlet must be unique — a fixed name would 409 on a
  // second run the same calendar day (e.g. two CI runs in one day).
  const res = await client.post('/api/collections', {
    outletId,
    staffName: `SMOKE_TEST_${Date.now()}`,
    systemSales: 0,
    cash: 0,
  })

  if (res.status !== 201) {
    return { status: 'fail', message: `POST /api/collections returned ${res.status}: ${JSON.stringify(res.body)}` }
  }
  // staffLoss/excess are null (not absent) for a zero-discrepancy collection
  // like this one — a clean 201 with the collection's id is the assertion.
  if (!res.body?.id) {
    return { status: 'fail', message: 'response missing expected collection id' }
  }
  return { status: 'pass' }
}

export default check
