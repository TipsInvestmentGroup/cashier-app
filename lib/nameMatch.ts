// Fuzzy name matching for linking free-text cashier entries (e.g. a signed-bill
// customer name) to existing Person records instead of creating fragmented dupes.

export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], row[j - 1])
    }
    prev = row
  }
  return prev[b.length]
}

/** 1 = identical, 0 = completely different. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const maxLen = Math.max(na.length, nb.length)
  return maxLen === 0 ? 1 : 1 - levenshtein(na, nb) / maxLen
}

export const NAME_MATCH_THRESHOLD = 0.72

export type MatchCandidate = { id: string; name: string }
export type NameMatchResult<T extends MatchCandidate> =
  | { kind: 'exact'; match: T }
  | { kind: 'similar'; match: T; score: number }
  | { kind: 'none' }

/** Exact (case/whitespace-insensitive) match wins; otherwise the closest candidate
 *  above NAME_MATCH_THRESHOLD is offered up for the cashier to confirm. */
export function findBestPersonMatch<T extends MatchCandidate>(name: string, candidates: T[]): NameMatchResult<T> {
  const norm = normalizeName(name)
  if (!norm) return { kind: 'none' }

  const exact = candidates.find((c) => normalizeName(c.name) === norm)
  if (exact) return { kind: 'exact', match: exact }

  let best: T | null = null
  let bestScore = 0
  for (const c of candidates) {
    const score = nameSimilarity(name, c.name)
    if (score > bestScore) { bestScore = score; best = c }
  }
  if (best && bestScore >= NAME_MATCH_THRESHOLD) return { kind: 'similar', match: best, score: bestScore }
  return { kind: 'none' }
}
