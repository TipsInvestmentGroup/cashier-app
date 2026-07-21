# Business Calendar Engine — Design

## 1. Problem today

A single global `businessDayCutoverHour` (default `5`) lives in the `companyConfig`
JSON blob (`lib/company-config-shared.ts`) and is applied by
`resolveBusinessDate(now, cutoverHour)` (`lib/business-date.ts`). That's a real
centralized setting already — the gaps are:

- **One value for the whole deployment.** No per-Company or per-Outlet override,
  even though `Company` → `Outlet` hierarchy already exists in the schema.
- **Not every module goes through it.** `lib/bill-reference.ts` has a *second*,
  unrelated function also named `resolveBusinessDate` that ignores the cutover
  entirely (bill numbers get today's date even for a 2am sale that Collections
  treats as yesterday). `lib/daily-summary-email.ts` / `lib/payroll-email.ts`
  call `getCompanyConfig()` only for currency formatting, never for the cutover.
- **No week/financial-year/shift concept.** Only a day cutover exists — nothing
  resolves business week, financial year, active shift, or open/closed status.
- **No temporary overrides, templates, audit trail, or admin UI beyond one
  numeric field on the Company Preferences page.**

## 2. Scope of this pass

Full parity with the request (12 deliverables) is a multi-phase program. This
pass ships the **engine core** — the single source of truth every module can
call today, plus the pieces needed to prove the pattern end-to-end:

**Built now:**
1. Schema: `BusinessCalendarConfig` (scoped GLOBAL → COMPANY → OUTLET, same
   resolver shape as `CollectionModeConfig`), `BusinessCalendarOverride`
   (temporary date-ranged overrides, auto-expiring by date), `ShiftTemplate`
   (unlimited named shifts per scope), `BusinessCalendarAuditLog`.
2. Engine (`lib/business-calendar.ts`): resolves business date, business
   week, financial year, active shift, and open/closed status, using the
   Company → Outlet → Override hierarchy. Falls back to today's exact
   behavior (5am cutover, no week/FY logic) when nothing is configured, so
   zero-config deployments are unaffected.
3. Business Hour Templates (Retail/Restaurant/Bar/Hotel-24h/Office/Custom) as
   engine-side presets an admin picks from, still fully editable after.
4. Settings UI at `/business-calendar`: scope picker, template picker, live
   preview of current business date/week/FY/shift/status, edit form, audit
   trail.
5. Fixed the two real bugs found in the audit: `bill-reference.ts`'s
   shadow function and `daily-summary-email.ts` now resolve through the
   engine instead of raw clock time.
6. Collections routes (`/api/collections`, `/api/collections/day-status`,
   `/api/collections/close-day`, `/api/collection-sessions`) now resolve
   business date via the engine (outlet-scoped) instead of the flat
   `getCompanyConfig().businessDayCutoverHour`.

**Deferred (tracked, not built this pass):** full Impact Analysis simulation
(estimating affected record counts pre-save), role-permission matrix for who
may edit calendar config, and rewiring Scheduling/Payroll/Attendance-adjacent
reports — those modules don't currently key anything off calendar day in a way
that breaks silently, unlike the two fixed sites. Wiring them is mechanical
once the engine exists; each is a follow-up call to `resolveBusinessDate`.

## 3. Data model

```
BusinessCalendarConfig
  id, scope (GLOBAL|COMPANY|OUTLET), scopeId (null for GLOBAL)
  templateName (RETAIL|RESTAURANT|BAR|HOTEL_24H|MANUFACTURING|OFFICE|CUSTOM)
  businessDayStartTime  "HH:mm"   -- day rolls over at this clock time
  businessDayEndTime    "HH:mm"   -- informational: end of the trading window
                                     (spans midnight when end < start)
  timeZone              IANA name, e.g. "Africa/Dar_es_Salaam"
  weekStartDay          0-6 (0=Sunday)
  fyStartMonth          1-12
  fyStartDay            1-31
  createdAt, updatedAt
  @@unique([scope, scopeId])

BusinessCalendarOverride
  id, scope, scopeId
  startDate, endDate           -- inclusive date range; auto-expires past endDate
  businessDayStartTime?, businessDayEndTime?  -- only the fields being overridden
  reason
  createdBy, createdAt

ShiftTemplate
  id, scope, scopeId
  name, startTime "HH:mm", endTime "HH:mm", sortOrder, isActive

BusinessCalendarAuditLog
  id, scope, scopeId, field, previousValue, newValue, reason?
  userId?, userName?, createdAt
```

`scope`/`scopeId` mirrors `CollectionModeConfig` exactly (a Company.id or
Outlet.id, resolved narrowest-to-widest) — same reason: SQLite has no partial
unique index, so GLOBAL rows (`scopeId = null`) are looked up with `findFirst`
rather than relying on the unique constraint.

