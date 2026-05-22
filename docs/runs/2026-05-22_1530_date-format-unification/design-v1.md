# Design v1 — 2026-05-22_1530_date-format-unification

## Goal (1 sentence)

Centralize human-facing date formatting behind two helpers (`formatDisplayDate`, `formatShortDate`) so every screen renders month + day when the date is in the current local year and appends the year only for prior-year dates, eliminating the 8 different ad-hoc formatters discovered.

## Approach

Introduce a single module `src/utils/format-display-date.ts` exporting two `Intl.DateTimeFormat`-based helpers — a long variant for body text / titles / headlines, and a short variant for chart axes and pill labels — both applying the F5 year-conditional rule (`d.getFullYear() !== new Date().getFullYear()` ⇒ append year). Migrate all 11 inventoried sites to the helpers, keeping the weekday prefix on the two row-text + history-detail sites (where the horizontal space is available and "what day of the week did I train" carries signal), and dropping it everywhere else (chart axes, week titles, range pills, best-week label, ISO-week labels). The helpers use device-local time and the device locale via `undefined` — matching the F5 precedent (`session-summary-row.tsx:28`) and the existing `format-session-times.ts` precedent. `date-fns/format` callers either delegate to the helper (and lose the en-US month-name lock) or are removed entirely; locale mixing is the explicit reason for centralisation. The F5 ship in `session-summary-row.tsx` switches from its inline implementation to the helper with identical visible output (`Sat, May 24` / `Fri, Nov 8, 2019`), so this run does not regress the only place that already follows the rule.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/utils/format-display-date.ts` | new | Exports `formatDisplayDate(iso, opts?)` and `formatShortDate(iso)`. Single source of truth for the year-conditional rule. |
| `src/utils/format-display-date.test.ts` | new | Unit tests for both helpers — current year, prior year, includeWeekday, includeTime, Jan 1 boundary, Dec 31 boundary, leap-year Feb 29, invalid input fallback. |
| `src/components/session-summary-row.tsx` | edited | Remove inline `formatDate`. Use `formatDisplayDate(session.started_at, { includeWeekday: true })`. Visible output unchanged from F5 ship. |
| `app/(app)/history/[id].tsx` | edited | Replace direct `formatDateTime(...)` import-and-render where displayed as a header. Use `formatDisplayDate(iso, { includeWeekday: true, includeTime: true })`. (Discovery flagged this as one consumer of `formatDateTime`.) |
| `src/utils/format-session-times.ts` | edited | `formatDateTime` becomes a thin wrapper that calls `formatDisplayDate(iso, { includeWeekday: true, includeTime: true })`, preserving the existing public signature so `<SessionTimesEditor>` and other callers do not change. |
| `src/components/session-times-editor.tsx` | edited | No source change (it imports `formatDateTime` which now delegates). Listed for tracking — the new year-suffix behaviour reaches this screen transitively. |
| `app/(app)/history/week/[isoWeek].tsx` | edited | Replace `format(monday, "MMM d")` (title) and `${format(monday, "MMM d")} – ${format(new Date(sundayMs), "MMM d")}` (body header) with `formatDisplayDate(...)` on each Monday + Sunday. Drop the `format` import if it becomes unused. |
| `app/(app)/exercises/[id]/progress.tsx` | edited | Remove inline `shortDate`. Use `formatShortDate(s.started_at)` for x-axis labels. |
| `src/utils/measurements-chart.ts` | edited | Remove inline `shortDate`. Use `formatShortDate(row.measured_at)` for chart point labels. Remove the comment that flagged the duplication. |
| `src/components/measurement-list-item.tsx` | edited | Replace `format(parseISO(entry.measured_at), "EEE, MMM d, yyyy")` with `formatDisplayDate(entry.measured_at, { includeWeekday: true })`. Drop unused `format`/`parseISO` imports if no longer needed. |
| `app/(app)/measurements/[id]/index.tsx` | edited | Replace `format(parseISO(data.measured_at), "EEE, MMM d, yyyy")` with `formatDisplayDate(data.measured_at, { includeWeekday: true })`. |
| `src/components/weekly-volume-strip.tsx` | edited | (a) `formatVisibleRange`: replace both branches with `formatDisplayDate(startMonday)` + ` – ` + `formatDisplayDate(endMonday)`. Cross-year windows naturally get year on both labels via the helper. Single-year windows lose the trailing year — aligns with the F5 rule. (b) Per-bar accessibility label: replace the inline ternary with `formatShortDate(b.start)` for the year-aware substring. |
| `src/utils/dates.ts` | edited | `IsoWeek.label` is now produced via `formatShortDate(<Monday Date>)` instead of `format(monday, "M/d")`. Touches `lastNIsoWeeks` and `isoWeeksBetween`. JSDoc on `IsoWeek.label` updated to note prior-year suffix. |
| `src/utils/progress-page-math.ts` | edited | `weekKeyToMondayLabel`: replace `format(monday, "M/d")` with `formatShortDate(monday.toISOString())` (or accept a `Date` overload in the helper — see Contratos). Best-week label inherits the year suffix automatically. |
| `tests/e2e/week-drill-down.spec.ts` | edited | Line 239 regex: the body header `"May 18 – May 24"` rule is unchanged for current-year weeks; but the pill regex assumption (`"MMM d – MMM d, yyyy"` always) now becomes `"MMM d – MMM d"` for single-year windows. Update the comment + the anchored regex to discriminate the two new shapes. |

Total: 1 new helper + 1 new test file + 12 edited files. Each edited file has exactly one responsibility: swap its inline formatter for the central helper. `dates.ts` arguably has two (two functions touched), but they both implement the same `IsoWeek.label` contract and must change together.

## Contratos de I/O

### `src/utils/format-display-date.ts`

```ts
/**
 * Optional shape for `formatDisplayDate`. All fields default to `false`.
 *
 * - `includeWeekday`: prepend `"EEE, "` (e.g. `"Sat, "`).
 * - `includeTime`: append `", h:mm a"` time of day (e.g. `", 4:30 PM"`).
 */
