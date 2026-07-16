// MyPOS floor role labels shown on the Users "MyPos Floor Role" picker and
// the staff PIN tile — informational only (User.position is a free string,
// not validated against this list server-side). The list itself is
// admin-editable (Setting key 'floorPositions', managed on Company
// Preferences) — these are just today's defaults.
//
// lib/shared-constants.ts' POSITION_COUNTERS stays fixed engine logic: it
// locks a staffer to their physical counter(s) by exact position text. A
// company-added position with no entry there simply isn't locked to any
// counter (falls through to seeing every counter) — same as OUTSIDE STAFF
// today. Renaming/removing a position doesn't touch that engine map.
export const DEFAULT_FLOOR_POSITIONS = ['OUTSIDE STAFF', 'BAR LADY', 'VIP BAR', 'SHISHA COUNTER', 'KITCHEN COUNTER']