## 4. Resolution order (narrowest wins)

For a given `(outletId, date)`:

1. Active `BusinessCalendarOverride` for OUTLET, if `date` falls in its range.
2. Active `BusinessCalendarOverride` for the outlet's COMPANY.
3. `BusinessCalendarConfig` at OUTLET scope.
4. `BusinessCalendarConfig` at the outlet's COMPANY scope.
5. `BusinessCalendarConfig` at GLOBAL scope.
6. Hardcoded default (`09:00`–`05:00`... today's real default is cutover-only:
   start `05:00`, no explicit end, `Africa/Dar_es_Salaam`, week starts Monday,
   FY = calendar year) — identical to current behavior when unconfigured.

Same order for `ShiftTemplate` lookups (by scope), independent of the day
cutover — shifts subdivide a business day, they don't define it.

## 5. Engine API (`lib/business-calendar.ts`)

```ts
resolveEffectiveConfig({ outletId?, date }): Promise<EffectiveBusinessCalendar>
resolveBusinessDate(now, config): Date
getBusinessWeek(date, weekStartDay): { weekStart, weekEnd, weekNumber }
getFinancialYear(date, fyStartMonth, fyStartDay): { fyStart, fyEnd, label }
getActiveShift(now, shiftTemplates): ShiftTemplate | null
getBusinessStatus(now, config): { isOpen, nextBusinessDayStart }
setBusinessCalendarConfig(scope, scopeId, patch, { userId, reason }): writes + audit row
```

`resolveBusinessDate(now, cutoverHour: number)` in `lib/business-date.ts` is
kept as a thin wrapper (`resolveBusinessDate(now, effectiveConfig.cutoverHour)`)
so the handful of already-correct call sites don't need to change their
import, only their argument source (cutoverHour now comes from the engine's
resolved config instead of the flat company config).

## 6. Validation rules

- `businessDayStartTime` and `businessDayEndTime` must be distinct `HH:mm`.
- Business day span (accounting for midnight wrap) must be ≥ 1 hour.
- `weekStartDay` ∈ [0,6]; `fyStartMonth` ∈ [1,12]; `fyStartDay` valid for that month.
- `ShiftTemplate` rows for the same scope must not overlap.
- `BusinessCalendarOverride.endDate >= startDate`.

## 7. Audit + permissions

Every write to `BusinessCalendarConfig` or `ShiftTemplate` writes a
`BusinessCalendarAuditLog` row (previous value, new value, reason, user,
timestamp) in the same transaction. Editing is gated the same way other
Setup pages in this app are — behind whatever role check wraps `/setup`
today; a dedicated permission (`CAN_EDIT_BUSINESS_CALENDAR`) is a follow-up
once a real role-permission table exists (there isn't one yet — roles are
currently a flat string on `User`).

## 8. Migration plan

1. Ship schema + engine with defaults that exactly reproduce current
   behavior — no visible change on deploy.
2. Backfill one GLOBAL `BusinessCalendarConfig` row from the existing
   `companyConfig.businessDayCutoverHour` so the settings page shows real
   data instead of the hardcoded default.
3. Point the two broken call sites and the Collections routes at the engine.
4. Leave `company-preferences` page's cutover field in place but mark it
   deprecated in favor of `/business-calendar`; remove once confirmed unused.
5. Later phases wire Scheduling/Payroll/Attendance reports through the same
   engine as those modules grow real per-outlet needs.

## 9. Test scenarios

- Zero-config deployment ⇒ engine returns today's exact 5am-cutover date, byte-identical to `lib/business-date.ts`'s old output.
- Outlet override present + within date range ⇒ wins over company/global config.
- Expired override (past `endDate`) ⇒ ignored, falls through to next level.
- Sale at 02:00 with start time `09:00` ⇒ business date = yesterday.
- Sale at 02:00 with start time `00:00` (24h template) ⇒ business date = today.
- Bill reference generated at 02:00 now matches the Collections business date for the same sale.
- Week/FY boundaries: date exactly on `weekStartDay` / `fyStartDay` falls into the *new* period, not the old one.
- Audit log gets exactly one row per field changed, with correct previous/new values.

## 10. Period cycles (Business Month / Financial Month / Payroll / Credit)

The day/week/FY engine above answers *"which day/week/year does this moment
belong to"*. This layer answers *"which **monthly period** does it belong to"*
for the four cycles a business runs on, each configurable and independent:

