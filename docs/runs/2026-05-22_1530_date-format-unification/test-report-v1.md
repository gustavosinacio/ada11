# Test report v1 — 2026-05-22_1530_date-format-unification

Testing: implementation (post r2) against `design-v2.md`.

## Environment

- Dev server: Expo web on `http://localhost:8081` (HTTP 200 pre-flight, already running, PIDs 14308/99526).
- Test runners: Vitest 3.2.4 (unit), Playwright 1.59.1 (e2e, JSON reporter, `workers: 1`, projectless config).
- Wall clock: 2026-05-22 BRT (matches the time-pinning constant used by `dates.test.ts`, `measurements-chart.test.ts`, `progress-page-math.test.ts`, and `format-display-date.test.ts` — `vi.setSystemTime("2026-05-22T12:00:00-03:00")`).
- Test data: same seeded user already populating the running dev server (no reseed required for the planned specs).

## Golden path

**Spec** (from design-v2): `formatDisplayDate` / `formatShortDate` exist in `src/utils/format-display-date.ts`, applied to 12 migration sites; year is appended only when the date is NOT in the current local year (2026). The visible-range pill in `<WeeklyVolumeStrip>` drops the trailing year for single-year windows; the week drill-down body header carries `accessibilityLabel="Week range: ..."` for selector targeting; per-bar a11y labels keep the 4-digit year via `{yearFormat: "numeric"}`. Existing unit assertions that read literal `"5/20"` / `"5/18"` are pinned with fake timers so they stay year-stable.

**Steps run**:

1. `npm run test:unit` — exercises the new helper + every pinned consumer (`dates.test.ts`, `measurements-chart.test.ts`, `progress-page-math.test.ts`).
2. `npm run typecheck` — proves no TS regressions from the migrations.
3. `npm run lint` — proves no new lint regressions.
4. `npx playwright test tests/e2e/week-drill-down.spec.ts` — directly exercises the body-header a11y label selector swap.
5. `npx playwright test tests/e2e/chart-scroll-week-selector.spec.ts` — exercises the visible-range pill format change.
6. Existence + size sanity on `src/utils/format-display-date.ts` (5.2 KB) and `tests/unit/format-display-date.test.ts` (3.8 KB).

**Result**: pass.

**Evidence (unit)**:

```
> vitest run
 ✓ tests/unit/format-display-date.test.ts (15 tests) 18ms
 ✓ tests/unit/measurements-chart.test.ts (7 tests) 18ms
 ✓ tests/unit/dates.test.ts (23 tests) 26ms
 ✓ tests/unit/progress-page-math.test.ts (65 tests) 359ms
 ... 10 other files ...
 Test Files  14 passed (14)
      Tests  229 passed (229)
   Duration  1.47s
```

229/229 across 14 files. Matches the Implementer's stated baseline (214) + 15 new helper tests exactly. The three pinned files (dates, measurements-chart, progress-page-math) all green under the 2026-05-22 BRT fake clock.

**Evidence (typecheck / lint)**:

```
> tsc --noEmit
(no output — 0 errors)

> eslint ...
ESLint: 0 errors, 1 warnings in 1 files
Top files:
  router.d.ts (1 issues)
```

The single warning is in generated `router.d.ts` and is pre-existing (called out in `implementation.md` lines 49 and 100).

**Evidence (e2e — week drill-down, primary touched spec)**:

```
$ PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/wdd_full.json npx playwright test tests/e2e/week-drill-down.spec.ts --reporter=json
$ jq .stats
{
  "startTime": "2026-05-22T20:46:45.143Z",
  "duration": 43368.015999999996,
  "expected": 5,
  "skipped": 0,
  "unexpected": 0,
  "flaky": 0
}

Per-spec:
  golden path: tap current-week bar, headline matches, list renders                → ok=true
  empty week: tap a zero-volume bar lands on empty state                            → ok=true
  deep link to a 12-weeks-ago Monday: lifetime data renders headline correctly      → ok=true
  deep link invalid date: invalid-week copy, no crash                               → ok=true
  back navigation: detail → strip restores History list                             → ok=true
```

