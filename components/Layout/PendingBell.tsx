'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { PENDING_COUNTS_CHANGED } from '@/lib/pendingBellEvents'

const APPROVERS = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
interface Item { key: string; label: string; count: number; href: string }

export function PendingBell() {
  const { request } = useApi()
  const { user } = useAuth()
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const canApprove = APPROVERS.includes(user?.role || '')

  const load = useCallback(async () => {
    if (!canApprove) return
    try { const r = await request('/api/pending-counts'); setItems(r.items || []); setTotal(r.total || 0) }
    catch { /* ignore */ }
  }, [request, canApprove])

  // Load on mount, on focus, every 60s, and whenever a request is approved/rejected anywhere in the app.
  useEffect(() => {
    if (!canApprove) return
    load()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    window.addEventListener(PENDING_COUNTS_CHANGED, onFocus)
    const id = setInterval(load, 60000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(PENDING_COUNTS_CHANGED, onFocus)
      clearInterval(id)
    }
  }, [load, canApprove])

  // Close on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  if (!canApprove) return null

  const go = (href: string) => { setOpen(false); router.push(href) }

  return (
    <div ref={boxRef} className="relative">
      <button onClick={() => { setOpen((o) => !o); load() }} title="Pending approvals"
        className="relative p-2 rounded-lg text-gray-600 hover:bg-gray-100">
        <Bell className="w-5 h-5" />
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-64 bg-white border-2 border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 text-xs font-bold uppercase tracking-wide text-gray-400">Pending approvals</div>
          {items.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">✓ All clear</div>
          ) : (
            items.map((i) => (
              <button key={i.key} onClick={() => go(i.href)}
                className="flex items-center justify-between w-full px-3 py-2.5 text-sm hover:bg-indigo-50 border-b border-gray-50 last:border-0">
                <span className="text-gray-700">{i.label}</span>
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">{i.count}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
