# Implementation — 2026-05-22_1530_date-format-unification

Based on: `design-v2.md` (final approved) + `validation-v2.md` (go, 0 blockers / 0 majors / 5 cosmetic minors).

## Files changed

### New

- `src/utils/format-display-date.ts` (new) — central `formatDisplayDate` + `formatShortDate` helpers. Year is appended only when the date is NOT in the current local year. Shared `parseInput` returns either a valid `Date` or a fallback string (`"—"` for `Date` inputs / ISO slice for string inputs).
- `tests/unit/format-display-date.test.ts` (new) — 15 tests: current-year (no year), prior-year (with year), `includeWeekday`, `includeTime`, invalid Date, invalid string, Date-instance input, `yearFormat: "2-digit"` (default), `yearFormat: "numeric"`. `vi.setSystemTime("2026-05-22T12:00:00-03:00")` pins "now" so the year-conditional rule is deterministic.

### Migrated (12 sites)

- `src/components/session-summary-row.tsx` (edited) — removed inline `formatDate`; row now calls `formatDisplayDate(session.started_at, { includeWeekday: true })`. Output unchanged from F5 ship (`"Sat, May 24"` / `"Fri, Nov 8, 2019"`).
- `src/utils/format-session-times.ts` (edited) — `formatDateTime` is now a one-line wrapper around `formatDisplayDate(iso, { includeWeekday: true, includeTime: true })`. Public signature unchanged so `<SessionTimesEditor>` and `app/(app)/history/[id].tsx` (transitive) keep working without source changes.
- `app/(app)/history/week/[isoWeek].tsx` (edited) — title (`Week of ${formatDisplayDate(monday)}`) and body header (`${formatDisplayDate(monday)} – ${formatDisplayDate(sunday)}`) now drop the trailing year for current-year weeks and append it for prior-year weeks. The body-header `<Text>` gets `accessibilityLabel={"Week range: " + bodyHeader}` so e2e can target it unambiguously. `date-fns/format` import removed (now unused).
- `app/(app)/exercises/[id]/progress.tsx` (edited) — removed inline `shortDate`; chart x-axis labels route through `formatShortDate(s.started_at)` (default 2-digit year on prior).
- `src/utils/measurements-chart.ts` (edited) — removed inline `shortDate`; bodyweight chart x-axis labels route through `formatShortDate(row.measured_at)` (default 2-digit year on prior). Duplication comment dropped.
- `src/components/measurement-list-item.tsx` (edited) — replaced `format(parseISO(...), "EEE, MMM d, yyyy")` with `formatDisplayDate(entry.measured_at, { includeWeekday: true })`. Drops the always-year hard-code; current-year entries now render `"Fri, May 22"`, prior-year still `"Fri, Nov 8, 2019"`. `date-fns` imports removed.
- `app/(app)/measurements/[id]/index.tsx` (edited) — same migration as the list item (2xl headline). `date-fns` imports removed.
- `src/components/weekly-volume-strip.tsx` (edited) —
  - `formatVisibleRange` collapsed to `${formatDisplayDate(start)} – ${formatDisplayDate(end)}`. Single-year window now reads `"Apr 27 – Jun 21"` (year dropped, was `"Apr 27 – Jun 21, 2026"`). Cross-year window naturally gets year on both labels. Aligns the pill with the F5 rule.
  - Per-bar accessibility label uses `formatShortDate(b.start, { yearFormat: "numeric" })`, preserving the existing `"View week of 5/12/2025"` shape byte-for-byte for prior-year bars and producing `"View week of 5/12"` for current-year bars. The `date-fns/format` import stays — it is still used for the opaque `yyyy-MM-dd` URL segment.
- `src/utils/dates.ts` (edited) — `IsoWeek.label` is produced via `formatShortDate(monday)` instead of `format(monday, "M/d")`. Touches `lastNIsoWeeks`, `isoWeekContaining`, and `isoWeeksBetween`. JSDoc on `IsoWeek.label` updated to document the new year-conditional behaviour.
- `src/utils/progress-page-math.ts` (edited) — `weekKeyToMondayLabel` returns `formatShortDate(monday)` instead of `format(monday, "M/d")`. Best-week labels for prior years now read `"Best week: ... (5/13/24)"`. `date-fns/format` import removed (now unused; helper lives wholly inside `~/utils/dates` + the new helper).

