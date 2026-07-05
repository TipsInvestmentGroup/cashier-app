// Read-only reference-data caching (products, tables, shifts, extras,
// counters) for the brief-offline resilience story. Losing this cache just
// means a refetch next time — unlike the mutation queue (lib/offline-queue.ts),
// which represents unbilled revenue and needs IndexedDB's stronger
// durability, plain localStorage is an acceptable trade here.
import { NetworkError } from './offline-queue'

const PREFIX = 'mypos_cache_'

function readCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeCache(key: string, data: unknown): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(data))
  } catch {
    // Storage full/unavailable — non-fatal, just skip caching this round.
  }
}

/**
 * Runs `fetcher()`; on success, caches the result under `key` and returns it.
 * On a genuine NetworkError (see lib/offline-queue.ts's apiFetch), falls
 * back to the last cached value for `key` if one exists — callers should
 * treat a `fromCache: true` result as possibly stale. A real server
 * rejection (fetcher throwing anything other than NetworkError) is NOT
 * masked by a stale cache — it propagates as-is.
 */
export async function getWithCache<T>(key: string, fetcher: () => Promise<T>): Promise<{ data: T; fromCache: boolean }> {
  try {
    const data = await fetcher()
    writeCache(key, data)
    return { data, fromCache: false }
  } catch (err) {
    if (!(err instanceof NetworkError)) throw err
    const cached = readCache<T>(key)
    if (cached !== null) return { data: cached, fromCache: true }
    throw err
  }
}