5 expected, 0 unexpected. The new `getByLabel(/Week range:/)` selector resolves cleanly on the body-header element wired via `accessibilityLabel={"Week range: " + bodyHeader}` in `app/(app)/history/week/[isoWeek].tsx`. The deep-link scenario also covers a 12-week-old Monday (still in the current year 2026) — the body-header would be the no-year shape, proving the selector does not rely on a year token.

## Edge cases

### Edge 1: visible-range pill format change (single-year window now drops year)

**Steps**: `chart-scroll-week-selector.spec.ts` exercises pill render on default mount, week-selector modal open, modal dismiss. The pill copy now reads `"Apr 27 – Jun 21"` instead of `"Apr 27 – Jun 21, 2026"` for fully in-2026 windows — design-v2 calls this regression out as intentional.

**Expected**: spec still passes; visible-range pill is found by its accessibility role (not by a year-anchored regex).

**Actual**: 3/3 expected, 0 unexpected.

**Result**: pass.

**Evidence**:

```
$ jq .stats /tmp/cssw.json
{
  "startTime": "2026-05-22T20:47:41.019Z",
  "duration": 43884.177,
  "expected": 3,
  "skipped": 0,
  "unexpected": 0,
  "flaky": 0
}

Per-spec:
  default mount: pinned to right edge, current-week visible, pill rendered          → ok=true
  week-selector flow: tap pill → modal opens → confirm scrolls strip                → ok=true
  modal backdrop dismiss: tap outside the card closes it                            → ok=true
```

### Edge 2: time-pinning prevents year drift in existing assertions (MAJ-1 carry, r2)

**Steps**: `tests/unit/dates.test.ts` asserts `IsoWeek.label` matches `/^\d{1,2}\/\d{1,2}$/` (no year). Without the r2 fix, this would fail in 2027+ because `formatShortDate` would append a 2-digit year (e.g. `"5/19/26"`). The r2 patch added `beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-05-22T12:00:00-03:00")); })` so the regex stays valid against the fixture data (also year 2026).

**Expected**: 23 tests in `dates.test.ts` pass under fake timers, no clock-related flakes.

**Actual**: `tests/unit/dates.test.ts (23 tests) 26ms` — all green.

**Result**: pass.

**Evidence**: vitest stdout (cited above) shows the file as `(23 tests)` — unchanged count from the Implementer's report (no test added, only `beforeEach`/`afterEach` scaffolding). 65 tests in `progress-page-math.test.ts` and 7 in `measurements-chart.test.ts` similarly green — confirming the matching scaffolding in those files also composes correctly with the existing nested `beforeEach` (supabase mock setup) per Implementer note line 30.

### Edge 3: invalid-date and zero-volume / empty-week paths (covered by drill-down spec)

**Steps**: `week-drill-down.spec.ts` includes `empty week: tap a zero-volume bar...` and `deep link invalid date: invalid-week copy, no crash`. These exercise the `parseInput` fallback added in `format-display-date.ts` (returns `"—"` for invalid `Date` inputs or ISO slice for invalid string inputs, per design-v2 MIN-2).

**Expected**: invalid-date deep link renders the "invalid week" copy without crashing the navigation; empty-volume bar still routes and shows the empty-state copy.

**Actual**: both specs green (see "Evidence (e2e — week drill-down)" above).

**Result**: pass.

## Regression check

Three adjacent specs run end-to-end:

- **weekly-volume-strip.spec.ts** — exercises the per-bar a11y label path (`formatShortDate(b.start, {yearFormat: "numeric"})`). Spec asserts the existing `"View week of M/D/YYYY"` shape for prior-year bars must remain byte-identical. **4/4 expected, 0 unexpected.**

  ```
  $ jq .stats /tmp/wvs.json
  { "expected": 4, "skipped": 0, "unexpected": 0, "flaky": 0 }

  golden path: strip renders with header, bars, and labels for seeded data         → ok=true
  empty state: brand-new user shows 'No sessions yet' and no strip                  → ok=true
  warmup-only user: strip returns null but sessions list still renders              → ok=true
  refetch path: clearing the persisted TanStack cache + reload yields new total     → ok=true
  ```

