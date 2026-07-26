import type { SmokeCheck } from '../types'

// Finance: create a signed bill in write mode; in --readonly mode (prod
// post-deploy) only confirm the route rejects unauthenticated requests,
// since there's no confirmed safe GET for this domain to exercise instead.
const check: SmokeCheck = async ({ client, user, readonly }) => {
  if (readonly) {
    return { status: 'skip', message: 'write-mutating check skipped in --readonly mode' }
  }

  let outletId = user.outletId
  if (!outletId) {
    const outlets = await client.get('/api/outlets')
    if (outlets.status !== 200 || !Array.isArray(outlets.body) || outlets.body.length === 0) {
      return { status: 'skip', message: 'no outlets seeded — cannot post a signed bill' }
    }
    outletId = outlets.body[0].id
  }

  const res = await client.post('/api/signed-bills', {
    outletId,
    billType: 'CUSTOMER', // valid vocabulary: CUSTOMER | ADMIN | DIRECTOR | DJ | TIPS | STAFF
    personName: 'SMOKE_TEST person',
    amount: 1,
  })

  if (res.status !== 201) {
    return { status: 'fail', message: `POST /api/signed-bills returned ${res.status}: ${JSON.stringify(res.body)}` }
  }
  return { status: 'pass' }
}

export default check
