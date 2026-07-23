'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { Package, FolderTree, Tag, Tags, CreditCard, Users, Building2, UserCog, LayoutGrid, Ban, Hash, Settings2, Coins, Workflow, GitBranch, CalendarClock, Landmark, Wallet, Contact, type LucideIcon } from 'lucide-react'

// The Setup groups, in the order they appear. Role-gated per group.
export const SETUP_TABS: { href: string; label: string; icon: LucideIcon; roles: string[] }[] = [
  { href: '/products', label: 'Products', icon: Package, roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
  { href: '/product-categories', label: 'Product Categories', icon: FolderTree, roles: ['ACCOUNTANT', 'MANAGER', 'ADMIN'] },
  { href: '/departments', label: 'Departments', icon: FolderTree, roles: ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN', 'WAITER'] },
  { href: '/person-categories', label: 'Categories', icon: Tag, roles: ['ACCOUNTANT', 'MANAGER', 'ADMIN'] },
  { href: '/payment-channels', label: 'Payment Channels', icon: CreditCard, roles: ['ADMIN', 'MANAGER', 'DIRECTOR'] },
  { href: '/cancellation-reasons', label: 'Cancellation Reasons', icon: Ban, roles: ['ACCOUNTANT', 'MANAGER', 'ADMIN'] },
  { href: '/excess-reasons', label: 'Difference Reasons', icon: Coins, roles: ['ACCOUNTANT', 'MANAGER', 'ADMIN'] },
  { href: '/bill-types', label: 'Bill Types', icon: Tags, roles: ['ADMIN', 'DIRECTOR'] },
  { href: '/bill-reference-settings', label: 'Bill References', icon: Hash, roles: ['ADMIN', 'DIRECTOR'] },
  { href: '/persons', label: 'Persons', icon: Users, roles: ['ACCOUNTANT', 'MANAGER', 'ADMIN'] },
  { href: '/outlets', label: 'Outlets', icon: Building2, roles: ['ADMIN', 'MANAGER', 'DIRECTOR'] },
  { href: '/pos-tables', label: 'Tables', icon: LayoutGrid, roles: ['ADMIN'] },
  { href: '/users', label: 'Users', icon: UserCog, roles: ['ADMIN'] },
  { href: '/company-preferences', label: 'Company', icon: Settings2, roles: ['ADMIN'] },
  { href: '/business-calendar', label: 'Business Calendar', icon: CalendarClock, roles: ['ADMIN'] },
  { href: '/collection-templates', label: 'Collection Templates', icon: Workflow, roles: ['ADMIN'] },
  { href: '/collection-mode-settings', label: 'Collection Mode', icon: GitBranch, roles: ['ADMIN'] },
  { href: '/credit-settings', label: 'Credit Settings', icon: Landmark, roles: ['ADMIN'] },
  { href: '/payroll/settings', label: 'Payroll Settings', icon: Wallet, roles: ['ADMIN'] },
  { href: '/payroll/employees', label: 'Employees', icon: Contact, roles: ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'] },
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
          const Icon = t.icon
          return (
            <Link key={t.href} href={t.href}
              className={`whitespace-nowrap flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition ${active ? 'bg-indigo-600 text-white shadow' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              <Icon className="w-4 h-4" />{t.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
