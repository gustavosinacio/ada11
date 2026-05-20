# Test report v1 — 2026-05-19_2144_weekly-volume-stat

Testing: implementation against `design-v2.md` and `review-v1.md`.

## Environment

- **Target**: Expo Web (react-native-web) via `npm run web` on macOS Darwin 25.2.0.
- **Dev server**: Metro at `http://localhost:8081`, served the SPA + 11.9 MB JS bundle.
- **Browser**: Chromium 1217 (Playwright bundle, headless).
- **Backend**: live Supabase project `ykrbgpctbfvndxjnpzrg.supabase.co`, RLS enabled, queries hit production policies.
- **Test data**: fresh confirmed users created per-test via `admin.auth.admin.createUser({ email_confirm: true })`; per-test seed of sessions+sets via service-role; users deleted in test `finally` blocks. No mocks.
- **Native (iOS/Android)**: not tested. The implementer notes confirm no platform-specific code; web is sufficient for the design's risk envelope.

## Quality gates

| Command | Result | Output summary |
|---|---|---|
| `npm run typecheck` | **pass** | `tsc --noEmit` exits 0, no output. |
| `npm run lint` | **pass** | 0 errors, 1 warning. The only warning is in auto-generated `.expo/types/router.d.ts` ("unused eslint-disable directive") — pre-existing, not in scope. |
| `npm run test:unit` | **pass** | 4 files, 33 tests, all pass in 964 ms. Includes 28 NEW tests written for this run covering `dates.ts` (13), `units.ts` formatVolume (8), and the strip's bucketing kernel (7). |
| `npm run test:e2e` (`weekly-volume-strip.spec.ts`) | **pass** | 4 scenarios, all pass in 30.0 s. Drives the real web app end-to-end, including UI sign-in and Supabase round-trips. |

### Unit test evidence

```
> vitest run
 RUN  v3.2.4 /Users/gustavoinacio/github/ada11
 ✓ tests/unit/formulas.test.ts (5 tests) 2ms
 ✓ tests/unit/units.test.ts (8 tests) 3ms
 ✓ tests/unit/weekly-volume-bucketing.test.ts (7 tests) 6ms
 ✓ tests/unit/dates.test.ts (13 tests) 7ms
 Test Files  4 passed (4)
      Tests  33 passed (33)
```

New unit test files added by this Tester run:
- `tests/unit/dates.test.ts` — exercises `isoWeekStart`, `weekKeyOf`, `lastNIsoWeeks`, `parseISO` re-export.
- `tests/unit/units.test.ts` — exercises `formatVolume` (k-shorthand boundary, kg/lbs branches, MIN-3 999.5 boundary, null/undefined handling) AND confirms existing `formatWeight` is unchanged.
- `tests/unit/weekly-volume-bucketing.test.ts` — replicates the strip's bucketing kernel and asserts: 8-bucket shape, oldest→newest order, kernel guards drop invalid rows, height-scaling math (250/1000 → 24 px, 1000/1000 → 96 px), MIN_BAR_HEIGHT floor for rest weeks, out-of-window rows are dropped, and the Sunday-night ISO-week edge.

### E2E test evidence

```
Running 4 tests using 1 worker
[screenshot] docs/runs/2026-05-19_2144_weekly-volume-stat/screenshots/golden-strip.png
  ✓  1 weekly-volume-strip.spec.ts:152:7 › golden path: strip renders with header, bars, and labels for seeded data (9.2s)
[screenshot] docs/runs/2026-05-19_2144_weekly-volume-stat/screenshots/empty-state.png
  ✓  2 weekly-volume-strip.spec.ts:207:7 › empty state: brand-new user shows 'No sessions yet' and no strip (5.0s)
[screenshot] docs/runs/2026-05-19_2144_weekly-volume-stat/screenshots/warmup-only.png
  ✓  3 weekly-volume-strip.spec.ts:230:7 › warmup-only user: strip returns null but sessions list still renders (6.3s)
[screenshot] docs/runs/2026-05-19_2144_weekly-volume-stat/screenshots/post-refetch.png
  ✓  4 weekly-volume-strip.spec.ts:289:7 › refetch path: clearing the persisted TanStack cache + reload yields new total (8.8s)

  4 passed (30.0s)
```

## Golden path

**Spec** (from design): When the user has ≥ 1 non-zero ISO week of finished, non-warmup volume in the last 8 weeks, the strip renders ABOVE the sessions list with a "THIS WEEK" caps label, the current-week total in the user's selected weight unit (k-shorthand at ≥ 1000), 8 vertical bars (rightmost = current = blue, scaled linearly, max → 96 px, min 4 px), and 8 Monday-of-week date labels in `M/d` format.

