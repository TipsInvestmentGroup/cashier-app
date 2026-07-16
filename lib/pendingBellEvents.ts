// Lets any page that approves/rejects a request tell PendingBell to refresh
// its counts immediately, instead of waiting for the 60s poll or window focus.
export const PENDING_COUNTS_CHANGED = 'pending-counts:changed'

export function notifyPendingCountsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PENDING_COUNTS_CHANGED))
}
