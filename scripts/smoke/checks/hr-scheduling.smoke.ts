import type { SmokeCheck } from '../types'

// HR: list endpoint is always safe; creation only in write mode.
const check: SmokeCheck = async ({ client, readonly }) => {
  const list = await client.get('/api/persons')
  if (list.status !== 200 || !Array.isArray(list.body)) {
    return { status: 'fail', message: `GET /api/persons returned ${list.status}` }
  }

  if (readonly) {
    return { status: 'pass', message: 'list-only check (readonly mode)' }
  }

  const created = await client.post('/api/persons', { name: `SMOKE_TEST person ${Date.now()}`, type: 'STAFF' })
  if (created.status !== 201) {
    return { status: 'fail', message: `POST /api/persons returned ${created.status}: ${JSON.stringify(created.body)}` }
  }
  return { status: 'pass' }
}

export default check
