'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useApi } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'

const navItems = [
  { href: '/dashboard', icon: '📊', label: 'Dashboard', roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/collections', icon: '💰', label: 'Daily Collections', roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/signed-bills', icon: '📋', label: 'Signed Bills', roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/paid-bills', icon: '✅', label: 'Paid Bills', roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/petty-cash', icon: '💵', label: 'Petty Cash', roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/products', icon: '📦', label: 'Products', roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/cancellations', icon: '🚫', label: 'Cancellations', roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/approvals', icon: '🗳️', label: 'Approval Requests', roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/departments', icon: '🗂️', label: 'Departments', roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/receivables', icon: '📈', label: 'Receivables', roles: ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/payroll', icon: '🧾', label: 'Payroll Deductions', roles: ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/reports', icon: '📄', label: 'Reports', roles: ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/persons', icon: '👥', label: 'Persons', roles: ['ACCOUNTANT', 'MANAGER', 'ADMIN'] },
  { href: '/person-categories', icon: '🏷️', label: 'Categories', roles: ['ACCOUNTANT', 'MANAGER', 'ADMIN'] },
  { href: '/users', icon: '⚙️', label: 'Users', roles: ['ADMIN'] },
  { href: '/outlets', icon: '🏢', label: 'Outlets', roles: ['ADMIN', 'MANAGER', 'DIRECTOR'] },
  { href: '/payment-channels', icon: '💳', label: 'Payment Channels', roles: ['ADMIN', 'MANAGER', 'DIRECTOR'] },
]

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const { request } = useApi()

  const visible = navItems.filter((n) => n.roles.includes(user?.role || ''))

  const [pwOpen, setPwOpen] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwBusy, setPwBusy] = useState(false)

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
        <div className="text-3xl mb-1">🍹</div>
        <h1 className="text-lg font-bold leading-tight">Cashier Manager</h1>
        <p className="text-indigo-300 text-xs mt-1">{user?.outlet?.name || 'All Outlets'}</p>
      </div>

      <div className="px-3 py-2 border-b border-indigo-700">
        <div className="bg-indigo-700/50 rounded-xl p-3">
          <p className="font-semibold text-sm truncate">{user?.name}</p>
          <p className="text-indigo-300 text-xs">{user?.role}</p>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {visible.map((item) => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all',
                active
                  ? 'bg-white text-indigo-900 shadow-lg'
                  : 'text-indigo-200 hover:bg-indigo-700/60 hover:text-white'
              )}
            >
              <span className="text-xl">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t border-indigo-700 space-y-1">
        <button
          onClick={() => setPwOpen(true)}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-indigo-200 hover:bg-indigo-700/60 hover:text-white transition-all"
        >
          <span className="text-xl">🔑</span>
          <span>Change Password</span>
        </button>
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-indigo-200 hover:bg-red-600 hover:text-white transition-all"
        >
          <span className="text-xl">🚪</span>
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
    </div>
  )
}