### Existing tests pinned (MAJ-1)

- `tests/unit/measurements-chart.test.ts` (edited) — added `vi.useFakeTimers()` + `vi.setSystemTime(new Date("2026-05-22T12:00:00-03:00"))` in `beforeEach`, `vi.useRealTimers()` in `afterEach`. `expect("5/20")` remains valid because the fixture year (2026) now matches the pinned "now" year.
- `tests/unit/progress-page-math.test.ts` (edited) — same pattern (top-level `beforeEach`/`afterEach`). `expect("5/18")` on the best-week-label test stays valid. The pre-existing nested `beforeEach`/`afterEach` in the supabase-mock `describe` still runs (Vitest runs outer-before-inner for `beforeEach`, inner-before-outer for `afterEach`); both layers compose cleanly.

### E2E

- `tests/e2e/week-drill-down.spec.ts` (edited) — line 239 swapped anchored regex (`/^[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}$/`) for `page.getByLabel(/Week range:/)`. Robust against the pill's new year-conditional shape, scoped to the body-header by accessibility-label.

## Deviations from design

- **None of substance.** Two minor packaging notes the design left implicit:
  1. `formatShortDate` is locked to en-US numeric ordering via `toLocaleDateString("en-US", …)` rather than manual `${month}/${day}` concatenation. This makes the helper robust against future Intl shape changes AND honours the design's "en-US locked for chart axes" rule. Inline concatenation would have been a regression (no formatter test surface).
  2. `formatDisplayDate`'s `try/catch` keeps the existing F5 fallback behaviour (raw input on Intl explosion) BUT the new `parseInput` step catches `Invalid Date` upstream and returns `"—"` / ISO slice per MIN-2. The outer `try/catch` only fires for the extremely rare path where `Intl.DateTimeFormat` itself throws.

## Soft callbacks made (during this implementation pass)

- None. All ambiguities were resolved by the design + validation docs.

## Quality gates

