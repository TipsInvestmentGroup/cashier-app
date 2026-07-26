import type { SmokeCheck } from '../types'

// No app/api/** route wraps person-import logic — scripts/import-persons.ts
// is a standalone CLI script reading a hardcoded local XLSX path, not
// something a deployed environment exposes over HTTP. Explicit skip rather
// than faking an HTTP check against a route that doesn't exist.
const check: SmokeCheck = async () => {
  return { status: 'skip', message: 'no HTTP import endpoint exists — import-persons.ts is a local CLI script only' }
}

export default check
