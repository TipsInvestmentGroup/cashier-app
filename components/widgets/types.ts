// Widget framework — dashboards are composed from typed WidgetDef config
// arrays instead of hand-written JSX blocks, mirroring the same
// config-array-plus-generic-renderer pattern components/Layout/SectionTabs.tsx
// already uses for nav tabs (Tab.roles / Tab.modeGate). A widget's data comes
// from the page's existing single fetch via a typed accessor function — not
// an independent per-widget query — see WidgetGrid.tsx for the renderer.
import type { LucideIcon } from 'lucide-react'
import type { Tone } from '@/components/ui/StatCard'

export type WidgetRole = string // matches lib/auth.ts's plain-string role convention
export type WidgetCollectionMode = 'DEFAULT' | 'TRANSACTION_VERIFICATION'
export type WidgetInsight = { text: string; status: 'good' | 'bad' | 'neutral' } | null | undefined

interface WidgetBase {
  key: string
  roles: WidgetRole[]
  // Omit entirely for a widget that applies regardless of Collection Mode
  // (see lib/collection-mode.ts) — mirrors Tab.modeGate's opt-in shape.
  collectionModes?: WidgetCollectionMode[]
}

export interface StatWidgetDef<T> extends WidgetBase {
  type: 'stat'
  icon?: LucideIcon
  label: string
  tone?: Tone
  href?: string
  format?: 'currency' | 'raw'
  getValue: (data: T) => number | string
  getSub?: (data: T) => string | undefined
  getInsight?: (data: T) => WidgetInsight
}

// isCount: render the raw number instead of currency-formatting it (e.g. a
// count or a percentage) — suffix appends after it (e.g. '%').
export interface DrillTile { label: string; value: number; isCount?: boolean; suffix?: string }
export interface DrillRecord { id: string; label: string; sub?: string; amount: number; status?: string; isCount?: boolean }

export interface DrillWidgetDef<T> extends WidgetBase {
  type: 'drilldown'
  title: string
  getTiles: (data: T) => DrillTile[]
  getRecords: (data: T) => DrillRecord[]
  // Only show this widget if its backing data is present on the page's
  // response (e.g. AFTER-mode-only fields) — omit to always show.
  isPresent?: (data: T) => boolean
}

export interface TrendDay { date: string; total: number }

// Three-level progressive disclosure (Summary → Daily → Hourly/Staff/Payment)
// — see components/widgets/TrendWidget.tsx. Deliberately a sibling type
// rather than an extension of DrillWidgetDef, which is already shipped and
// consumed by 8 widgets across the dashboards; adding day-level nesting there
// would risk regressing all of them.
export interface TrendWidgetDef<T> extends WidgetBase {
  type: 'trend'
  label: string
  getTotal: (data: T) => number
  getInsight?: (data: T) => WidgetInsight
  getSeries: (data: T) => TrendDay[]
  // Builds the lazily-fetched Level-3 URL for one day row (see
  // app/api/dashboard/day-detail/route.ts).
  dayDetailUrl: (day: TrendDay) => string
}

export type WidgetDef<T> = StatWidgetDef<T> | DrillWidgetDef<T> | TrendWidgetDef<T>