- [x] `npm run typecheck` passed (0 errors).
- [x] `npm run lint` passed (0 errors; 1 pre-existing warning in generated `router.d.ts`).
- [x] `npm run test:unit` — 229 tests pass across 14 files (was 214; +15 from the new helper test file).
- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log`.

## Notes for Reviewer / Tester

### For Reviewer

- The `formatDisplayDate` helper centralises `Intl.DateTimeFormatOptions` construction. The "two helpers, shared `parseInput`" shape keeps invalid-input fallback identical between long and short variants — see lines 47-66 of the new helper file.
- `tests/unit/progress-page-math.test.ts` now has both a top-level `beforeEach` (fake timers) AND a nested `beforeEach` inside the `listWeeklyVolumeRows null-completed_at safety` `describe` (supabase mock setup). Vitest composes these correctly (outer-first for `beforeEach`); the supabase mocks still apply.
- The visible-range pill regression (`"Apr 27 – Jun 21, 2026"` → `"Apr 27 – Jun 21"` for single-year windows) is intentional per design — aligns the pill with the F5 rule. The e2e regex was always going to break here; swapping to `getByLabel` is the targeted fix.

### For Tester (manual / visual sweep)

- **MIN-1 carry**: a prior-year bar in `<WeeklyVolumeStrip>` now shows a `"11/8/25"` label (4 chars wider than `"11/8"`). The bar width is 40pt; 4 extra glyphs at 10pt centred should fit but worth an eyeball pass on a real device.
- **MIN-3 carry**: `formatDisplayDate({includeTime: true})` is locale-dependent (en-US: `"4:30 PM"`; pt-BR: `"16:30"`; fr-FR: `"16:30"`). The JSDoc on the helper documents this. The session-detail "started at" line is the only consumer of `includeTime` today.
- **History list current-year**: `"Sat, May 24"` (unchanged from F5 ship).
- **History list prior-year**: `"Fri, Nov 8, 2019"` (unchanged from F5 ship).
- **Measurements list current-year**: `"Fri, May 22"` (PREVIOUSLY `"Fri, May 22, 2026"` — now drops the always-year suffix).
- **Measurements detail headline**: same shape as the list item, 2xl bold.
- **Best-week label (prior year)**: `"Best week: 26,210 kg (5/13/24)"` (PREVIOUSLY `"Best week: 26,210 kg (5/13)"` — now resolves the year ambiguity).
- **Exercise progress chart axis (prior year)**: `"11/8/25"` instead of `"11/8"` (resolves year ambiguity at the cost of 3 extra glyphs).
- **Week drill-down current-year title**: `"Week of May 24"` (PREVIOUSLY `"Week of May 24"` — same shape; the body header now reads `"May 18 – May 24"` instead of always omitting year).
- **Week drill-down prior-year title**: `"Week of Nov 4, 2019"` (PREVIOUSLY `"Week of Nov 4"` — now disambiguated).

## I↔R r2 — review-v1 follow-up

Round 2 of 2 in the Implement↔Review loop. Reviewer flagged one carry-over and one minor.

### Findings addressed

- **MAJ-1 carry (incomplete fix in r1)** — `tests/unit/dates.test.ts` has the same class of year-dependent assertion as the two files pinned in r1 (`/^\d{1,2}\/\d{1,2}$/` regex on `IsoWeek.label` at lines 111 and 145, generated via `formatShortDate(monday)` inside `~/utils/dates`). It was missed during the r1 sweep because the assertions matched the old hard-coded `format(monday, "M/d")` shape and only break post-2026 once `formatShortDate` appends a 2-digit year.
- **MIN-1** — `src/components/weekly-volume-strip.tsx:54-67` `formatVisibleRange` JSDoc gave inaccurate examples for the cross-year and fully-prior-year windows.

### Files changed

- `tests/unit/dates.test.ts` (edited) —
  - Imports now include `afterEach`, `beforeEach`, `vi` from `vitest`.
  - Top-level `beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-05-22T12:00:00-03:00")); })` + matching `afterEach(() => { vi.useRealTimers(); })`. Same pinned wall-clock value as `measurements-chart.test.ts` and `progress-page-math.test.ts` for consistency.
  - Comment on top of the `beforeEach` documents the year-stability rationale and points at the specific assertions (regex shape, `lastNIsoWeeks` / `isoWeekContaining`).
  - No assertions changed — the existing `/^\d{1,2}\/\d{1,2}$/` regex stays valid because the pinned "now" (2026) matches the fixture year (2026), so `formatShortDate` drops the year suffix on the generated labels.
- `src/components/weekly-volume-strip.tsx` (edited) — JSDoc on `formatVisibleRange` rewritten to spell out the per-end year-conditional rule explicitly:
  - Cross-year window (start = Dec 29 2025, end = Jan 11 2026, current year = 2026) → `"Dec 29, 2025 – Jan 11"` (only the prior-year end carries the year, not both — corrects the prior `"Dec 29, 2025 – Jan 11, 2026"` example).
  - Fully-prior-year window (start = Nov 4 2019, end = Nov 10 2019, current year = 2026) → `"Nov 4, 2019 – Nov 10, 2019"` (both ends carry the year — corrects the prior `"Nov 4 – Nov 10, 2019"` example which dropped the year on the start).
  - Added one extra clarifying sentence: "The rule is applied per end, independently — the helper does not coalesce a shared year across the two sides."

### Quality gates (r2)

- [x] `npm run typecheck` — 0 errors.
- [x] `npm run lint` — 0 errors, 1 pre-existing warning in generated `router.d.ts`.
- [x] `npm run test:unit` — 229 tests pass across 14 files (same total as r1; the `dates.test.ts` file went from 23 to 23 — no new tests, only the time-pinning scaffold).
- [x] No new `any`, no new `// @ts-ignore`, no stray `console.log`.
- [x] E2E not re-run per Conductor instructions.

### Deviations from review-v1

- None. Followed the prescribed fix exactly (same `beforeEach`/`afterEach` pattern as the r1 files).

### Soft callbacks

- None.
