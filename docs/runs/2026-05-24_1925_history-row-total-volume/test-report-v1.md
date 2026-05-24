# Test report v1 — 2026-05-24_1925_history-row-total-volume

Testing: Implementer round 1 (`implementation.md`) against `design-v2.md`.

## Environment

- Commands used to run app: `npm run web` (Expo web on http://localhost:8081)
- Browser / device: Playwright Chromium (default Playwright `use` block, viewport ~1280×720)
- Test data: fresh confirmed user per test, seeded via Supabase admin API; sessions + sets inserted directly through `admin.from("sessions"|"sets").insert(...)`
- Background dev server PID: bash id `b3nfyv90k` (Expo `start --web`), confirmed serving 200 on `http://localhost:8081`

## Golden path

**Spec** (from design-v2.md, §Visual spec):

> Row line 2 with both fields present (current year, en-US locale):
>
> `Sat, May 24 · 1h 23m · 12,345 kg`
>
> Out-of-current-year session, lbs unit:
>
> `Fri, Nov 8, 2019 · 1h 23m · 27,214 lbs`
>
> Detail-screen header positive case: `Total: 3 sets · 12,345 kg`. Zero case: `Total: 3 sets · —`.

**Steps run** (driven by a Playwright spec scratched into `tests/e2e/history-screenshot.spec.ts`, run, then removed):

1. Created confirmed user via admin API.
2. Seeded 5 sessions via admin SQL: (A) Golden 2 working sets (100×10 + 80×12 = 1,960 kg, duration 1h 23m); (B) Warmup-only (1 warmup row, 30m); (C) Empty (no sets, 5m); (D) Warmup-heavy (1 warmup + 1 working — old code would total 1,860 kg, new code 960 kg); (E) Live (no `ended_at`).
3. Signed in through the UI, tapped the `History` tab.
4. Waited for `useLifetimeWeeklyVolume` to land (3 s timeout — single-render check, no flicker observed in the screenshot).
5. Captured full-page screenshot.
6. Inspected `body.innerText`.
7. Navigated into each session detail by direct URL `/history/<id>`; captured per-detail screenshots.
8. Toggled the weight unit on `/profile` to `lbs`; re-walked the history list + golden detail.

**Result**: **pass**

**Evidence**:

- Screenshot of the History list (kg) — line 2 of the Golden row is exactly the design spec:
  `docs/runs/2026-05-24_1925_history-row-total-volume/screenshots/01-history-list-kg.png`
- `body.innerText` (kg) excerpt:

  ```
  Live session
  Sun, May 24 · in progress
  In progress
  Golden session
  Thu, May 21 · 1h 23m · 1,960 kg
  Warmup only
  Tue, May 19 · 30m
  Empty session
  Sun, May 17 · 5m
  Warmup heavy
  Fri, May 15 · 45m · 960 kg
  ```

  Confirms:
  - Golden row: `Thu, May 21 · 1h 23m · 1,960 kg` — matches design verbatim (weekday short, month short, current year suppressed, `·` separator, formatted volume).
  - Warmup-only row: `Tue, May 19 · 30m` (volume slot omitted, no trailing `· `).
  - Empty row: `Sun, May 17 · 5m` (slot omitted).
  - Warmup-heavy row: `Fri, May 15 · 45m · 960 kg` (warmup volume excluded, NOT the old 1,860 kg).
  - In-progress row: `Sun, May 24 · in progress` + orange `In progress` tag, no `· kg` and no numeric volume.

- Screenshot of the detail header (Golden, kg):
  `docs/runs/2026-05-24_1925_history-row-total-volume/screenshots/02-detail-golden-kg.png`

  `body.innerText` excerpt:
  ```
  Golden session
  Thu, May 21, 8:14 PM
  Duration: 1h 23m
  Total: 2 sets · 1,960 kg
  ```

  Cross-screen consistency: detail header `1,960 kg` is digit-for-digit identical to the list row.

## Edge cases

### Edge 1: Warmup-only finished session — row volume slot hidden

**Steps**:
1. Seeded a session whose only set was `set_type: "warmup"` (40 kg × 10 reps).
2. Opened History list.

**Expected** (design §Riscos — UX regressions zero-volume + §Visual spec):
- Row line 2: `Tue, May 19 · 30m` — no volume slot.
- Detail header: `Total: 0 sets · —`.

**Actual**:
- List row text matches.
- Detail header (screenshot `04-detail-warmup-only-zero.png`) shows `Total: 0 sets · —`.

**Result**: **pass**

**Evidence**: `body.innerText` of `/history/<warm_id>`:
```
Warmup only
Tue, May 19, 8:14 PM
Duration: 30m
Total: 0 sets · —
```
- Em-dash is present.
- Trailing literal `volume` word is absent (verified via `expect(detailText).not.toContain("volume")`).
- The warmup set itself still renders below (with the yellow "W" badge), proving the read-only block is unaffected.

### Edge 2: Warmup-heavy session — correctness improvement on detail header

**Steps**:
1. Seeded a session with one warmup row (60 kg × 15) and one working row (120 kg × 8). Working-only volume is 960 kg; the **old, non-canonical** detail-header reduction would have summed both (60×15 + 120×8 = 1,860).
2. Opened the detail screen.

**Expected** (design §Riscos — UX regressions `history/[id]` detail header, "warmup-containing session totals will *decrease* to match the strip + verdict"):
- Detail header: `Total: 1 set · 960 kg`.
- Old wrong number `1,860 kg` must NOT appear.

**Actual**: Header reads `Total: 1 set · 960 kg`; assertion `expect(detailText).not.toContain("1,860 kg")` passed.

**Result**: **pass**

**Evidence**: screenshot `03-detail-warmup-heavy-kg.png`; raw text:
```
Warmup heavy
Fri, May 15, 8:14 PM
Duration: 45m
Total: 1 set · 960 kg
```
This is the visible-number change the design flagged as MEDIUM-risk for surprise. Verified the new number matches the canonical kernel (`sumLiveVolume`) — the warmup row contributes 0.

### Edge 3: In-progress session — orange tag, no volume

**Steps**: Seeded a session with `ended_at: null`. Opened History list.

**Expected**: Row shows the orange `In progress` tag, no `kg` substring, no `0 kg`.

**Actual**:
```
Live session
Sun, May 24 · in progress
In progress
```
The duration formatter renders `in progress` (lowercase) in line 2, and the orange tag renders below on line 3. The lifetime cache excludes `ended_at IS NULL`, so `map.get(id) === undefined`, so the presenter returns `null` → slot omitted. Confirmed visually in `01-history-list-kg.png`: no volume token, no `0 kg`.

**Result**: **pass**

### Edge 4: Unit toggle (kg ↔ lbs) — row + detail header update consistently

**Steps**: Navigated to `/profile`, tapped `lbs` button, returned to History.

**Expected** (design §Approach — formatVolume(kg, unit) handles the conversion + locale-formatting):
- Strip header switches unit.
- Each row's volume slot re-renders in lbs.
- Detail header reads same lbs value (cross-screen consistency).
- Conversion: 1,960 kg × 2.20462 = 4,321.06 → rounded → `4,321 lbs`.
- 960 kg × 2.20462 = 2,116.43 → `2,116 lbs`.

**Actual** (screenshot `05-history-list-lbs.png`):
```
THIS WEEK
4,321 lbs
...
Golden session
Thu, May 21 · 1h 23m · 4,321 lbs
...
Warmup heavy
Fri, May 15 · 45m · 2,116 lbs
```
Detail header (screenshot `06-detail-golden-lbs.png`):
```
Total: 2 sets · 4,321 lbs
```
Three-way match: strip THIS WEEK total, list row, detail header — all `4,321 lbs`.

**Result**: **pass**

### Edge 5: Cross-surface kernel consistency (list row ↔ detail header digit-for-digit)

**Steps**: Compared the volume token in the History list row against the detail header total for the same session (Golden + Warmup-heavy).

**Expected** (design §Notes for Reviewer/Tester — "every aggregate volume readout in the History flow … now routes through `sumLiveVolume` … A regression in any one surface will cascade visibly").

**Actual**:
- Golden: list = `1,960 kg`, detail = `1,960 kg`. Match.
- Warmup-heavy: list = `960 kg`, detail = `960 kg`. Match.
- lbs: list = `4,321 lbs`, detail = `4,321 lbs`. Match.

**Result**: **pass**

## Regression check

- **`tests/e2e/exercise-progress-ia.spec.ts:298`** — the duration-anchored selector `/·\s*\d+m\b/` on the history row. The first test in the spec (`golden + delete: list → progress → pencil → edit → save → progress; delete lands on list`) walks this row and **passed**. Two other tests in this same file failed identically on a clean baseline (verified by `git stash` + re-run), so the failures are pre-existing environmental issues (the `/workout/verdict/<id>` page not auto-redirecting to `/workout$` within the 10–15 s timeout) and are **not caused by this change**. Evidence: `1779663559_playwright.log` (baseline, no changes) shows identical failure pattern as `1779663475_playwright.log` (with changes). Result: **pass for the row-selector path**, pre-existing flake otherwise.

- **`tests/e2e/crud.spec.ts`** — covers the post-finish History row. 5/6 tests passed; the single failure (`exercises: create custom exercise (alongside seeded library)`) is pre-existing and unrelated to History (reproduces on a clean `git stash` baseline — see `1779663970_playwright.log`). The 3 History-relevant tests in this file all passed:
  - `workout: start ad-hoc, finish, see in history` — **pass**
  - `history: edit started_at backward by 1h, duration updates` — **pass**
  - `history: edit started_at across ISO-week boundary — list moves, strip stays` — **pass**

- **`tests/e2e/read-only-history.spec.ts`** — 5/5 tests passed. The read-only detail screen continues to render correctly with the new `totals` reduction and the new `formatVolume`-based header label.

- **`tests/e2e/weekly-volume-strip.spec.ts`** — 4/4 tests passed. The strip shares the lifetime cache with the new `groupSessionVolumes`; no interference observed (`refetch path` test confirms cache reload + numbers still match).

- **`tests/e2e/week-drill-down.spec.ts`** — 5/5 tests passed. The drill-down route was also wired to pass `totalVolumeKg` into `<SessionSummaryRow>`; no e2e text-assertion broke (the existing assertions target headline + bar tap behaviour, which are upstream of the row).

- **`tests/e2e/session-total-volume-header.spec.ts`** — 5/5 tests passed. This is the in-progress-workout header (the canonical `sumLiveVolume` consumer); validates the kernel widening (`SetRow[]` → `Pick<SetRow, …>[]`) didn't break the most-called caller.

## Cross-platform

- **Web**: pass — full coverage above.
- **iOS**: not tested — change is platform-agnostic (pure React Native primitives + a presenter), no platform-specific code touched. The same component (`<SessionSummaryRow>`) is used identically on iOS. Risk: LOW.
- **Android**: not tested — same reasoning as iOS.

## Test commands

- [x] `npm run typecheck` — `tsc --noEmit` exit 0; no errors. (`tsc --noEmit`)
- [x] `npm run lint` — 0 errors, 1 warning (`router.d.ts`, auto-generated by Expo Router, pre-existing).
- [x] `npm run test:unit` — 20 files, **332/332 tests passed** (`Duration 1.83s`). Includes new `tests/unit/session-summary-row-format.test.ts` (13 tests) and `tests/unit/group-session-volumes.test.ts` (12 tests).
- [x] `npm run test:e2e` — partial (selected specs). Results:
  - `exercise-progress-ia.spec.ts`: 2/4 (2 pre-existing failures, verified on baseline)
  - `crud.spec.ts`: 5/6 (1 pre-existing failure on `create custom exercise`, verified on baseline)
  - `read-only-history.spec.ts`: 5/5
  - `weekly-volume-strip.spec.ts`: 4/4
  - `week-drill-down.spec.ts`: 5/5
  - `session-total-volume-header.spec.ts`: 5/5
  - Tester-scratch screenshot spec: 1/1 (created and then removed after evidence capture).

## Decision

**pass**

Reasoning:

- Golden path matches the design verbatim. Row format `Thu, May 21 · 1h 23m · 1,960 kg` is correct (short weekday, short month, current year suppressed, space-middot-space separators, formatted volume from `formatVolume`).
- All 5 edge cases pass:
  - Warmup-only finished session → row slot hidden, detail shows `Total: 0 sets · —`.
  - Warmup-heavy session → header now shows `Total: 1 set · 960 kg` (correctness improvement; old number `1,860 kg` confirmed absent).
  - In-progress session → orange tag rendered, no volume slot.
  - Unit toggle kg ↔ lbs → consistent across strip header, row, detail header (4,321 lbs everywhere).
  - Cross-surface kernel consistency → list row total === detail header total === strip running sum (verified for two distinct sessions).
- Quality gates all green: typecheck 0 errors, lint 0 errors (1 pre-existing warning in auto-generated `router.d.ts`), unit suite 332/332.
- Regression sweep clean. All e2e failures observed reproduce on a clean baseline before the implementation change (verified by `git stash` round-trip); none are introduced by this patch.
- Visible-number change on warmup-containing historical detail headers is the documented MEDIUM-risk-for-surprise correctness improvement (design §Riscos), not a regression — explicitly intended and validated by the warmup-heavy edge case above.

**Recommendation**: finalize.
