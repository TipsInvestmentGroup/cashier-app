'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', icon: '📊', label: 'Dashboard', roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/collections', icon: '💰', label: 'Daily Collections', roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/signed-bills', icon: '📋', label: 'Signed Bills', roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/paid-bills', icon: '✅', label: 'Paid Bills', roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/receivables', icon: '📈', label: 'Receivables', roles: ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/payroll', icon: '🧾', label: 'Payroll Deductions', roles: ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/reports', icon: '📄', label: 'Reports', roles: ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/persons', icon: '👥', label: 'Persons', roles: ['ACCOUNTANT', 'MANAGER', 'ADMIN'] },
  { href: '/users', icon: '⚙️', label: 'Users', roles: ['ADMIN'] },
  { href: '/outlets', icon: '🏢', label: 'Outlets', roles: ['ADMIN', 'MANAGER', 'DIRECTOR'] },
]

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname()
  const { user, logout } = useAuth()

  const visible = navItems.filter((n) => n.roles.includes(user?.role || ''))

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

      <div className="p-4 border-t border-indigo-700">
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-indigo-200 hover:bg-red-600 hover:text-white transition-all"
        >
          <span className="text-xl">🚪</span>
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  )
}
