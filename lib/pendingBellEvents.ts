// Lets any page that approves/rejects a request tell PendingBell to refresh
// its counts immediately, instead of waiting for the 60s poll or window focus.
export const PENDING_COUNTS_CHANGED = 'pending-counts:changed'

export function notifyPendingCountsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PENDING_COUNTS_CHANGED))
}

// Separate event for NotificationBell (Business Day Exception Management) —
// a different audience/data shape than the approvals-only PendingBell above,
// so kept as its own event rather than overloading PENDING_COUNTS_CHANGED.
export const NOTIFICATIONS_CHANGED = 'notifications:changed'

export function notifyNotificationsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED))
}
