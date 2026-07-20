'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useApi } from '@/hooks/useApi'
import {
  LayoutDashboard, Wallet, FileText, TrendingUp, UtensilsCrossed, Printer, ClipboardList,
  Ban, BarChart3, FileSignature, CheckCircle2, User, Gift, ClipboardCheck, CalendarDays,
  Receipt, FileBarChart, ShieldCheck, Building2, Clock, CreditCard, CalendarClock, PartyPopper, Package, Warehouse, Briefcase, ListChecks, Workflow, HandCoins, BookOpen, Landmark, type LucideIcon,
} from 'lucide-react'

// A tab with modeGate is hidden for the roles listed in `forRoles` unless the
// caller's resolved Collection Mode (see lib/collection-mode.ts) equals
// `mode` — e.g. a CASHIER only sees "Daily Collections" OR "Transaction
// Sessions", never both, depending on how their outlet is configured.
// Oversight roles (MANAGER/ACCOUNTANT/DIRECTOR/ADMIN) aren't listed in
// forRoles for these tabs — they aren't locked to one outlet and may
// legitimately need to see either workflow across a mixed-mode business.
export type Tab = { href: string; label: string; icon: LucideIcon; roles: string[]; excludePositions?: string[]; modeGate?: { mode: 'DEFAULT' | 'TRANSACTION_VERIFICATION'; forRoles: string[] } }

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
  { href: '/my-transactions', label: 'My Transactions', icon: HandCoins, roles: POS_ROLES, modeGate: { mode: 'TRANSACTION_VERIFICATION', forRoles: ['WAITER'] } },
  { href: '/schedule', label: 'Scheduling', icon: CalendarClock, roles: ['WAITER', 'MANAGER', 'ADMIN', 'DIRECTOR'] },
  { href: '/events', label: 'Events', icon: PartyPopper, roles: ['MANAGER', 'ADMIN', 'DIRECTOR'] },
  { href: '/pos/shift-report', label: 'Shift Report', icon: BarChart3, roles: ['WAITER', 'MANAGER', 'ADMIN', 'DIRECTOR'] },
  { href: '/pos/reports', label: 'Reports', icon: FileBarChart, roles: ['MANAGER', 'ADMIN', 'DIRECTOR'] },
  { href: '/pos/stock', label: 'Stock', icon: Package, roles: ['MANAGER', 'ADMIN', 'DIRECTOR'] },
  { href: '/pos/main-store', label: 'Main Store', icon: Warehouse, roles: ['MANAGER', 'ADMIN', 'DIRECTOR'] },
  { href: '/pos/purchase-orders', label: 'Purchase Orders', icon: FileText, roles: ['MANAGER', 'ADMIN', 'DIRECTOR'] },
  { href: '/pos/stock-count', label: 'Stock Count', icon: ClipboardCheck, roles: ['MANAGER', 'ADMIN', 'DIRECTOR'] },
  { href: '/pos/breakage', label: 'Breakage', icon: Ban, roles: ['MANAGER', 'ADMIN', 'DIRECTOR'] },
]

export const DAILY_TABS: Tab[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: CASHIER_ROLES },
  { href: '/collections', label: 'Daily Collections', icon: Wallet, roles: CASHIER_ROLES, modeGate: { mode: 'DEFAULT', forRoles: ['CASHIER'] } },
  { href: '/daily-report', label: 'Daily Report', icon: FileText, roles: CASHIER_ROLES },
  { href: '/excess-loss', label: 'Excess & Loss', icon: TrendingUp, roles: CASHIER_ROLES },
  { href: '/excess-recon', label: 'Excess Recon', icon: ListChecks, roles: CASHIER_ROLES },
  { href: '/collection-sessions', label: 'Collection Sessions', icon: Workflow, roles: CASHIER_ROLES },
  { href: '/transaction-sessions', label: 'Transaction Sessions', icon: HandCoins, roles: CASHIER_ROLES, modeGate: { mode: 'TRANSACTION_VERIFICATION', forRoles: ['CASHIER'] } },
  { href: '/collection-approvals', label: 'Collection Approvals', icon: ClipboardCheck, roles: CASHIER_ROLES },
]

export const BILLS_TABS: Tab[] = [
  { href: '/signed-bills', label: 'Signed Bills', icon: FileSignature, roles: CASHIER_ROLES },
  { href: '/admin-director-bills', label: 'Admin & Director Bills', icon: Briefcase, roles: MGMT },
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
  { href: '/admin-director-bills', label: 'Admin & Director Bills', icon: Briefcase, roles: MGMT },
  { href: '/month-end', label: 'Month-End', icon: CalendarDays, roles: MGMT },
  { href: '/staff-scorecard', label: 'Staff Scorecard', icon: BarChart3, roles: MGMT },
  { href: '/outlet-comparison', label: 'Outlet Comparison', icon: Building2, roles: MGMT },
  { href: '/peak-hours', label: 'Peak Hours', icon: Clock, roles: MGMT },
  { href: '/trends', label: 'Trends', icon: TrendingUp, roles: MGMT },
  { href: '/payroll', label: 'Payroll Deductions', icon: Receipt, roles: MGMT },
  { href: '/reports', label: 'Reports', icon: FileBarChart, roles: MGMT },
  { href: '/audit', label: 'Audit Log', icon: ShieldCheck, roles: MGMT },
  { href: '/finance/accounts', label: 'Chart of Accounts', icon: BookOpen, roles: MGMT },
  { href: '/finance/payables', label: 'Accounts Payable', icon: HandCoins, roles: MGMT },
  { href: '/finance/ledger', label: 'General Ledger', icon: Landmark, roles: MGMT },
  { href: '/finance/banking', label: 'Banking', icon: CreditCard, roles: MGMT },
  { href: '/finance/budgets', label: 'Budgets', icon: ClipboardList, roles: MGMT },
  { href: '/finance/reconciliation', label: 'Reconciliation', icon: ListChecks, roles: MGMT },
  { href: '/finance/statements', label: 'Financial Statements', icon: FileBarChart, roles: MGMT },
  { href: '/finance/dashboard', label: 'Finance Dashboard', icon: LayoutDashboard, roles: MGMT },
]

/** Horizontal tab bar shown at the top of a section's pages. */
export function SectionTabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname()
  const { user } = useAuth()
  const { request } = useApi()
  const [mode, setMode] = useState<'DEFAULT' | 'TRANSACTION_VERIFICATION' | 'HYBRID' | null>(null)

  const needsMode = tabs.some((t) => t.modeGate?.forRoles.includes(user?.role || ''))
  useEffect(() => {
    if (!user || !needsMode) return
    request('/api/collection-mode').then((r) => setMode(r?.mode || null)).catch(() => setMode(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, needsMode])

  const visible = tabs.filter((t) => {
    if (!t.roles.includes(user?.role || '')) return false
    if (t.excludePositions?.includes(user?.position || '')) return false
    // HYBRID means both workflows are active for this outlet — it satisfies
    // every modeGate rather than failing them all.
    if (t.modeGate?.forRoles.includes(user?.role || '') && mode !== null && mode !== 'HYBRID' && mode !== t.modeGate.mode) return false
    return true
  })
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
