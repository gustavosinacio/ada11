# Test report v1 — 2026-05-24_2233_sessions-list-on-progress-chart

Testing: implementation against `design-v2.md`.

## Environment
- Commands used to run app: `npm run web` (background, http://localhost:8081)
- Browser / device: Playwright Chromium 1.59.1, viewport 420×1400 for the long-page screenshot, default 1280×720 for e2e specs
- Test data: ephemeral users created via Supabase service-role admin (one per test), torn down in `afterAll` / `finally`

## Quality gates

- [x] `npm run typecheck` — **clean**. `tsc --noEmit` exits 0 with no diagnostics.
- [x] `npm run lint` — **clean**. `0 errors, 1 warning` (the 1 warning is pre-existing on `router.d.ts`, unrelated to this feature).
- [x] `npm run test:unit` — **354/354 passing** across 22 files in 1.97s. New `tests/unit/exercise-session-row-format.test.ts` contributes 7 tests, all green:
  - happy path (4×100kg×8 → `4 × 3,200 kg`)
  - warmup exclusion from count + volume
  - all-warmup → empty label
  - sloppy data (null weight / 0 reps) counted but excluded from volumeKg
  - zero-volume label suppression with non-zero count
  - empty sets array
  - lbs conversion (`4 × 7,055 lbs`) + pinned regex `^\d+ × [\d,]+ (kg|lbs)$`
- [x] `npm run test:e2e` — see Scenario sections below.

## Golden path

**Spec** (from design-v2): seed 3 sessions for one exercise, deep-link to `/(app)/exercises/{id}/progress`, see the new "Sessions" section below the charts with each row showing date + `N × volume {unit}`, reverse-chronological (newest first), tap-through routes to `/(app)/history/{sessionId}`.

**Steps run** (Playwright spec `tests/e2e/exercise-session-row-list.spec.ts → "golden …"`):
1. Create confirmed user via Supabase admin.
2. Pick "Bench Press" from the user's seed exercises.
3. Seed 3 finished sessions on different days (10 / 5 / 1 days ago), each with working sets.
4. Sign in via UI, navigate to `/(app)/exercises/{benchId}/progress`.
5. Assert section header "Sessions" visible.
6. Assert `page.getByLabel(/^Open session from /)` cardinality === 3.
7. Assert at least one row matches `^\d+ × [\d,]+ (kg|lbs)$`.
8. Click the first (newest) row and assert URL matches `/history/{newestSessionId}`.

**Result**: **pass**

**Evidence** — Playwright JSON output:
```
spec: golden: 3 sessions render DESC, aggregate matches `N × volume kg`, tap-through pushes /history/{id} ok= true
stats: { "expected": 3, "skipped": 0, "unexpected": 0, "flaky": 0 }
```

Long-page screenshot: `docs/runs/2026-05-24_2233_sessions-list-on-progress-chart/screenshots/progress-long-page.png` (420×1400). Shows:
- "Bench Press" header + Edit pencil
- "Bench Press / 3 sessions logged · Best est. 1RM: 132.0 kg" subline
- Estimated 1RM chart with 3 dots at 5/10, 5/17, 5/22
- Total volume chart with 3 dots (2.3k, 3.2k, 1.3k)
- **SESSIONS** header in the same gray uppercase style as `/history/week/[isoWeek].tsx`
- Row 1: "Fri, May 22" / "2 × 1,320 kg" / chevron
- Row 2: "Sun, May 17" / "4 × 3,200 kg" / chevron
- Row 3: "Sun, May 10" / "3 × 2,280 kg" / chevron
- Bottom tab bar

DESC ordering visually confirmed (newest 5/22 first). Volume aggregates cross-check against the Total volume chart points (2.3k≈2,280, 3.2k≈3,200, 1.3k≈1,320). Horizontal alignment: chart container left edge ("Estimated 1RM (kg)", "Total volume (kg)" titles) is flush with "SESSIONS" header and row content — `px-6` ambient governs as designed.

## Edge cases

### Edge 1: lbs unit mode → aggregate renders `N × X lbs`
**Steps** (`tests/e2e/exercise-session-row-list.spec.ts → "lbs mode …"`):
1. Create user, upsert `user_preferences.weight_unit = "lbs"`.
2. Seed one session with 4×100kg×8 (= 3,200 kg ≈ 7,055 lbs).
3. Sign in, navigate to progress screen.
4. Assert at least one row text matches `^\d+ × [\d,]+ lbs$`.

**Expected**: label suffix is `lbs`, the screen-level pinned regex covers both unit branches.

**Actual**: pass.

**Evidence**:
```
spec: lbs mode: aggregate label suffix is 'lbs' ok= true
```

### Edge 2: warmup-only fixture (empty-state branch wins)
**Steps** (`tests/e2e/exercise-session-row-list.spec.ts → "warmup-only fixture …"`):
1. Seed one session with only `set_type: "warmup"` sets.
2. Navigate to progress screen.
3. Assert `/No working sets recorded yet/i` is visible.
4. Assert `page.getByText("Sessions", exact: true)` cardinality === 0.
5. Assert `page.getByLabel(/^Open session from /)` cardinality === 0.

**Expected**: empty-state branch wins; new section is not rendered (gated by `e1rmData.length > 0`).

**Actual**: pass.

**Evidence**:
```
spec: warmup-only fixture: empty state visible AND 'Sessions' header NOT in DOM ok= true
```

### Edge 3: same-day a11y label disambiguation
**Steps** (live probe `__sameday_tmp.spec.ts`, removed after run):
1. Seed two sessions on the same calendar day at different times (6h ago and 1h ago).
2. Navigate to progress screen.
3. Read `aria-label` from both rows.

**Expected**: labels differ (time-of-day included), so `getByLabel` and screen-reader users can disambiguate.

**Actual**: labels differ — `"Open session from Sun, May 24, 10:22 PM"` vs `"Open session from Sun, May 24, 5:22 PM"`. DESC ordering also verified (10:22 PM row is first).

**Evidence** (captured via `console.log` in the probe spec):
```
SAME_DAY_LABELS: ["Open session from Sun, May 24, 10:22 PM","Open session from Sun, May 24, 5:22 PM"]
spec: probe: same-day a11y labels are distinct ok= true
```

### Edge 4: soft-deleted exercise still renders the sessions list
**Steps** (live probe `__softdel_tmp.spec.ts`, removed after run):
1. Seed two finished sessions for "Bench Press".
2. Soft-delete the exercise (`exercises.deleted_at = now`).
3. Navigate via direct URL to `/(app)/exercises/{benchId}/progress`.
4. Assert section header visible + cardinality === 2.

**Expected**: list still renders for soft-deleted exercises — `listSetsForExercise` does not filter on `exercises.deleted_at` (design-v2 risk note explicitly endorses this behavior).

**Actual**: pass — 2 rows rendered for the soft-deleted exercise.

**Evidence**:
```
spec: probe: soft-deleted exercise still renders the sessions list ok= true
SOFT_DEL_ROW_COUNT: 2
```

## Regression check

### `tests/e2e/exercise-progress-ia.spec.ts` — empty-state pins + IA behavior
- **golden + delete (list → progress → pencil → edit → save → progress; delete lands on list)**: **pass**
- **name tap in live workout block routes to /exercises/{id}/progress and back**: **pass**
- **cache: finishing a session does not break the progress screen on re-entry**: **fail — pre-existing, not caused by this feature**
- **name tap in history detail block routes to /exercises/{id}/progress and back to detail**: **fail — pre-existing, not caused by this feature**

Both failing tests time out on `page.waitForURL(/\/workout$/)` after `Finish` because the live workout flow now navigates to `/workout/verdict/{id}` (an end-of-session verdict screen). Verified pre-existing by stashing the feature changes and re-running the same spec on a clean checkout of `06dd421` — identical 2 failures with identical error messages:
```
TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
  navigated to "http://localhost:8081/workout/verdict/<uuid>"
```
The empty-state pins this feature actually had to preserve (`/No working sets recorded yet/i` at lines 175 + 195) are reached **before** the failing `waitForURL`. Test 1 passes — that's the one most relevant for verifying the gated empty-state branch survives this change.

### `tests/e2e/read-only-history.spec.ts` — history-detail screen regressions
- **All 5 specs pass** (default render is read-only / pencil → done / done → revert / edit persists across re-entry / per-screen scope unlocks all blocks).

### `tests/e2e/max-volume-window.spec.ts` — window pref and chart cross-talk
- **All 6 specs pass** (segment render, persistence, cycling, hero legend, windowed Max, no-history user).

### `tests/e2e/progress-page.spec.ts` — adjacent `/(app)/progress` (NOT the screen modified)
- Several specs fail (4/8 unexpected) but all 4 are pre-existing — verified by re-running the same spec on a clean baseline (stashed feature, identical 4 failures). The screen modified by this run is `/(app)/exercises/{id}/progress`, not `/(app)/progress`, so these failures are out-of-scope.

## Cross-platform

- **Web**: pass. All scenarios above (golden + 3 edges + unit + new e2e + regression sweep) executed on Expo Web via Playwright Chromium.
- **iOS**: not tested — environment has no Xcode simulator running in this session, and the change is platform-neutral (uses `<Pressable>` + `<Text>` + `<ChevronRight>` from `lucide-react-native`, all cross-platform; NativeWind classes are the same paths used elsewhere in the codebase, e.g. `<SessionSummaryRow>`).
- **Android**: not tested — same rationale; no native-specific code touched.

## Test commands
- [x] `npm run typecheck` — clean exit, no diagnostics.
- [x] `npm run lint` — 0 errors, 1 pre-existing warning (`router.d.ts`).
- [x] `npm run test:unit` — `Test Files 22 passed (22), Tests 354 passed (354)`.
- [x] `npm run test:e2e tests/e2e/exercise-session-row-list.spec.ts` — 3/3 pass.
- [x] `npm run test:e2e tests/e2e/read-only-history.spec.ts` — 5/5 pass.
- [x] `npm run test:e2e tests/e2e/max-volume-window.spec.ts` — 6/6 pass.
- [x] `npm run test:e2e tests/e2e/exercise-progress-ia.spec.ts` — 2/4 pass (2 failures verified pre-existing via clean-baseline re-run, unrelated to this feature).

## Decision

**pass**

Reasoning:
- Golden path passes — 3 sessions render DESC, aggregate matches the unit-agnostic regex, tap-through routes to `/history/{sessionId}`.
- All 4 edge cases pass: lbs mode, warmup-only empty-state gate, same-day a11y disambiguation (verified `"...10:22 PM"` vs `"...5:22 PM"`), soft-deleted exercise.
- Regression sweep: the closest adjacent specs (`read-only-history`, `max-volume-window`) are fully green. The 2 IA-spec failures and the 4 progress-page failures are **identical on the clean baseline** — pre-existing, not introduced by this change. The empty-state pins this feature had to preserve are reached before the (pre-existing) failing waits, so the gate works correctly.
- Long-page screenshot captured and reviewed: header + subline + both charts + "SESSIONS" header + 3 rows in DESC order with correct aggregates. Horizontal alignment between chart container and rows is consistent (`px-6` ambient as designed).
- Quality gates clean (typecheck, lint, 354/354 unit).

**Confidence**: HIGH. Volume math cross-checked against the Total volume chart points (chart shows 2.3k / 3.2k / 1.3k at 5/10 / 5/17 / 5/22; rows show 2,280 / 3,200 / 1,320 — match within chart-rounding). a11y label disambiguation verified at runtime, not just in source.
**Risk**: LOW. New section is gated behind the existing empty-state condition; if e1rmData is empty the section never renders. No new RLS surface, no new query. The 2 pre-existing IA-spec failures are documented and triaged.

Recommendation: **finalize**.
