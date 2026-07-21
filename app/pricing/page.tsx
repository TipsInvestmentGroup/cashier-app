'use client'
import { useState } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useAuth } from '@/contexts/AuthContext'
import { EmptyState } from '@/components/ui/EmptyState'
import { Tag } from 'lucide-react'
import { PriceListsTab } from '@/components/pricing/PriceListsTab'
import { CustomerGroupsTab } from '@/components/pricing/CustomerGroupsTab'
import { PromotionsTab } from '@/components/pricing/PromotionsTab'
import { PricingAnalyticsTab } from '@/components/pricing/PricingAnalyticsTab'

const MGMT = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
type Tab = 'lists' | 'groups' | 'promotions' | 'analytics'

export default function PricingPage() {
  const { user } = useAuth()
  const canView = MGMT.includes(user?.role || '')
  const [tab, setTab] = useState<Tab>('lists')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'lists', label: 'Price Lists' },
    { key: 'groups', label: 'Customer Groups' },
    { key: 'promotions', label: 'Promotions' },
    { key: 'analytics', label: 'Analytics' },
  ]

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Tag className="w-6 h-6 text-indigo-600" /> Price List Engine</h1>
          <p className="text-gray-500 text-sm mt-1">One product, many prices. Configurable priority (Event → Outlet → Customer Group → Default), scheduled prices, promotions, and full price history — used across POS, Sales Import, Finance, Reports & BI.</p>
        </div>

        {!canView ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 mt-5"><EmptyState icon="🔒" title="No access" hint="Pricing management is for management roles." /></div>
        ) : (
          <>
            <div className="flex gap-2 border-b border-gray-200 mt-4 mb-5 overflow-x-auto">
              {tabs.map((t) => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition ${tab === t.key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                  {t.label}
                </button>
              ))}
            </div>
            {tab === 'lists' && <PriceListsTab />}
            {tab === 'groups' && <CustomerGroupsTab />}
            {tab === 'promotions' && <PromotionsTab />}
            {tab === 'analytics' && <PricingAnalyticsTab />}
          </>
        )}
      </div>
    </AppShell>
  )
}
