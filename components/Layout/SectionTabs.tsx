'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

export type Tab = { href: string; label: string; icon: string; roles: string[] }

const MGMT = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
const CASHIER_ROLES = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

// Groups per section, in the order they appear (role-gated per group).
export const FINANCE_TABS: Tab[] = [
  { href: '/receivables', label: 'Receivables', icon: '📈', roles: MGMT },
  { href: '/payroll', label: 'Payroll Deductions', icon: '🧾', roles: MGMT },
  { href: '/reports', label: 'Reports', icon: '📄', roles: MGMT },
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

  return (
    <div className="mb-5 overflow-x-auto">
      <div className="flex gap-2 min-w-max">
        {visible.map((t) => {
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
