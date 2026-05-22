# Test report v2 — 2026-05-22_1130_chart-scroll-week-selector

Round 2 verification of the chart horizontal scroll + week selector feature.
v1 failed on two `tests/e2e/week-drill-down.spec.ts` cases (regex collision and
seed-plan gap). Implementer v2 applied the test-side fixes from the v1 report
recommendation. This v2 run verifies those fixes hold and no NEW regressions
surfaced.

## Environment

- Commands used: `npm run test:unit`, `npm run test:e2e`, plus `npm run web`
  (manually backgrounded after the dev server crashed mid-batch — see Note
  below).
- Browser: Chromium (Playwright default), web.
- Test data: per-test seeded users (E2E specs spin up Supabase auth users +
  sessions via service role).
- Playwright config: `playwright.config.ts` does NOT manage the dev server
  lifecycle (line 1-22). The server must be running on `http://localhost:8081`
  before specs are invoked.

## v2 implementation under test

Per the conductor's brief, Implementer v2 modified ONLY
`tests/e2e/week-drill-down.spec.ts`:

1. **Anchored regex** at lines 234-241: changed
   `/[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}/` to
   `/^[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}$/` (added `^...$`).
   This prevents the regex from collapsing onto the year-bearing pill text
   (`"Apr 13 – May 18, 2026"`) that is rendered by the still-mounted History
   route after navigation.
2. **Extended seed plan** at lines 260-279: changed `[0]` to `[0, 5]` so the
   dynamic-bucket model (`isoWeeksBetween(firstSessionMonday, currentMonday)`)
   produces 6 buckets (offsets 5…0), making the 3-weeks-ago "rest week" bar
   actually exist for the empty-week tap test.

I verified both edits in-source before running the suite (file inspected at
lines 220-320).

## Test commands & results

### 1. Unit suite — `npm run test:unit`

