'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useApi } from '@/hooks/useApi'

type Hit = { type: string; label: string; sub?: string; href: string }

export function GlobalSearch() {
  const { request } = useApi()
  const router = useRouter()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Debounced query
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      setLoading(true)
      try { const r = await request(`/api/search?q=${encodeURIComponent(q.trim())}`); setResults(r.results || []) }
      catch { setResults([]) }
      finally { setLoading(false) }
    }, 250)
    return () => clearTimeout(t)
  }, [q, request])

  // Close on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  const go = (href: string) => { setOpen(false); setQ(''); setResults([]); router.push(href) }

  return (
    <div ref={boxRef} className="relative flex-1 max-w-md">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
        placeholder="Search people, bills, products…"
        className="w-full pl-9 pr-3 py-2 text-sm border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
      />
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔍</span>

      {open && q.trim().length >= 2 && (
        <div className="absolute z-40 mt-1 w-full bg-white border-2 border-gray-200 rounded-xl shadow-lg max-h-80 overflow-auto">
          {loading && <div className="px-3 py-3 text-sm text-gray-400">Searching…</div>}
          {!loading && results.length === 0 && <div className="px-3 py-3 text-sm text-gray-400">No matches for &ldquo;{q.trim()}&rdquo;</div>}
          {results.map((r, i) => (
            <button key={i} onClick={() => go(r.href)}
              className="block w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-50 last:border-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-800 truncate">{r.label}</span>
                <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded whitespace-nowrap">{r.type}</span>
              </div>
              {r.sub && <div className="text-xs text-gray-400 truncate">{r.sub}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
