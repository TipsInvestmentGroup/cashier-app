import { format } from 'date-fns'
import type { DrillWidgetDef } from '@/components/widgets/types'
import type { Dashboard } from './page'

// This page has no role branching today — any role that can reach it (see
// components/Layout/SectionTabs.tsx's POS_ROLES for /my-transactions) sees
// these cards unconditionally, so the widget defs list every known role
// rather than restricting visibility.
const ALL_ROLES = ['WAITER', 'CASHIER', 'MANAGER', 'ACCOUNTANT', 'DIRECTOR', 'ADMIN']

export const MY_TRANSACTIONS_DRILL_WIDGETS: DrillWidgetDef<Dashboard>[] = [
  {
    key: 'signed', type: 'drilldown', roles: ALL_ROLES, title: 'Signed Bills',
    isPresent: (d) => !!d.signedBillsAfter,
    getTiles: (d) => {
      const s = d.signedBillsAfter!
      return [
        { label: 'Issued', value: s.issuedCount, isCount: true },
        { label: 'Approved', value: s.approvedCount, isCount: true },
        { label: 'Pending', value: s.pendingCount, isCount: true },
        { label: 'Rejected', value: s.rejectedCount, isCount: true },
        { label: 'Paid', value: s.paidAmount },
        { label: 'Outstanding', value: s.outstandingAmount },
      ]
    },
    getRecords: (d) => d.signedBillsAfter!.records.map((r) => ({
      id: r.id, label: r.personName, sub: r.displayReference || undefined, amount: r.amount, status: r.status,
    })),
  },
  {
    key: 'discounts', type: 'drilldown', roles: ALL_ROLES, title: 'Discounts',
    isPresent: (d) => !!d.discountsAfter,
    getTiles: (d) => {
      const s = d.discountsAfter!
      return [
        { label: 'Issued', value: s.count, isCount: true },
        { label: 'Approved', value: s.approved, isCount: true },
        { label: 'Pending', value: s.pending, isCount: true },
        { label: 'Rejected', value: s.rejected, isCount: true },
      ]
    },
    getRecords: (d) => d.discountsAfter!.records.map((r) => ({
      id: r.id, label: format(new Date(r.createdAt), 'HH:mm'), sub: r.reference || undefined, amount: r.amount, status: r.status,
    })),
  },
  {
    key: 'cancellations', type: 'drilldown', roles: ALL_ROLES, title: 'Cancellations',
    isPresent: (d) => !!d.cancellationsAfter,
    getTiles: (d) => {
      const s = d.cancellationsAfter!
      return [
        { label: 'Requested', value: s.count, isCount: true },
        { label: 'Approved', value: s.approved, isCount: true },
        { label: 'Pending', value: s.pending, isCount: true },
        { label: 'Rejected', value: s.rejected, isCount: true },
      ]
    },
    getRecords: (d) => d.cancellationsAfter!.records.map((r) => ({
      id: r.id, label: format(new Date(r.createdAt), 'HH:mm'), sub: r.reference || undefined, amount: r.amount, status: r.status,
    })),
  },
  {
    key: 'paidbills', type: 'drilldown', roles: ALL_ROLES, title: 'Paid Bills',
    isPresent: (d) => !!d.paidBills,
    getTiles: (d) => {
      const s = d.paidBills!
      return [
        { label: 'Bills Collected', value: s.billsCollectedCount, isCount: true },
        { label: 'Bills Paid', value: s.billsPaidAmount },
        { label: 'Outstanding', value: s.outstandingAmount },
        { label: 'Staff Loss Recovery', value: s.staffLossRecoveryAmount },
      ]
    },
    getRecords: (d) => d.paidBills!.records.map((r) => ({
      id: r.id, label: r.payerName, sub: r.paymentMethod, amount: r.amountPaid,
    })),
  },
]
