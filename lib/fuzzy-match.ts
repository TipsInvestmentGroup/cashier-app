// Shared fuzzy string matching for the Sales Import Center (and any other
// name-reconciliation flow). Dependency-free so both server routes and
// 'use client' components can import it. This centralizes the Levenshtein
// similarity that used to be copy-pasted into UploadSalesModal.tsx and
// StageExcelImportRenderer.tsx.

/** Case/whitespace-insensitive identity key — same rule as normalizePersonName. */
export function normalizeName(name: string): string {
  return String(name || '').trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
  }
  return d[m][n]
}

/** Similarity in 0..1. Token containment (one name inside the other) floors at 0.85. */
export function similarity(a: string, b: string): number {
  const la = String(a || '').trim().toLowerCase(), lb = String(b || '').trim().toLowerCase()
  if (!la || !lb) return 0
  if (la === lb) return 1
  const dist = levenshtein(la, lb)
  let s = 1 - dist / (Math.max(la.length, lb.length) || 1)
  if (la.includes(lb) || lb.includes(la)) s = Math.max(s, 0.85)
  return s
}

export interface Suggestion<T = string> { value: T; label: string; score: number }

/**
 * Best candidate for `name` from `candidates` at or above `threshold`.
 * Candidates may be plain strings or {label,value} objects so the same helper
 * works for staff names and product rows.
 */
export function bestMatch<T = string>(
  name: string,
  candidates: Array<string | { label: string; value: T }>,
  threshold = 0.55,
): Suggestion<T> | null {
  let best: Suggestion<T> | null = null
  for (const c of candidates) {
    const label = typeof c === 'string' ? c : c.label
    const value = (typeof c === 'string' ? c : c.value) as T
    const score = similarity(name, label)
    if (!best || score > best.score) best = { value, label, score }
  }
  return best && best.score >= threshold ? best : null
}
