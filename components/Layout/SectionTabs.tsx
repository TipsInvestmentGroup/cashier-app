'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

export type Tab = { href: string; label: string; icon: string; roles: string[] }

const MGMT = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
const CASHIER_ROLES = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
const POS_ROLES = ['WAITER', 'MANAGER', 'ADMIN']

export const MYPOS_TABS: Tab[] = [
  { href: '/pos', label: 'Waiter App', icon: '🍽', roles: POS_ROLES },
  { href: '/pos/counter', label: 'Counter View', icon: '🖨', roles: POS_ROLES },
  { href: '/pos/manager', label: 'All Orders', icon: '👁', roles: ['MANAGER', 'ADMIN', 'DIRECTOR'] },
  { href: '/pos/manager/items', label: 'Item Blocker', icon: '🚫', roles: ['MANAGER', 'ADMIN'] },
  { href: '/pos/shift-report', label: 'Shift Report', icon: '📊', roles: ['WAITER', 'MANAGER', 'ADMIN', 'DIRECTOR'] },
]

export const DAILY_TABS: Tab[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊', roles: CASHIER_ROLES },
  { href: '/collections', label: 'Daily Collections', icon: '💰', roles: CASHIER_ROLES },
  { href: '/daily-report', label: 'Daily Report', icon: '📑', roles: CASHIER_ROLES },
  { href: '/excess-loss', label: 'Excess & Loss', icon: '🔺', roles: CASHIER_ROLES },
]

// Groups per section, in the order they appear (role-gated per group).
export const FINANCE_TABS: Tab[] = [
  { href: '/receivables', label: 'Receivables', icon: '📈', roles: MGMT },
  { href: '/month-end', label: 'Month-End', icon: '📅', roles: MGMT },
  { href: '/payroll', label: 'Payroll Deductions', icon: '🧾', roles: MGMT },
  { href: '/reports', label: 'Reports', icon: '📄', roles: MGMT },
  { href: '/audit', label: 'Audit Log', icon: '🛡️', roles: MGMT },
]

export const BILLS_TABS: Tab[] = [
  { href: '/signed-bills', label: 'Signed Bills', icon: '📋', roles: CASHIER_ROLES },
  { href: '/paid-bills', label: 'Paid Bills', icon: '✅', roles: CASHIER_ROLES },
  { href: '/customer-bills', label: 'Customer Bills', icon: '👤', roles: CASHIER_ROLES },
  { href: '/tips-dj-bills', label: 'Tips & DJ Bills', icon: '🎁', roles: CASHIER_ROLES },
  { href: '/cancellations', label: 'Cancellations', icon: '🚫', roles: CASHIER_ROLES },
]

export const PETTY_TABS: Tab[] = [
  { href: '/petty-cash', label: 'Petty Cash', icon: '💵', roles: CASHIER_ROLES },
  { href: '/approvals', label: 'Approval Requests', icon: '🗳️', roles: CASHIER_ROLES },
]

/** Horizontal tab bar shown at the top of a section's pages. */
export function SectionTabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname()
  const { user } = useAuth()
  const visible = tabs.filter((t) => t.roles.includes(user?.role || ''))
  // Longest matching href wins so nested routes (e.g. /pos/manager/items) don't
  // also light up their parent (/pos, /pos/manager).
  const matches = (h: string) => pathname === h || pathname.startsWith(h + '/')
  const best = visible.filter((t) => matches(t.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href

  return (
    <div className="mb-5 overflow-x-auto">
      <div className="flex gap-2 min-w-max">
        {visible.map((t) => {
          const active = best === t.href
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
