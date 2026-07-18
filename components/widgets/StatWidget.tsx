import { StatCard } from '@/components/ui/StatCard'
import { formatCurrency } from '@/lib/utils'
import type { StatWidgetDef } from './types'

/** Renders one StatWidgetDef by resolving its accessors over the page's data — thin wrapper over the existing StatCard. */
export function StatWidget<T>({ def, data }: { def: StatWidgetDef<T>; data: T }) {
  const raw = def.getValue(data)
  const value = def.format === 'raw' ? String(raw) : formatCurrency(Number(raw))
  return (
    <StatCard
      icon={def.icon}
      label={def.label}
      value={value}
      sub={def.getSub?.(data)}
      tone={def.tone}
      href={def.href}
      insight={def.getInsight?.(data)}
    />
  )
}
