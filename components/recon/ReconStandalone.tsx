'use client'
import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, RECON_TABS } from '@/components/Layout/SectionTabs'
import { ReconciliationBody } from '@/components/ReconciliationView'
import { CashReconForm } from '@/components/recon/CashReconForm'
import { DigitalReconForm } from '@/components/recon/DigitalReconForm'
import { useAuth } from '@/contexts/AuthContext'
import { useApi } from '@/hooks/useApi'
import { resolveBusinessDateLocal, DEFAULT_BUSINESS_CALENDAR } from '@/lib/business-calendar-shared'

// Standalone, editable reconciliation page — the same CashReconForm/DigitalReconForm
// the Close-the-Day wizard uses, but reachable on its own under the Reconciliation
// section with its own date + outlet pickers (the wizard supplies those from the
// day being closed). The read-only custodian view (ReconciliationBody) is stacked
// below so the entered numbers can be checked against the fund's computed balance
// on the same screen.
type Kind = 'cash' | 'digital'
const MGMT = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

export function ReconStandalone({ kind }: { kind: Kind }) {
  const { user } = useAuth()
  const { request } = useApi()

  // Cashiers are locked to their own outlet server-side; management can pick.
  const isCashier = !MGMT.includes(user?.role || '')
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([])
  const [outletId, setOutletId] = useState<string>(user?.outlet?.id || '')

  // Default to the current *business* day (respects the outlet's cutover time),
  // mirroring how the collections screen resolves "today".
  const [calendarStartTime, setCalendarStartTime] = useState(DEFAULT_BUSINESS_CALENDAR.businessDayStartTime)
  const businessToday = format(resolveBusinessDateLocal(new Date(), calendarStartTime), 'yyyy-MM-dd')
  const [date, setDate] = useState(businessToday)
  const [dateTouched, setDateTouched] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!isCashier) request('/api/outlets').then((o) => setOutlets(o || [])).catch(() => setOutlets([]))
  }, [request, isCashier])

  useEffect(() => {
    request(`/api/business-calendar/snapshot${outletId ? `?outletId=${outletId}` : ''}`)
      .then((s) => { if (s?.config?.businessDayStartTime) setCalendarStartTime(s.config.businessDayStartTime) })
      .catch(() => {})
  }, [request, outletId])

  // Until the user picks a date, keep it tracking the resolved business day.
  useEffect(() => { if (!dateTouched) setDate(businessToday) }, [businessToday, dateTouched])

  const onSaved = useCallback(() => { setReloadKey((k) => k + 1) }, [])

  const isCash = kind === 'cash'
  const title = isCash ? 'Cash Reconciliation' : 'Digital Reconciliation'
  const blurb = isCash
    ? 'Reconcile the cash drawer for a day and outlet, then check it against the fund’s computed balance below.'
    : 'Reconcile each digital channel for a day and outlet, then check it against the linked bank balance below.'

  return (
    <AppShell>
      <SectionTabs tabs={RECON_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-gray-500 text-sm">{blurb}</p>
        </div>

        {/* Day + outlet selectors (outlet is fixed for cashiers). */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs text-gray-500">Business day</span>
            <input type="date" value={date} max={businessToday}
              onChange={(e) => { setDateTouched(true); setDate(e.target.value) }}
              className="w-full mt-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white" />
          </label>
          {!isCashier && (
            <label className="block">
              <span className="text-xs text-gray-500">Outlet</span>
              <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                <option value="">All outlets</option>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          )}
        </div>

        {/* The editable form — same component the wizard renders. */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          {isCash
            ? <CashReconForm key={`${outletId}|${date}|${reloadKey}`} outletId={outletId} date={date} onSaved={onSaved} />
            : <DigitalReconForm key={`${outletId}|${date}|${reloadKey}`} outletId={outletId} date={date} onSaved={onSaved} />}
        </div>

        {/* Read-only custodian view: does the ledger tie out to the computed balance? */}
        <div key={`body-${reloadKey}`}>
          <ReconciliationBody
            fundClass={isCash ? 'CASHIER_CASH' : 'DIGITAL'}
            title="Ledger check"
            blurb="Independent read-only view of this fund’s ledger balance versus its computed position."
          />
        </div>
      </div>
    </AppShell>
  )
}
