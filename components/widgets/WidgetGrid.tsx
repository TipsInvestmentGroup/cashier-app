'use client'
import { useState } from 'react'
import { StatWidget } from './StatWidget'
import { DrillWidget } from './DrillWidget'
import { TrendWidget } from './TrendWidget'
import type { WidgetDef, WidgetCollectionMode } from './types'

/**
 * Generic widget renderer — filters a WidgetDef[] by role and (optionally)
 * Collection Mode, then dispatches each surviving def to the matching
 * component by `type`. Mirrors components/Layout/SectionTabs.tsx's
 * config-array-plus-generic-renderer pattern, applied to dashboard cards
 * instead of nav tabs.
 */
export function WidgetGrid<T>({
  defs, data, role, collectionMode, className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4',
}: {
  defs: WidgetDef<T>[]
  data: T
  role: string
  collectionMode?: WidgetCollectionMode | null
  className?: string
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const visible = defs.filter((d) => {
    if (!d.roles.includes(role)) return false
    if (d.collectionModes && collectionMode && !d.collectionModes.includes(collectionMode)) return false
    if (d.type === 'drilldown' && d.isPresent && !d.isPresent(data)) return false
    return true
  })

  if (!visible.length) return null

  return (
    <div className={className}>
      {visible.map((d) => {
        if (d.type === 'stat') return <StatWidget key={d.key} def={d} data={data} />
        if (d.type === 'trend') return <TrendWidget key={d.key} def={d} data={data} />
        return <DrillWidget key={d.key} def={d} data={data} expanded={expanded} setExpanded={setExpanded} />
      })}
    </div>
  )
}