export type FormatDisplayDateOptions = {
  includeWeekday?: boolean;
  includeTime?: boolean;
};

/**
 * Long-form display date. Year is appended only when the date is NOT in the
 * current local year.
 *
 * Examples (current year = 2026, device locale en-US):
 *   formatDisplayDate("2026-05-24T10:00:00Z")
 *     → "May 24"
 *   formatDisplayDate("2026-05-24T10:00:00Z", { includeWeekday: true })
 *     → "Sat, May 24"
 *   formatDisplayDate("2019-11-08T10:00:00Z", { includeWeekday: true })
 *     → "Fri, Nov 8, 2019"
 *   formatDisplayDate("2026-05-18T19:30:00Z",
 *                     { includeWeekday: true, includeTime: true })
 *     → "Mon, May 18, 4:30 PM"   // (locale-dependent time formatting)
 *   formatDisplayDate("garbage")
 *     → "garbage"                 // graceful fallback, matches existing
 *
 * Accepts either an ISO 8601 string or a `Date`. Invalid input returns the
 * raw string (or `String(date)` if a `Date`).
 */
export function formatDisplayDate(
  date: string | Date,
  opts?: FormatDisplayDateOptions,
): string;

/**
 * Short-form numeric display date for chart axes / small pills / a11y labels.
 *
 * Examples (current year = 2026):
 *   formatShortDate("2026-05-24T10:00:00Z") → "5/24"
 *   formatShortDate("2019-11-08T10:00:00Z") → "11/8/19"
 *
 * Locale: en-US numeric ordering (M/D) regardless of device locale, because
 * chart axes need stable terse labels that fit under 9-10pt SVG text and
 * the existing two `shortDate` implementations already lock M/D. Year is
 * 2-digit (`19`) to keep prior-year labels narrow.
 */