| Cycle | Drives |
|-------|--------|
| **Business Month** | Operational, sales, inventory, stock-valuation, KPI & BI reports |
| **Financial Month** | GL, trial balance, P&L, balance sheet, cash flow, journals (FY start stays on `BusinessCalendarConfig`) |
| **Payroll Period** | Attendance, overtime, leave, advances, loans, allowances, bonuses, statutory deductions, final pay |
| **Credit Cycle** | Employee/director/customer credit, signed bills, limits, outstanding balances, aging |

### 10.1 Start-day-only model (no overlaps, no gaps)

Each cycle is defined by a single **start day of month** (1–31). The end day is
*always derived* as the day before the next cycle's start, so overlaps and gaps
are structurally impossible — validation requirement #7 is satisfied by the data
model itself, not by runtime overlap checks. A start day `1` yields plain
calendar months. Days above 28 are **clamped** to each month's real last day
(31 ⇒ 28/29 in February), handling 28/29/30/31-day months automatically.

Naming follows the operational convention — a period is named for the month it
*ends* in (`25 Jun → 24 Jul` is "Jul 2026"), which reduces to the natural month
name when start day is 1.

Payroll settlement events (**lock / processing / salary payment**) are days of
the month resolved in the **settlement month = the calendar month after the
period's start month**. So a `25 Jun → 24 Jul` period with processing=25,
payment=28 gives processing 25 Jul, payment 28 Jul. Credit **reset day** defaults
to the next cycle start; **grace days** extend the due window past the cycle end.

### 10.2 Effective-dated versioning (historical accuracy)

Unlike `BusinessCalendarConfig` (one row per scope), period cycles are
**versioned**: `BusinessPeriodVersion` stores one row per `(scope, scopeId,
effectiveDate)`. Resolving the cycles for a date picks, per scope, the newest
version with `effectiveDate <= date`; the narrowest scope that has *any* such
version wins (OUTLET → COMPANY → GLOBAL → hardcoded default of start day 1
everywhere). A brand-new outlet version effective 1 Mar therefore does **not**
retro-apply to February — February resolves through whatever was in force then.
Re-running an old month's report always reproduces its original grouping
(requirement #6). Zero versions anywhere ⇒ calendar months ⇒ behaviour identical
to before this layer existed.

### 10.3 Code

- `lib/business-periods-shared.ts` — pure, dependency-free date math + validation
  (`monthlyPeriodForDate`, `nextMonthlyPeriod`, `generateMonthlyPeriods`,
  `payrollPeriodForDate`, `creditCycleForDate`, `clampDayToMonth`). Imported by
  both the API and the client preview so the UI shows exactly what the server
  will compute.
- `lib/business-periods.ts` — server resolver (`resolveEffectivePeriodFields`),
  `saveBusinessPeriodVersion` (writes one `BusinessCalendarAuditLog` row per
  changed field vs. the previously-effective version), `getBusinessMonthRange`
  (the single helper a report route calls to group a date), and
  `getBusinessPeriodSnapshot`.
- API: `GET/PUT/DELETE /api/business-calendar/periods`,
  `GET /api/business-calendar/periods/snapshot?outletId=&at=`.
- UI: `components/BusinessCalendar/PeriodSettings.tsx`, embedded in
  `/business-calendar` — scope picker, effective-date, presets, per-cycle fields
  with live previews and auto-generated upcoming months, plus version history.

### 10.4 Deferred (config built now, consumers wired later)

Report/BI rewiring to call `getBusinessMonthRange` instead of
`date-fns`'s `startOfMonth/endOfMonth` (`lib/dateRange.ts`) is mechanical and
per-report; done as each report is touched. Payroll and Credit **modules do not
exist yet** — their period configs are built ahead of them per the HR-system
blueprint, ready to consume when those modules land. The existing
`/api/finance/periods` (accounting open/close periods) is a natural downstream
consumer of Financial Month and can be fed from `getBusinessMonthRange` later.
An authorized per-report period override (requirement #8) rides on the existing
range-picker pattern.

### 10.5 Test scenarios (all verified end-to-end)

- Zero versions ⇒ start day 1 everywhere ⇒ calendar months (`1 Jul → 31 Jul`).
- Start day 25 ⇒ business month `25 Jun 2026 → 24 Jul 2026`, named "Jul 2026".
- Payroll start 25 / lock 24 / processing 25 / payment 28 ⇒ settlement dates land
  24 / 25 / 28 Jul for the Jun–Jul period.
- Credit start 25, reset 25, grace 5 ⇒ reset 25 Jul, grace ends 29 Jul.
- Version effective 2026-01-01: a `?at=2025-06-15` snapshot falls back to calendar
  months (pre-effective); `?at=2026-03-10` uses the 25th cycle.
- Start day 31 in February ⇒ clamps to 28 (or 29 in a leap year).