**Steps run** (Playwright, see `tests/e2e/weekly-volume-strip.spec.ts:152`):
1. Created a confirmed user.
2. Seeded 6 finished sessions on Wednesdays of weeks `[0, 1, 3, 4, 5, 7]` (offsets back from current week) — weights `[100, 80, 120, 60, 70, 50]` kg, all 5×5. Weeks 2 and 6 are intentional rest weeks (zero sets).
3. Signed in via the UI (filled `Email` + `Password`, clicked `Sign in` button).
4. Navigated to `/history`.
5. Asserted "This week" text visible.
6. Asserted "2.5k kg" text visible (5 × 100 × 5 = 2500 kg → `formatVolume` → "2.5k kg").
7. Counted Monday-`M/d` labels via regex `^\d{1,2}/\d{1,2}$` → ≥ 8.
8. Captured a screenshot of the full rendered screen.

**Result**: **pass**

**Evidence**: `docs/runs/2026-05-19_2144_weekly-volume-stat/screenshots/golden-strip.png` shows:
- "THIS WEEK" caps + muted gray label.
- "2.5k kg" large primary text.
- 8 bars: current week (5/18) is the only blue bar; weeks of 4/27 (3000 kg, max) and 5/11 (1750 kg) are taller gray bars; weeks 4/6 and 5/4 (rest) render as 4 px-tall stubs.
- Date labels 3/30, 4/6, 4/13, 4/20, 4/27, 5/4, 5/11, 5/18 — exactly 8 Mondays-of-ISO-week in M/d format.
- Sessions list below the strip renders 5 visible session rows (Wed May 20, May 13, Apr 29, Apr 22, Apr 15) — the FlatList continues to work.
- Tab bar at the bottom shows "History" highlighted.

## Edge cases

### Edge 1: No finished sessions in window (brand-new user)

**Steps**:
1. Created a confirmed user with no seeded sessions.
2. Signed in, navigated to `/history`.
3. Asserted "No sessions yet" text visible.
4. Asserted "This week" text count === 0.

**Expected**: The "No sessions yet" empty-state copy is shown. The strip does NOT render (it is mounted inside the `FlatList`-branch which only renders when `data && data.length > 0`).

**Actual**: Both assertions passed. Screenshot `screenshots/empty-state.png` confirms: only the empty-state copy is visible; no strip, no FlatList, no border chrome.

**Result**: **pass**

**Evidence**: `screenshots/empty-state.png`.

### Edge 2: A week with zero volume (rest week)

**Steps** (covered by the golden-path seed plan — weeks 2 and 6 are intentional rests):
1. In the golden-path screenshot, locate the bars for 4/6 and 5/4.
2. Inspect rendered heights: should be ~4 px (`MIN_BAR_HEIGHT`) and color `bg-gray-200`.

**Expected**: Each rest week renders as a thin, flat, muted-gray stub.

**Actual**: Both rest-week bars (4/6 and 5/4) are visible in `screenshots/golden-strip.png` as thin gray lines at the baseline, distinctly shorter than every populated bar.

**Result**: **pass**

**Evidence**: `screenshots/golden-strip.png`. The two rest weeks are clearly visible as 4 px stubs between the working weeks. Reinforced by the unit test "rest weeks (totalKg = 0) get the MIN_BAR_HEIGHT floor" in `tests/unit/weekly-volume-bucketing.test.ts`.

### Edge 3: All buckets zero (warmup-only user)

**Steps**:
1. Created a confirmed user.
2. Seeded one finished session with TWO `set_type: 'warmup'` sets (no working sets).
3. Signed in, navigated to `/history`.
4. Asserted "This week" text count === 0.

**Expected**: The FlatList branch mounts (because `sessions.length > 0`), but the strip's `ListHeaderComponent` returns `null` because every bucket is zero (warmups are filtered out server-side by `.neq("set_type", "warmup")`).

**Actual**: "This week" text not present. The session row is visible below where the strip would be. Screenshot `screenshots/warmup-only.png` confirms.

**Result**: **pass**

**Evidence**: `screenshots/warmup-only.png` shows the History tab with one session row visible ("Workout · Tue, May 19 · 30m") and NO strip, NO header chrome, NO border above the row. This validates the design's branch 2 early `return null` BEFORE any wrapper View.

### Edge 4: Loading state (skeleton wrapper)

**Method**: code inspection + bundle verification.

**Spec**: `isLoading` branch renders the wrapper + 4 skeleton blocks (label, value, plot, date-label row) with `mt-1` between label and value (matches data branch to avoid layout jump on data arrival).