export function formatShortDate(date: string | Date): string;
```

Implementation notes:
- `formatDisplayDate` builds `Intl.DateTimeFormatOptions` from `opts`, mirroring the F5 shape: `{ month: "short", day: "numeric" }` baseline, conditionally adds `weekday: "short"`, `year: "numeric"`, `hour: "numeric"`, `minute: "2-digit"`. Calls `new Date(date).toLocaleDateString(undefined, opts)` for date-only and `toLocaleString` when `includeTime`. Locale = device.
- `formatShortDate` hard-locks `en-US` for the numeric M/D / M/D/YY shape because (a) chart axes need stable width, (b) the two existing `shortDate` clones already produce M/D regardless of locale, (c) it's an axis label, not body text.
- Both helpers wrap the formatter call in `try/catch` and return the raw input on failure — matching `formatDate` and `formatDateTime` precedents.
- Both helpers re-read `new Date().getFullYear()` per call. This is acceptable for the hot paths (FlatList rows of ≤30 sessions, ≤12 chart points, ≤8 visible bars). No memoisation needed.

### DB columns / queries

No DB changes. All inputs are existing ISO 8601 columns:
- `sessions.started_at` (UTC ISO string)
- `sessions.ended_at` (UTC ISO string, nullable)
- `sets.completed_at` (UTC ISO string)
- `measurement_entries.measured_at` (UTC ISO string)

RLS: unaffected (no query change).

### UI props / state

No new props on existing components. `<SessionSummaryRow>`, `<MeasurementListItem>`, `<WeeklyVolumeStrip>`, `<SessionTimesEditor>` keep their current public surfaces; only their internal formatting source moves to the helper.

### Test fixtures

Unit tests in `format-display-date.test.ts` must NOT call `new Date()` directly. Use `vi.useFakeTimers()` / `vi.setSystemTime(new Date("2026-05-22T12:00:00-03:00"))` so the "current year = 2026" assumption is stable across CI runs. Restore real timers in `afterEach`.

## Riscos

### Data integrity
- **No RLS or migration touch.** Pure formatting.
- **Risk vector**: helper is called with `null`/`undefined` ISO from a query loading state. Mitigation: `try/catch` returns raw input; `String(null)` → `"null"` is ugly but non-crashing. The existing 8 inline formatters all have the same fallback shape, so behaviour parity holds.

### UX regressions
- **F5 ship at `session-summary-row.tsx`**: must produce byte-identical visible strings for current-year and prior-year sessions. Unit test asserts both shapes against the existing F5 output (`"Sat, May 24"` / `"Fri, Nov 8, 2019"`).
- **Visible-range pill**: today renders year on the END of single-year windows (`"Apr 27 – Jun 21, 2026"`). The new rule drops that trailing year for single-year windows (`"Apr 27 – Jun 21"`). This is a real visible change. Mitigation: it aligns with the F5 rule the user just shipped and the prompt's "only month and day" wording. The pill is informational scrolling context, not a header the user reads to know "what year is this". e2e test at `week-drill-down.spec.ts:239` will need its anchor regex updated — already in the file map.
- **Best-week label**: today renders `"Best week: 26,210 kg (5/13)"` — could be 2024, 2025, or 2026. After the change, prior-year best weeks render as `"Best week: 26,210 kg (5/13/24)"`. Slightly wider label; the strip's centered text wrapper handles it.
- **Measurements list + detail**: prior-year entries today render as `"Fri, May 22, 2026"` (always year) — after the change, today's entries render `"Fri, May 22"`. The 2xl bold headline becomes one segment shorter for today's date. Mitigation: visually inspected during Test phase; no layout breakage expected (the headline already wraps a much longer numeric headline below it).

### Platform-specific
- **`Intl.DateTimeFormat` support**: confirmed on RN 0.74+/Hermes (iOS + Android) and all modern web. The project already uses `toLocaleDateString` / `toLocaleString` in F5 with no shim.
- **Device locale variance**: `formatDisplayDate` honours device locale. A pt-BR phone today sees `"mai. 24"` from F5 — same behaviour after centralisation (no regression). A pt-BR phone for prior-year sees `"8 de nov. de 2019"` (or similar), which is the device's locale rule, not ours. This is the same trade-off the F5 ship accepted.
- **`formatShortDate` locks en-US** to keep axis widths stable. Pt-BR users will see `"5/24"` instead of `"24/5"` on chart axes. Trade-off: chart-label width consistency > locale fidelity at axis-tick scale. Documented in the helper's JSDoc.

### Performance
- **Hot paths**: `<SessionSummaryRow>` in a `FlatList` of N sessions (typical N ≤ 50), 1 `Date` + 1 `Intl.DateTimeFormat.format` call per row. Identical to F5's current cost. Negligible.
- **Chart axes**: ≤12 labels per chart, called once per chart render. Negligible.
- **`<WeeklyVolumeStrip>` per-bar a11y label**: called for every bucket on every render. The helper is `O(1)`. Same as today.
- No memoisation needed. If profiling later flags `Intl.DateTimeFormat` constructor cost, a module-level `Map<string, Intl.DateTimeFormat>` keyed by option-hash would be a 3-line follow-up — out of scope.

## Alternativas descartadas

1. **Co-locate the helpers in `src/utils/dates.ts`** — descartada porque `dates.ts` is currently exclusively about ISO-week bucketing math (Monday/Sunday/key derivation). Adding display formatters there mixes two responsibilities and makes the file harder to grep by intent. A dedicated `format-display-date.ts` is grep-able by file name and signals "display string" vs `dates.ts`'s "math".

2. **Standardise on `date-fns/format` instead of `Intl`** — descartada porque (a) `date-fns/format` locks month/weekday names to en-US (no `i18n` bundle wired in this project), regressing devices currently honoured by F5's `Intl` device-locale; (b) the F5 ship is the authoritative precedent and uses `Intl`; (c) `Intl` is zero-dependency and the project already uses it in `format-session-times.ts`. Switching to `date-fns` would also force a per-call hour/minute string assembly for `includeTime`.

3. **A single `formatDisplayDate(date, opts)` with a `short: true` option** — descartada porque the short variant has a fundamentally different locale policy (en-US locked vs device locale) and a different output shape (`5/24` numeric vs `May 24` written). Squeezing them into one function muddies the API contract; two named functions communicate the intent at the call site.

4. **Memoised `Intl.DateTimeFormat` instances at module scope** — descartada (for v1) porque the call volume is too low to justify the complexity. Listed under Performance as a follow-up if real profiling demands it.

5. **Pre-compute current-year-vs-not at the data-layer level (hook returns label + needsYear)** — descartada porque it inverts the architecture (data layer knows about presentation), it doubles the surface area we touch (every hook output adds a sibling field), and the F5 ship already decided "format at render time". Stick with that.

6. **Drop the weekday prefix everywhere (literal reading of "only the month and day")** — descartada porque the Conductor lean keeps weekday on row + detail surfaces (weekly-rhythm signal, fits horizontally) and drops it everywhere else (charts, pills, week titles). This satisfies the user's intent while preserving the F5 shape on the most-viewed surface (History list).

## Out of scope

- **Input formatters** (`session-times-form.ts:decomposeIso`, `measurements-form.ts:formatDateInput`) — produce `YYYY-MM-DD` for `<TextInput>` defaults, not display strings.
- **Opaque storage/URL keys** (`weekKeyOf` → `RRRR-Www`, week URL segments → `yyyy-MM-dd`).
- **Live elapsed timer** in `<SessionHeader>` (`mm:ss` / `h:mm:ss`, no calendar date).
- **Locale plumbing**: this run does not add `i18next` / `react-intl`. `formatShortDate` stays en-US locked; `formatDisplayDate` honours device locale via `Intl` defaults — same trade-off as F5.
- **Relative phrasings** ("today", "yesterday", "last week"). Out of scope per the prompt.
- **`weekKeyOf` / opaque-key reformatting** (`progress-page-math.ts:weekKeyToMondayLabel` keeps its reverse-derivation; only the final formatting step routes through `formatShortDate`).
- **e2e coverage expansion**: only the one already-broken-by-the-change regex is updated. Adding net-new e2e tests for date formatting is out of scope — unit tests cover the formatter exhaustively.