- **progress-page.spec.ts** — exercises chart axis labels (now via `formatShortDate`), per-row navigation, PR badge, hero accordion, 5-tab regression. **8/8 expected, 0 unexpected.**

  ```
  $ jq .stats /tmp/pp.json
  { "expected": 8, "skipped": 0, "unexpected": 0, "flaky": 0 }
  ```

- **end-of-session-verdict.spec.ts** — quick sanity that the session-finish flow is untouched by the `formatDateTime` thin-wrapper migration. **2/2 expected, 0 unexpected.**

  ```
  $ jq .stats /tmp/eos.json
  { "expected": 2, "skipped": 0, "unexpected": 0, "flaky": 0 }
  ```

**Aggregate regression**: 14/14 expected, 0 unexpected across 3 adjacent specs.

## Cross-platform

- **Web**: pass — all unit tests + 5 e2e specs run against the Expo web build on `localhost:8081`. Server returned `HTTP 200` on pre-flight probe.
- **iOS**: not tested — pipeline budget is web-only. The platform-relevance argument is weak here: every migrated site renders via `<Text>`/SVG, no platform-specific date API is involved. Manual visual sweep (MIN-1 carry — 4-glyph wider per-bar labels on prior-year bars) deferred to the iPhone shakedown lane per `docs/iphone-shakedown.md`.
- **Android**: not tested — same reason as iOS. No Android-specific path in the migration.

## Test commands

- [x] `npm run typecheck` — 0 errors, no output.
- [x] `npm run lint` — 0 errors, 1 pre-existing warning in generated `router.d.ts`.
- [x] `npm run test:unit` — **229/229 pass across 14 files** in 1.47s.
- [x] `npm run test:e2e` (scoped to 5 relevant specs) — **22/22 pass across 5 specs**, 0 unexpected, 0 skipped, 0 flaky. Run breakdown:
  - `week-drill-down.spec.ts` — 5/5
  - `chart-scroll-week-selector.spec.ts` — 3/3
  - `weekly-volume-strip.spec.ts` — 4/4
  - `progress-page.spec.ts` — 8/8
  - `end-of-session-verdict.spec.ts` — 2/2

## Confidence / Risk

- **Confidence**: ALTA. Every spec the design called out as touched ran green; every regression-risk spec called out by the Implementer ran green. The two specs whose copy actually changed (week-drill-down body header, visible-range pill) both pass against their updated selectors. Time-pinning evidence is direct (dates.test.ts shows 23/23 under the fake clock).
- **Risk**: BAIXO. Pure formatting refactor with central helper. The only behaviour change beyond design (Implementer deviation #1: `formatShortDate` uses `toLocaleDateString("en-US", …)` instead of manual `${month}/${day}`) is covered by the new helper test file's 15 cases and by the 4 pinned regex assertions in `dates.test.ts`. No DB / RLS / migration surface touched.

## Decision

**pass**

Reasoning:

- Golden path covered: 229 unit tests + 22 e2e tests, all green. New helper has its own 15-test file; all 3 files pinned to a fake clock per the design pass under that pinning.
- Two design-mandated copy changes (visible-range pill drops single-year-window year; week drill-down body header gains `Week range:` a11y label) verified live via Playwright against the running web server.
- Three adjacent specs (`weekly-volume-strip`, `progress-page`, `end-of-session-verdict`) run end-to-end with zero regressions.
- Typecheck and lint clean; the one lint warning is pre-existing in generated `router.d.ts` (not introduced by this run).
- Cross-platform native paths intentionally not re-exercised — defer to the iPhone shakedown lane for the MIN-1 visual sweep on prior-year bar labels.