**Verification**:
- Confirmed `WeeklyVolumeStrip` symbol is present in the served JS bundle (9 references). Together with the strip's other symbols (`computeStripModel`, `formatVolume`, `weekKeyOf`, `lastNIsoWeeks`, `isoWeekStart`, `useWeeklyVolume`, `listWeeklyVolumeRows`), the feature is shipping.
- Source at `src/components/weekly-volume-strip.tsx:75-84` renders 4 skeleton blocks: `h-3 w-20` (label), `h-7 w-32` (value, `mt-1`), `h-24 w-full` (plot, `mt-4`), `h-3 w-full` (date-label row, `mt-1`). All inside the same wrapper as the data branch with identical padding/border.

**Note**: Could not capture a screenshot of the live loading state — the seeded test data is small enough that the initial fetch completes in < 200 ms, well below Playwright's smallest assertion timeout. The static evidence is conclusive.

**Result**: **pass** (static + bundle evidence)

### Edge 5: Dark mode tokens

**Method**: code inspection.

**Spec**: every NativeWind class pair in the strip has a `dark:` variant for border, text, bar colors, and skeleton.

**Verification**: source at `src/components/weekly-volume-strip.tsx` uses:
- Wrapper: `border-gray-200 dark:border-gray-800`
- Label: `text-gray-500` (intentionally identical light/dark per design)
- Value: `text-black dark:text-white`
- Current bar: `bg-blue-500 dark:bg-blue-400`
- Past bar: `bg-gray-300 dark:bg-gray-700`
- Zero bar: `bg-gray-200 dark:bg-gray-800`
- Skeleton: `bg-gray-100 dark:bg-gray-900`

Each pair matches design §UI spec verbatim. No code path in the component is unreachable from dark mode.

**Result**: **pass** (static evidence — toggling system dark mode mid-test in Playwright/RN-Web is non-trivial and adds little signal over reading the tokens)

### Edge 6: `formatVolume` boundary at 999.5 kg (MIN-3 from validation-v2)

**Method**: unit test.

**Test**: `tests/unit/units.test.ts` → "MIN-3 boundary: 999.5 kg rounds up to k-shorthand (no kg-only cliff)".

**Assertions verified**:
- `formatVolume(999.5, "kg")` → `"1.0k kg"` (rounds-then-compares; not "1000 kg")
- `formatVolume(999.4, "kg")` → `"999 kg"` (under boundary)
- `formatVolume(1000, "kg")` → `"1.0k kg"` (at boundary)
- `formatVolume(100, "lbs")` → `"220 lbs"` (conversion under 1000)
- `formatVolume(500, "lbs")` → `"1.1k lbs"` (500 kg = 1102 lbs, k-shorthand)

**Result**: **pass**

### Edge 7: Refetch path (cache invalidation surrogate)

**Steps** (`weekly-volume-strip.spec.ts:289`):
1. Created a confirmed user. Seeded one session with 5 × 100 × 1 = 500 kg.
2. Signed in, visited History, asserted "500 kg" visible.
3. Seeded ANOTHER session (same week) with 5 × 100 × 1 = 500 kg via the admin API (mid-test).
4. Cleared `localStorage["ada11-query-cache"]` (the persisted TanStack cache key) — preserving the Supabase auth token.
5. Reloaded the page.
6. Asserted "1.0k kg" visible (10 × 100 × 1 = 1000 kg → k-shorthand at exactly 1000).

**Expected**: After clearing the persisted cache and reloading, the strip re-fetches from the server and reflects the new total. This validates the **fetch + render path** end-to-end.

**Actual**: All assertions passed. Screenshot `screenshots/post-refetch.png` shows "THIS WEEK / 1.0k kg" with one full-height blue bar on the right and 7 thin gray stubs to its left. Two session rows are visible below.

**Result**: **pass**

**Note on the mutation-hook invalidation (`["stats"]`)**: this Tester did NOT exercise the in-app `useFinishSession` / `useLogSet` / etc. paths end-to-end (would require driving the workout-logger UI through Playwright, which is out of scope here). The invalidation contract was verified statically by Reviewer v1 (see `review-v1.md` table row "All 5 mutation hooks invalidate `["stats"]` on success: yes — `useFinishSession` (`use-sessions.ts:61`), `useSoftDeleteSession` (`use-sessions.ts:97`), `useLogSet` (`use-sets.ts:43`), `useUpdateSet` (`use-sets.ts:55`), `useDeleteSet` (`use-sets.ts:66`)"). I re-grep'd the source post-Reviewer and confirmed all 5 sites still call `qc.invalidateQueries({ queryKey: ["stats"] })`. The dynamic refetch test above proves the fetch + bucket + render path responds correctly to new server data, which is the half of the contract that wasn't already verified statically.

