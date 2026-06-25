'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useApi } from '@/hooks/useApi'
import { SETUP_TABS } from '@/components/Layout/SetupTabs'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import { UtensilsCrossed, LayoutDashboard, Receipt, Wallet, Landmark, Settings, KeyRound, LogOut, Target, Upload, type LucideIcon } from 'lucide-react'
import { UploadSalesModal } from '@/components/UploadSalesModal'

const ALL = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN', 'WAITER']
const MGMT = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
const CASHIER_ROLES = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

const SECTIONS = ['MyPos', 'Daily', 'Targets', 'Bills & Requests', 'Petty Cash', 'Finance', 'Setup'] as const

const navItems: { href: string; icon: LucideIcon; label: string; section: string; roles: string[]; match?: string[] }[] = [
  { href: '/mypos', icon: UtensilsCrossed, label: 'MyPos', section: 'MyPos', roles: ['WAITER', 'MANAGER', 'ADMIN', 'DIRECTOR'], match: ['/mypos', '/pos', '/schedule'] },

  { href: '/dashboard', icon: LayoutDashboard, label: 'Daily', section: 'Daily', roles: CASHIER_ROLES, match: ['/dashboard', '/collections', '/daily-report', '/excess-loss'] },

  { href: '/targets', icon: Target, label: 'Targets', section: 'Targets', roles: ALL, match: ['/targets'] },

  { href: '/signed-bills', icon: Receipt, label: 'Bills & Requests', section: 'Bills & Requests', roles: CASHIER_ROLES, match: ['/signed-bills', '/paid-bills', '/customer-bills', '/tips-dj-bills', '/cancellations'] },

  { href: '/petty-cash', icon: Wallet, label: 'Petty Cash', section: 'Petty Cash', roles: CASHIER_ROLES, match: ['/petty-cash', '/approvals', '/petty-payments'] },

  { href: '/analytics', icon: Landmark, label: 'Finance', section: 'Finance', roles: MGMT, match: ['/analytics', '/receivables', '/month-end', '/staff-scorecard', '/outlet-comparison', '/peak-hours', '/trends', '/payroll', '/reports', '/audit'] },

  { href: '/setup', icon: Settings, label: 'Setup', section: 'Setup', roles: ALL, match: ['/setup', ...SETUP_TABS.map((t) => t.href)] },
]

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const { request } = useApi()

  const visible = navItems.filter((n) => n.roles.includes(user?.role || ''))

  const [pwOpen, setPwOpen] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwBusy, setPwBusy] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const canUpload = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'].includes(user?.role || '')

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

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-indigo-900 to-indigo-800 text-white w-64">
      <div className="p-6 border-b border-indigo-700">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="w-12 h-12 rounded-xl bg-black flex items-center justify-center mb-2 overflow-hidden">
          <img src="/tips-logo.png" alt="Tips" className="w-full h-full object-contain p-1" />
        </div>
        <h1 className="text-lg font-bold leading-tight">Cashier Manager</h1>
        <p className="text-indigo-300 text-xs mt-1">{user?.outlet?.name || 'All Outlets'}</p>
      </div>

      <div className="px-3 py-2 border-b border-indigo-700">
        <div className="bg-indigo-700/50 rounded-xl p-3">
          <p className="font-semibold text-sm truncate">{user?.name}</p>
          <p className="text-indigo-300 text-xs">{user?.role}</p>
        </div>
      </div>

      <nav className="flex-1 p-3 overflow-y-auto">
        {SECTIONS.map((sec) => {
          const items = visible.filter((i) => i.section === sec)
          if (items.length === 0) return null
          return (
            <div key={sec} className="mb-2">
              <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-indigo-400">{sec}</p>
              <div className="space-y-1">
                {items.map((item) => {
                  const m = item.match
                  const active = m
                    ? m.some((h) => pathname === h || pathname.startsWith(h + '/'))
                    : pathname.startsWith(item.href)
                  const Icon = item.icon
                  return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                'flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all',
                active
                  ? 'bg-white text-indigo-900 shadow-lg'
                  : 'text-indigo-200 hover:bg-indigo-700/60 hover:text-white'
              )}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              <span>{item.label}</span>
            </Link>
                  )
                })}
                {sec === 'Targets' && canUpload && (
                  <button onClick={() => setUploadOpen(true)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-indigo-200 hover:bg-indigo-700/60 hover:text-white transition-all">
                    <Upload className="w-5 h-5 flex-shrink-0" />
                    <span>Upload Sales</span>
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </nav>

      <div className="p-4 border-t border-indigo-700 space-y-1">
        <button
          onClick={() => setPwOpen(true)}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-indigo-200 hover:bg-indigo-700/60 hover:text-white transition-all"
        >
          <KeyRound className="w-5 h-5" />
          <span>Change Password</span>
        </button>
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-indigo-200 hover:bg-red-600 hover:text-white transition-all"
        >
          <LogOut className="w-5 h-5" />
          <span>Sign Out</span>
        </button>
      </div>

      {/* Change Password modal */}
      {pwOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPwOpen(false)}>
          <form onSubmit={changePassword} onClick={(e) => e.stopPropagation()}
            className="bg-white text-gray-800 w-full max-w-sm rounded-2xl shadow-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900">🔑 Change My Password</h3>
              <button type="button" onClick={() => setPwOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
            </div>
            <p className="text-xs text-gray-500">{user?.name} · {user?.role}</p>
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

      <UploadSalesModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  )
}
