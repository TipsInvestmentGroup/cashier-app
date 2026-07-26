import type { SmokeCheck } from '../types'

// GET /api/permissions/me — any authenticated user, no role gate. Good
// minimal "auth + routing alive" check that always 200s for a valid token.
const check: SmokeCheck = async ({ client }) => {
  const res = await client.get('/api/permissions/me')
  if (res.status !== 200) {
    return { status: 'fail', message: `GET /api/permissions/me returned ${res.status}` }
  }
  return { status: 'pass' }
}

export default check