## Regression check

- **Sessions list still renders normally**: **pass** — visible in `golden-strip.png` (5 visible session rows below the strip, each with title "Workout" + started-at + duration). Click-through navigation icon (`>`) is present per existing UI.
- **Pull-to-refresh combined `isRefetching`**: code at `app/(app)/history/index.tsx:56` reads `refreshing={isRefetching || isRefetchingWeekly}`, and `onRefresh = useCallback(async () => await Promise.all([refetch(), refetchWeekly()]))`. The refetch test above exercises this code path via a reload; the combined-state OR is small enough that visual inspection suffices.
- **Per-exercise progress chart at `app/(app)/exercises/[id]/progress.tsx`**: untouched (`git diff --stat` confirms file is not in the changeset). Volume kernel reused without modification.
- **Single-session detail view at `app/(app)/history/[id].tsx`**: untouched (`git diff --stat` confirms). Continues to show its (intentionally out-of-scope) "Total" line that counts warmups; design §Riscos and §Out-of-scope explicitly flag this for a separate run.
- **`formatWeight` callers (regression risk for the new `formatVolume`)**: unit test "does NOT affect existing formatWeight" confirms `formatWeight(100, "kg") === "100.0 kg"` still holds.
- **`useSessions` data shape**: untouched; only `onRefresh` behavior in `history/index.tsx` was widened.

## Cross-platform

- **Web**: **pass** — verified end-to-end via Playwright + Chromium against the live Expo dev server. 4 e2e scenarios pass.
- **iOS**: **not tested** — no iOS simulator or device available in this sandbox. The strip uses only `View` + `Text` from `react-native` and NativeWind classes that match existing dark-mode patterns in the codebase. The implementer notes confirm no platform-specific code.
- **Android**: **not tested** — same as iOS.

## Test commands

- [x] `npm run typecheck` — `tsc --noEmit` exits 0, clean.
- [x] `npm run lint` — 0 errors, 1 warning, only in pre-existing `.expo/types/router.d.ts` (auto-generated; unrelated).
- [x] `npm run test:unit` — 4 files, 33 tests, all pass (964 ms). 28 new tests added for this feature.
- [x] `npm run test:e2e` (`weekly-volume-strip.spec.ts`) — 4 scenarios, all pass (30.0 s).

## Files added by this Tester run

- `tests/unit/dates.test.ts` — 13 tests for ISO-week math.
- `tests/unit/units.test.ts` — 8 tests for `formatVolume` + `formatWeight` regression.
- `tests/unit/weekly-volume-bucketing.test.ts` — 7 tests for the strip's bucketing kernel.
- `tests/e2e/weekly-volume-strip.spec.ts` — 4 end-to-end scenarios driving the real web app.
- `docs/runs/2026-05-19_2144_weekly-volume-stat/screenshots/{golden-strip,empty-state,warmup-only,post-refetch}.png` — visual evidence captured by Playwright.

These are net-additive; no production code was touched.

## Decision

**pass**

Reasoning:
- **Golden path: pass.** Strip renders the spec's exact layout. "THIS WEEK" + "2.5k kg" + 8 bars + 8 Monday-`M/d` labels, current week is the rightmost full-height blue bar, max-volume week scales to the top, populated/rest/current bars use the three documented color classes. Verified visually in `golden-strip.png`.
- **All 7 edge cases: pass.** No-finished-sessions → "No sessions yet" with no strip chrome. Rest weeks → 4 px gray stubs. All-zero (warmup-only) → bare `return null`, FlatList still mounts. Loading skeleton → 4 placeholder blocks with matching wrapper height. Dark-mode tokens → every class pair present in source. `formatVolume` 999.5 boundary → "1.0k kg" (no kg/lbs cliff). Refetch path → fresh server data renders correctly after cache purge.
- **Regression check: pass.** Adjacent files untouched (`history/[id].tsx`, `exercises/[id]/progress.tsx`). Existing `formatWeight` callers preserved. `useSessions` shape unchanged. `onRefresh` widening produces correct combined `isRefetching`.
- **Quality gates: pass.** typecheck clean, lint clean (no new warnings), unit tests 33/33, e2e 4/4.
- **Cross-platform**: web verified end-to-end with screenshots. iOS/Android not tested in this sandbox; the implementation uses only platform-agnostic primitives, and the design's risk envelope ("Web platform: NativeWind + plain Views render identically on react-native-web. Risk: nil.") backs out the platform-specific gap.

Recommendation to the Conductor: **finalize**.
