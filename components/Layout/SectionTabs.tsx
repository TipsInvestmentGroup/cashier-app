'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import {
  LayoutDashboard, Wallet, FileText, TrendingUp, UtensilsCrossed, Printer, ClipboardList,
  Ban, BarChart3, FileSignature, CheckCircle2, User, Gift, ClipboardCheck, CalendarDays,
  Receipt, FileBarChart, ShieldCheck, Building2, Clock, CreditCard, CalendarClock, PartyPopper, Package, Warehouse, type LucideIcon,
} from 'lucide-react'

export type Tab = { href: string; label: string; icon: LucideIcon; roles: string[]; excludePositions?: string[] }

const MGMT = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
const CASHIER_ROLES = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
const POS_ROLES = ['WAITER', 'MANAGER', 'ADMIN']

// Groups per section, in the order they appear (role-gated per group).
export const MYPOS_TABS: Tab[] = [
  { href: '/pos', label: 'Waiter App', icon: UtensilsCrossed, roles: POS_ROLES },
  // Outside Staff place orders and collect from a counter, but never operate
  // one — they're not authorized to issue/transfer products.
  { href: '/pos/counter', label: 'Counter View', icon: Printer, roles: POS_ROLES, excludePositions: ['OUTSIDE STAFF'] },
  { href: '/pos/manager', label: 'All Orders', icon: ClipboardList, roles: ['MANAGER', 'ADMIN', 'DIRECTOR'] },
  { href: '/pos/manager/items', label: 'Item Blocker', icon: Ban, roles: ['MANAGER', 'ADMIN'] },
  { href: '/schedule', label: 'Scheduling', icon: CalendarClock, roles: ['WAITER', 'MANAGER', 'ADMIN', 'DIRECTOR'] },
  { href: '/events', label: 'Events', icon: PartyPopper, roles: ['MANAGER', 'ADMIN', 'DIRECTOR'] },
  { href: '/pos/shift-report', label: 'Shift Report', icon: BarChart3, roles: ['WAITER', 'MANAGER', 'ADMIN', 'DIRECTOR'] },
  { href: '/pos/reports', label: 'Reports', icon: FileBarChart, roles: ['MANAGER', 'ADMIN', 'DIRECTOR'] },
  { href: '/pos/stock', label: 'Stock', icon: Package, roles: ['MANAGER', 'ADMIN', 'DIRECTOR'] },
  { href: '/pos/main-store', label: 'Main Store', icon: Warehouse, roles: ['MANAGER', 'ADMIN', 'DIRECTOR'] },
]

export const DAILY_TABS: Tab[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: CASHIER_ROLES },
  { href: '/collections', label: 'Daily Collections', icon: Wallet, roles: CASHIER_ROLES },
  { href: '/daily-report', label: 'Daily Report', icon: FileText, roles: CASHIER_ROLES },
  { href: '/excess-loss', label: 'Excess & Loss', icon: TrendingUp, roles: CASHIER_ROLES },
]

export const BILLS_TABS: Tab[] = [
  { href: '/signed-bills', label: 'Signed Bills', icon: FileSignature, roles: CASHIER_ROLES },
  { href: '/paid-bills', label: 'Paid Bills', icon: CheckCircle2, roles: CASHIER_ROLES },
  { href: '/customer-bills', label: 'Customer Bills', icon: User, roles: CASHIER_ROLES },
  { href: '/tips-dj-bills', label: 'Tips & DJ Bills', icon: Gift, roles: CASHIER_ROLES },
  { href: '/cancellations', label: 'Cancellations', icon: Ban, roles: CASHIER_ROLES },
]

export const PETTY_TABS: Tab[] = [
  { href: '/petty-cash', label: 'Petty Cash', icon: Wallet, roles: CASHIER_ROLES },
  { href: '/approvals', label: 'Approval Requests', icon: ClipboardCheck, roles: CASHIER_ROLES },
  { href: '/petty-payments', label: 'Payments', icon: CreditCard, roles: CASHIER_ROLES },
]

export const FINANCE_TABS: Tab[] = [
  { href: '/analytics', label: 'Analytics', icon: LayoutDashboard, roles: MGMT },
  { href: '/receivables', label: 'Receivables', icon: TrendingUp, roles: MGMT },
  { href: '/month-end', label: 'Month-End', icon: CalendarDays, roles: MGMT },
  { href: '/staff-scorecard', label: 'Staff Scorecard', icon: BarChart3, roles: MGMT },
  { href: '/outlet-comparison', label: 'Outlet Comparison', icon: Building2, roles: MGMT },
  { href: '/peak-hours', label: 'Peak Hours', icon: Clock, roles: MGMT },
  { href: '/trends', label: 'Trends', icon: TrendingUp, roles: MGMT },
  { href: '/payroll', label: 'Payroll Deductions', icon: Receipt, roles: MGMT },
  { href: '/reports', label: 'Reports', icon: FileBarChart, roles: MGMT },
  { href: '/audit', label: 'Audit Log', icon: ShieldCheck, roles: MGMT },
]

/** Horizontal tab bar shown at the top of a section's pages. */
export function SectionTabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname()
  const { user } = useAuth()
  const visible = tabs.filter((t) => t.roles.includes(user?.role || '') && !t.excludePositions?.includes(user?.position || ''))
  // Longest matching href wins so nested routes don't also light up their parent.
  const matches = (h: string) => pathname === h || pathname.startsWith(h + '/')
  const best = visible.filter((t) => matches(t.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href

  return (
    <div className="mb-5 overflow-x-auto">
      <div className="flex gap-2 min-w-max">
        {visible.map((t) => {
          const active = best === t.href
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
