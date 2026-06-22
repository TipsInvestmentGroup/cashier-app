import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

type Tone = 'indigo' | 'green' | 'amber' | 'red' | 'purple' | 'blue' | 'pink' | 'gray'

const TONES: Record<Tone, { chip: string; accent: string }> = {
  indigo: { chip: 'bg-indigo-50 text-indigo-600', accent: 'text-indigo-600' },
  green: { chip: 'bg-green-50 text-green-600', accent: 'text-green-600' },
  amber: { chip: 'bg-amber-50 text-amber-600', accent: 'text-amber-600' },
  red: { chip: 'bg-red-50 text-red-600', accent: 'text-red-600' },
  purple: { chip: 'bg-purple-50 text-purple-600', accent: 'text-purple-600' },
  blue: { chip: 'bg-blue-50 text-blue-600', accent: 'text-blue-600' },
  pink: { chip: 'bg-pink-50 text-pink-600', accent: 'text-pink-600' },
  gray: { chip: 'bg-gray-100 text-gray-600', accent: 'text-gray-600' },
}

/**
 * KPI card — clean white surface with a tinted icon chip. When `href` is set the
 * whole card links to the filtered detail (subtle lift + "View" on hover).
 */
export function StatCard({
  icon: Icon, label, value, sub, tone = 'indigo', href,
}: {
  icon?: LucideIcon
  label: string
  value: string
  sub?: string
  tone?: Tone
  href?: string
}) {
  const t = TONES[tone]
  const inner = (
    <div className={cn(
      'group bg-white rounded-2xl border border-gray-100 shadow-sm p-5 h-full transition',
      href && 'hover:shadow-md hover:border-gray-200 hover:-translate-y-0.5'
    )}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {Icon && <span className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', t.chip)}><Icon className="w-5 h-5" /></span>}
      </div>
      <p className="text-2xl font-bold text-gray-900 mt-3 tracking-tight">{value}</p>
      <div className="flex items-center justify-between mt-1 min-h-[16px]">
        {sub ? <p className="text-xs text-gray-400">{sub}</p> : <span />}
        {href && <span className={cn('text-xs font-semibold opacity-0 group-hover:opacity-100 transition', t.accent)}>View →</span>}
      </div>
    </div>
  )
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner
}
