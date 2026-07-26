import type { SmokeCheck } from '../types'

// Pricing/products: list is always safe; creation only runs in write mode.
// Created products are prefixed "SMOKE_TEST" for later identification/cleanup
// (no delete endpoint is confirmed to exist yet).
const check: SmokeCheck = async ({ client, readonly }) => {
  const list = await client.get('/api/products')
  if (list.status !== 200 || !Array.isArray(list.body)) {
    return { status: 'fail', message: `GET /api/products returned ${list.status}` }
  }

  if (readonly) {
    return { status: 'pass', message: 'list-only check (readonly mode)' }
  }

  const created = await client.post('/api/products', { name: `SMOKE_TEST product ${Date.now()}` })
  if (created.status !== 201) {
    return { status: 'fail', message: `POST /api/products returned ${created.status}: ${JSON.stringify(created.body)}` }
  }
  return { status: 'pass' }
}

export default check
