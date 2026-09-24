'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { BellRing } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatDateTime } from '@/lib/utils'
import { NOTIFICATIONS_CHANGED } from '@/lib/pendingBellEvents'

interface Notification { id: string; type: string; title: string; message: string; read: boolean; createdAt: string; entityType?: string | null; entityId?: string | null }

/**
 * Where a notification takes you when clicked. The backend already stamps
 * entityType/entityId on every actionable notification (see lib/notifications.ts
 * and the expense/reconciliation/business-day workflows) — this just turns that
 * into a destination. Returns null for notifications with no navigable target,
 * in which case clicking only marks them read (the prior behaviour).
 */
function notificationHref(n: Notification): string | null {
  switch (n.entityType) {
    // Both disbursements AND fund top-ups (direction=IN) are ExpenseRequests, so
    // this one route serves every "awaiting your approval" item — the detail page
    // already carries the Approve/Reject buttons regardless of direction.
    case 'ExpenseRequest': return n.entityId ? `/expense-requests/${n.entityId}` : null
    case 'BusinessDay': return '/business-day-unlock-requests'
    case 'ReconciliationStage':
    case 'ReconciliationStageUnlockRequest': return '/reconciliation-stages'
    case 'DailyReport': return '/reports'
    default: return null
  }
}

export function NotificationBell() {
  const { request } = useApi()
  const { user } = useAuth()
  const [items, setItems] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!user) return
    try { const r = await request('/api/notifications'); setItems(r.notifications || []); setUnreadCount(r.unreadCount || 0) }
    catch { /* ignore */ }
  }, [request, user])

  useEffect(() => {
    if (!user) return
    load()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    window.addEventListener(NOTIFICATIONS_CHANGED, onFocus)
    const id = setInterval(load, 60000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(NOTIFICATIONS_CHANGED, onFocus)
      clearInterval(id)
    }
  }, [load, user])

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  if (!user) return null

  const onSelect = async (n: Notification) => {
    if (!n.read) {
      // Await the mark-read so the badge is correct before we leave the page;
      // navigation below unmounts this component anyway.
      try { await request(`/api/notifications/${n.id}/read`, { method: 'POST' }); load() } catch { /* ignore */ }
    }
    const href = notificationHref(n)
    if (href) { setOpen(false); window.location.assign(href) }
  }

  const markAllRead = async () => {
    try { await request('/api/notifications/read-all', { method: 'POST' }); load() } catch { /* ignore */ }
  }

  return (
    <div ref={boxRef} className="relative">
      <button onClick={() => { setOpen((o) => !o); load() }} title="Notifications"
        className="relative p-2 rounded-lg text-gray-600 hover:bg-gray-100">
        <BellRing className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-80 bg-white border-2 border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-gray-400">Notifications</span>
            {unreadCount > 0 && <button onClick={markAllRead} className="text-xs text-indigo-600 hover:underline">Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-400 text-center">✓ No notifications</div>
            ) : (
              items.map((n) => {
                const href = notificationHref(n)
                return (
                  <button key={n.id} onClick={() => onSelect(n)}
                    className={`block w-full text-left px-3 py-2.5 text-sm hover:bg-indigo-50 border-b border-gray-50 last:border-0 ${n.read ? 'opacity-60' : ''}`}>
                    <p className="font-semibold text-gray-800 flex items-center gap-1">
                      {n.title}
                      {href && <span className="text-indigo-400 text-xs" aria-hidden>›</span>}
                    </p>
                    <p className="text-gray-600 text-xs">{n.message}</p>
                    <div className="flex items-center justify-between mt-0.5">
                      <p className="text-gray-400 text-[11px]">{formatDateTime(n.createdAt)}</p>
                      {href && <span className="text-indigo-500 text-[11px] font-medium">View →</span>}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
