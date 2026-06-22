import Link from 'next/link'
import { cn } from '@/lib/utils'

// KPI card. When `href` is set the whole card becomes a link to the filtered
// detail page (with a subtle hover + arrow affordance).
export function StatCard({
  icon, label, value, sub, color = 'bg-white border border-gray-100 text-gray-900', href,
}: {
  icon: string
  label: string
  value: string
  sub?: string
  color?: string
  href?: string
}) {
  const onDark = color.includes('text-white')
  const inner = (
    <div className={cn('rounded-2xl p-5 shadow-sm h-full transition', color, href && 'hover:shadow-md hover:-translate-y-0.5')}>
      <div className="flex items-start justify-between">
        <div>
          <p className={cn('text-sm font-medium', onDark ? 'opacity-80' : 'text-gray-500')}>{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {sub && <p className={cn('text-xs mt-1', onDark ? 'opacity-70' : 'text-gray-400')}>{sub}</p>}
        </div>
        <span className="text-3xl">{icon}</span>
      </div>
      {href && <p className={cn('text-xs mt-3 font-medium', onDark ? 'opacity-80' : 'text-indigo-600')}>View details →</p>}
    </div>
  )
  return href ? <Link href={href} className="block">{inner}</Link> : inner
}
