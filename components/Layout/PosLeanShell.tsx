'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { GlobalSearch } from './GlobalSearch'
import { PendingBell } from './PendingBell'
import { OfflineQueueBadge } from './OfflineQueueBadge'
import { Search, X, KeyRound, LogOut, LayoutGrid, MoreHorizontal } from 'lucide-react'
import toast from 'react-hot-toast'
import { useApi } from '@/hooks/useApi'

const MYPOS_PREFIXES = ['/pos', '/mypos', '/schedule', '/events']

export interface FabAction {
  label: string
  icon: React.ReactNode
  onClick: () => void
}

/**
 * Lean, no-sidebar chrome for kiosk-style POS screens (Floor Map, Order) —
 * a compact top bar plus a floating action button for secondary actions,
 * so the table grid / order screen gets almost the entire viewport instead
 * of sharing it with AppShell's permanent nav rail.
 */
export function PosLeanShell({
  title, subtitle, onBack, headerRight, actions, children,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  headerRight?: React.ReactNode
  actions?: FabAction[]
  children: React.ReactNode
}) {
  const { user, isLoading, logout } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const { request } = useApi()

  const [searchOpen, setSearchOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [fabOpen, setFabOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwBusy, setPwBusy] = useState(false)

  const profileRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isLoading && !user) {
      const isMyPos = MYPOS_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
      router.push(isMyPos ? '/mypos/staff-login' : '/login')
    }
  }, [user, isLoading, router, pathname])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false)
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) setFabOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pwForm.next.length < 6) return toast.error('New password must be at least 6 characters')
    if (pwForm.next !== pwForm.confirm) return toast.error('New passwords do not match')
    setPwBusy(true)
    try {
      await request('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }) })
      toast.success('Password changed!')
      setPwForm({ current: '', next: '', confirm: '' }); setPwOpen(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error changing password')
    } finally { setPwBusy(false) }
  }

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-indigo-50">
        <div className="text-center">
          <div className="text-5xl mb-3 animate-bounce">🍹</div>
          <p className="text-indigo-600 font-medium animate-pulse">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50">
      {/* Compact top bar */}
      <header className="shrink-0 bg-white border-b border-gray-200 px-3 sm:px-4 py-2.5 flex items-center gap-2 sm:gap-3 relative z-30">
        {onBack && (
          <button onClick={onBack} className="p-2 -ml-1 rounded-lg text-gray-500 hover:bg-gray-100 active:scale-95 transition shrink-0">
            <span className="text-xl leading-none">←</span>
          </button>
        )}

        <button
          onClick={() => router.push('/mypos')}
          className="w-8 h-8 rounded-lg bg-black flex items-center justify-center shrink-0 overflow-hidden"
          title="MyPos home"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tips-logo.png" alt="Tips" className="w-full h-full object-contain p-0.5" />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="font-bold text-gray-900 text-sm sm:text-base leading-tight truncate">{title}</h1>
          {subtitle && <p className="text-[11px] sm:text-xs text-gray-400 leading-tight truncate">{subtitle}</p>}
        </div>

        {headerRight && <div className="shrink-0">{headerRight}</div>}

        {/* Search — inline on larger screens, icon-toggled on small ones */}
        <div className="hidden sm:block w-56 lg:w-72">
          <GlobalSearch />
        </div>
        <button onClick={() => setSearchOpen((s) => !s)} className="sm:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 shrink-0">
          <Search className="w-5 h-5" />
        </button>

        <PendingBell />
        <OfflineQueueBadge />

        {/* Profile menu — houses Change Password / Sign Out / full dashboard,
            keeping the top bar itself down to a handful of icons. */}
        <div ref={profileRef} className="relative shrink-0">
          <button
            onClick={() => setProfileOpen((s) => !s)}
            className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center hover:bg-indigo-200 transition"
          >
            {(user.name || '?').charAt(0).toUpperCase()}
          </button>
          {profileOpen && (
            <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 z-40">
              <div className="px-3 py-2 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-800 truncate">{user.name}</p>
                <p className="text-xs text-gray-400">{user.role}{user.outlet?.name ? ` · ${user.outlet.name}` : ''}</p>
              </div>
              <button onClick={() => { setProfileOpen(false); router.push('/mypos') }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                <LayoutGrid className="w-4 h-4" /> Full dashboard
              </button>
              <button onClick={() => { setProfileOpen(false); setPwOpen(true) }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                <KeyRound className="w-4 h-4" /> Change password
              </button>
              <button onClick={logout} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50">
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Mobile search overlay */}
      {searchOpen && (
        <div className="sm:hidden shrink-0 bg-white border-b border-gray-200 px-3 py-2 flex items-center gap-2 z-30">
          <div className="flex-1"><GlobalSearch /></div>
          <button onClick={() => setSearchOpen(false)} className="p-2 text-gray-400"><X className="w-5 h-5" /></button>
        </div>
      )}

      {/* Page content — gets almost the whole viewport */}
      <main className="flex-1 min-h-0 overflow-hidden relative">
        {children}
      </main>

      {/* Floating action button — page-specific secondary actions, kept out
          of the top bar so it stays down to essentials. */}
      {actions && actions.length > 0 && (
        <div ref={fabRef} className="fixed bottom-5 right-5 z-40">
          {fabOpen && (
            <div className="absolute bottom-16 right-0 bg-white rounded-2xl shadow-xl border border-gray-100 py-1.5 w-52">
              {actions.map((a, i) => (
                <button
                  key={i}
                  onClick={() => { setFabOpen(false); a.onClick() }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {a.icon} {a.label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setFabOpen((s) => !s)}
            className="w-14 h-14 rounded-full bg-indigo-600 text-white shadow-xl flex items-center justify-center hover:bg-indigo-700 active:scale-95 transition"
          >
            {fabOpen ? <X className="w-6 h-6" /> : <MoreHorizontal className="w-6 h-6" />}
          </button>
        </div>
      )}

      {/* Change Password modal */}
      {pwOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPwOpen(false)}>
          <form onSubmit={changePassword} onClick={(e) => e.stopPropagation()}
            className="bg-white text-gray-800 w-full max-w-sm rounded-2xl shadow-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900">🔑 Change My Password</h3>
              <button type="button" onClick={() => setPwOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
            </div>
            <p className="text-xs text-gray-500">{user.name} · {user.role}</p>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Current Password</label>
              <input type="password" value={pwForm.current} onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })}
                className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" required />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">New Password</label>
              <input type="password" value={pwForm.next} onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })}
                className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" required minLength={6} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Confirm New Password</label>
              <input type="password" value={pwForm.confirm} onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
                className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" required minLength={6} />
            </div>
            <button type="submit" disabled={pwBusy}
              className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
              {pwBusy ? 'Saving…' : 'Update Password'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
