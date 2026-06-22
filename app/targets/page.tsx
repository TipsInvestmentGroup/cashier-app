'use client'
import { useState } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { Badge } from '@/components/ui/Badge'
import { TARGETS, targetLevels, fmtTarget, type TargetDef } from '@/lib/targets'
import { Target, Wallet, Cigarette, UtensilsCrossed, Building2, User, Crown } from 'lucide-react'

const OUTLETS = ['All', 'Mikocheni', 'Coco'] as const
const deptIcon = (d: string) => (d === 'Shisha Sales' ? Cigarette : d === 'Food Sales' ? UtensilsCrossed : Wallet)
const scopeIcon = (s: string) => (s === 'Per Outlet' ? Building2 : s === 'Per Manager' ? Crown : User)

export default function TargetsPage() {
  const now = new Date()
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly')
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [outlet, setOutlet] = useState<(typeof OUTLETS)[number]>('All')

  const [my, mm] = month.split('-').map(Number)
  const daysInMonth = new Date(my, mm, 0).getDate()

  const visible = TARGETS.filter((t) => outlet === 'All' || t.outlet === outlet)
  const groups = ['Mikocheni', 'Coco'].filter((o) => outlet === 'All' || o === outlet)

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sales Targets</h1>
            <p className="text-gray-500 text-sm">Revenue targets, warning thresholds and reward levels per outlet, role and department</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {period === 'monthly' && (
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
                className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            )}
            <div className="flex gap-2 bg-white border border-gray-200 rounded-xl p-1">
              {(['weekly', 'monthly'] as const).map((p) => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize transition ${period === p ? 'bg-indigo-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100'}`}>{p}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Outlet filter */}
        <div className="flex flex-wrap gap-2">
          {OUTLETS.map((o) => (
            <button key={o} onClick={() => setOutlet(o)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${outlet === o ? 'bg-indigo-600 text-white shadow' : 'bg-white border-2 border-gray-200 text-gray-700 hover:border-gray-300'}`}>{o}</button>
          ))}
        </div>

        {/* Rules explainer */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 text-sm text-indigo-900 flex flex-wrap gap-x-6 gap-y-1">
          <span><strong>Reward considered</strong> at ≥ 80% of target</span>
          <span><strong>Warning letter</strong> issued below ⅓ of target</span>
          <span className="text-indigo-500">{period === 'monthly' ? `Monthly = (Weekly ÷ 7) × ${daysInMonth} days` : 'Weekly = 7 days'} · Reward amount set by management</span>
        </div>

        {groups.map((g) => {
          const items = visible.filter((t) => t.outlet === g)
          if (!items.length) return null
          return (
            <div key={g}>
              <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400 mb-3">{g} Outlet</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {items.map((t, i) => <TargetCard key={i} t={t} period={period} daysInMonth={daysInMonth} />)}
              </div>
            </div>
          )
        })}
      </div>
    </AppShell>
  )
}

function TargetCard({ t, period, daysInMonth }: { t: TargetDef; period: 'weekly' | 'monthly'; daysInMonth: number }) {
  const { target, letterBelow, rewardFrom } = targetLevels(t, period, daysInMonth)
  const DeptIcon = deptIcon(t.department)
  const ScopeIcon = scopeIcon(t.scope)
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <Badge tone={t.department === 'Shisha Sales' ? 'purple' : t.department === 'Food Sales' ? 'amber' : 'indigo'}>{t.department}</Badge>
          <div className="flex items-center gap-1.5 mt-1.5 text-gray-600 text-xs font-medium">
            <ScopeIcon className="w-3.5 h-3.5" /> {t.scope}
          </div>
        </div>
        <span className="w-8 h-8 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center flex-shrink-0"><DeptIcon className="w-4 h-4" /></span>
      </div>

      <p className="text-[11px] text-gray-400">{period === 'weekly' ? 'Weekly' : 'Monthly'} target</p>
      <p className="text-xl font-bold text-indigo-700 tracking-tight leading-tight">{fmtTarget(target, t.unit)}</p>

      <div className="mt-2.5 space-y-1 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-green-700">🎯 Reward ≥</span>
          <span className="font-semibold text-green-700">{fmtTarget(rewardFrom, t.unit)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-red-600">⚠️ Letter &lt;</span>
          <span className="font-semibold text-red-600">{fmtTarget(letterBelow, t.unit)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 pt-1 text-[11px]">
          <span className="text-gray-500">Reward</span>
          <span className="text-gray-400 italic">Set by management</span>
        </div>
      </div>
    </div>
  )
}