**Result**: 208 passed / 208. No new tests, no failures (matches v1's count).

```
 Test Files  13 passed (13)
      Tests  208 passed (208)
   Duration  1.67s
```

### 2. E2E feature spec — `npm run test:e2e -- tests/e2e/chart-scroll-week-selector.spec.ts`

**Result**: 3/3 passed.

```
Running 3 tests using 1 worker
[screenshot] .../screenshots/scroll-default-mount.png
  ✓  1 default mount: pinned to right edge, current-week visible, pill rendered (19.8s)
[screenshot] .../screenshots/scroll-selector-flow.png
  ✓  2 week-selector flow: tap pill → modal opens → confirm scrolls strip (17.4s)
  ✓  3 modal backdrop dismiss: tap outside the card closes it (10.2s)
  3 passed (48.0s)
```

### 3. E2E regression target — `npm run test:e2e -- tests/e2e/week-drill-down.spec.ts`

**Result**: 5/5 passed. This is the file where v1 had 2 failures.

```
Running 5 tests using 1 worker
[screenshot] .../screenshots/drill-down-golden.png
  ✓  1 golden path: tap current-week bar, headline matches, list renders (12.4s)
[screenshot] .../screenshots/drill-down-empty.png
  ✓  2 empty week: tap a zero-volume bar lands on empty state (11.2s)
[screenshot] .../screenshots/drill-down-historical-week.png
  ✓  3 deep link to a 12-weeks-ago Monday: lifetime data renders headline correctly (11.3s)
[screenshot] .../screenshots/drill-down-invalid.png
  ✓  4 deep link invalid date: invalid-week copy, no crash (9.2s)
  ✓  5 back navigation: detail → strip restores History list (11.4s)
  5 passed (56.2s)
```

Both v1 failures are now green:

- `:160 golden path` — passed in 12.4s. The anchored regex
  `/^MMM d – MMM d$/` only matches the body header (no year), so the strict
  `.toBeVisible()` returns a single element instead of colliding with the pill.
- `:258 empty week` — passed in 11.2s. With the `[0, 5]` seed plan,
  `firstSessionMonday` is 5 weeks back, the strip renders 6 buckets, the
  3-weeks-ago rest-week bar exists, and `View week of <restLabel>` resolves.

### 4. Adjacent regression A — `npm run test:e2e -- tests/e2e/weekly-volume-strip.spec.ts`

**Result**: 4/4 passed (on the second attempt — see Note).

```
Running 4 tests using 1 worker
[screenshot] .../screenshots/golden-strip.png
  ✓  1 golden path: strip renders with header, bars, and labels for seeded data (8.2s)
[screenshot] .../screenshots/empty-state.png
  ✓  2 empty state: brand-new user shows 'No sessions yet' and no strip (4.5s)
[screenshot] .../screenshots/warmup-only.png
  ✓  3 warmup-only user: strip returns null but sessions list still renders (5.6s)
[screenshot] .../screenshots/post-refetch.png
  ✓  4 refetch path: clearing the persisted TanStack cache + reload yields new total (8.1s)
  4 passed (27.0s)
```

**Note (infrastructure flake, not feature)**: The first attempt at this spec
failed on case #4 with `page.reload: net::ERR_CONNECTION_REFUSED`. Investigated:
the Expo dev server (port 8081) had stopped mid-batch — `lsof -ti:8081`
returned nothing. Restarted via `npm run web`, waited for the `/` endpoint to
return 200, and reran. All 4/4 passed deterministically. The crash predates
this run (port already free at first probe) and is unrelated to v2's two
test-file edits.

### 5. Adjacent regression B — `npm run test:e2e -- tests/e2e/progress-page.spec.ts`

**Result**: 7/7 passed.

```
Running 7 tests using 1 worker
  ✓  1 tab visibility — Progress tab renders on the bottom bar (2.5s)
[screenshot] .../screenshots/empty-state.png
  ✓  2 empty user — day-zero empty states render without crashing (4.6s)
[screenshot] .../screenshots/populated.png
  ✓  3 populated user mid-week — hero, bars, list, streak all render (6.1s)
  ✓  4 per-row navigation — tapping a list row routes to /(app)/exercises/{id}/progress (5.8s)
  ✓  5 empty current ISO week with prior history — list shows empty copy, hero/bars still render (5.7s)
  ✓  6 PR badge — a row that beats its lifetime best this week renders the PR pill (5.9s)
  ✓  7 5-tab regression — History, Progress, Profile labels coexist on the bar (2.7s)
  7 passed (33.9s)
```

## Coverage gap (unchanged from v1)

These items remain undisturbed from v1's "not directly tested" set; they are
not blockers for this round but worth carrying into the final summary:

- Lifetime-best overlay y-pin under horizontal scroll — code/review only.
- New-week roll-over re-pin behaviour (MIN-5) — code/review only.
- Pill-driven `Jump` actually shifting `contentOffset.x` — modal opens/closes
  but `scrollTo` is not asserted (review-v1 MIN-4 / implementation.md
  Deviations #3).
- Cold-start latency — not measured.

## Cross-platform

- Web (Chromium / Playwright): pass.
- iOS / Android: not exercised. The v2 diff is test-file only, so no native
  surface is touched.

## Decision

**pass**

Reasoning:

- v1's only two blocking failures (`week-drill-down.spec.ts:160` and `:258`)
  are now green and the fixes match the v1 report's recommended approach.
- Feature spec stays at 3/3.
- Unit suite stays at 208/208.
- Adjacent regressions (`weekly-volume-strip`, `progress-page`) green.
- The `weekly-volume-strip` first-attempt failure was a dev-server crash, not
  a feature regression — confirmed by `lsof` showing port free, deterministic
  green on rerun after restart, and the v2 diff being test-file-only.
- No NEW regressions introduced by v2.

## Recommendation

**finalize**. The chart-scroll + week-selector feature is ready to ship.
Return to Conductor.
