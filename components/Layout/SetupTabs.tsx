'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

// The Setup groups, in the order they appear. Role-gated per group.
export const SETUP_TABS = [
  { href: '/products', label: 'Products', icon: '📦', roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/departments', label: 'Departments', icon: '🗂️', roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN', 'WAITER'] },
  { href: '/person-categories', label: 'Categories', icon: '🏷️', roles: ['ACCOUNTANT', 'MANAGER', 'ADMIN'] },
  { href: '/payment-channels', label: 'Payment Channels', icon: '💳', roles: ['ADMIN', 'MANAGER', 'DIRECTOR'] },
  { href: '/persons', label: 'Persons', icon: '👥', roles: ['ACCOUNTANT', 'MANAGER', 'ADMIN'] },
  { href: '/outlets', label: 'Outlets', icon: '🏢', roles: ['ADMIN', 'MANAGER', 'DIRECTOR'] },
  { href: '/users', label: 'Users', icon: '⚙️', roles: ['ADMIN'] },
]

/** Horizontal tab bar shown at the top of every Setup page. */
export function SetupTabs() {
  const pathname = usePathname()
  const { user } = useAuth()
  const tabs = SETUP_TABS.filter((t) => t.roles.includes(user?.role || ''))

  return (
    <div className="mb-5 overflow-x-auto">
      <div className="flex gap-2 min-w-max">
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(t.href + '/')
          return (
            <Link key={t.href} href={t.href}
              className={`whitespace-nowrap flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition ${active ? 'bg-indigo-600 text-white shadow' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              <span>{t.icon}</span>{t.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
