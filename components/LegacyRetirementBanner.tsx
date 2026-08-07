import Link from 'next/link'

// Shown at the top of the retired legacy Petty Cash screens (/petty-cash,
// /approvals, /petty-payments). Those pages are hidden from the Expenses nav
// (Close-the-Day Cash Requests redesign §3) but kept reachable by direct URL
// for admin/debug and old audits — this banner tells anyone who lands on one
// where the live flow moved to, rather than leaving them on a screen that
// silently no longer belongs to the daily workflow.
export function LegacyRetirementBanner() {
  return (
    <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <p className="font-semibold text-amber-900">This page is retired</p>
      <p className="mt-1 text-sm text-amber-800">
        Cash requests and expenses now live in the three-fund Expenses section. Use{' '}
        <Link href="/petty-cash-ledger?fund=CASHIER_CASH" className="font-medium underline hover:text-amber-900">Cashier Ledger</Link>,{' '}
        <Link href="/petty-cash-ledger?fund=PETTY_CASH" className="font-medium underline hover:text-amber-900">Petty Cash Ledger</Link>, or{' '}
        <Link href="/petty-cash-ledger?fund=DIGITAL" className="font-medium underline hover:text-amber-900">Digital Expenses Ledger</Link>{' '}
        instead. To pay out same-day cash requests while closing the day, open{' '}
        <Link href="/close-the-day/cash-requests" className="font-medium underline hover:text-amber-900">Cash Requests</Link>.
      </p>
      <p className="mt-1 text-xs text-amber-700">Kept available for historical records only. Data here is read-only for day-to-day work.</p>
    </div>
  )
}
