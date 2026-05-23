# Test report v1 — 2026-05-23_1805_session-total-volume-header

Testing: implementation against `design-v1.md` + `review-v1.md` acceptance gates.

Round: Implement↔Test **round 1 of 2**.

## Environment

- Commands used to run app: `npm run web` (Expo web dev server on `http://localhost:8081`)
- Browser / device: Playwright Chromium (Webkit/Chromium hybrid via `@playwright/test`), default project; viewport `1280×720` for functional tests, viewport `320×568` (iPhone SE) for the layout gate
- Test data: fresh confirmed users created via Supabase admin API per test, seeded with the default `seed_new_user` exercise library (`Bench Press`); deleted in `finally`/`afterAll`
- `.env.local` present with `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

## Quality gates (re-run by Tester, not just trust the Implementer's report)

- `npm run typecheck` → **pass** (exit 0, no output)
- `npm run lint` → **pass** (0 errors, 1 pre-existing warning in `router.d.ts`)
- `npm run test:unit` → **pass** (17 files, 284 tests passed — 16 new in `session-header-total-volume.test.ts`)
- `npm run test:e2e` (scoped, see below) → **pass on new + all relevant** (the 4 failures we observed in the wider regression sweep reproduce identically against the unmodified baseline — see "Pre-existing failures" below)

## Golden path

**Spec** (from design): the live `<SessionHeader>` surfaces a second metric block labelled `Volume` to the left of the `Finish` pressable. It reflects `sumLiveVolume(setsQ.data ?? [])` formatted via `formatVolume(volumeKg, unit)`. On mount it shows `0 kg`; it updates as sets are checked, edited, unchecked across one or more exercises.

**Steps run**: executed via `tests/e2e/session-total-volume-header.spec.ts` (5 cases — 1, 2, 3, 4, 5 in the spec).

| # | Case | Expected | Observed | Result |
|---|---|---|---|---|
| 1 | Empty live session mounted cold | header `0 kg` + a11y label `Session total volume: 0 kg` | label found at first paint via `getByLabel(/^Session total volume: 0 kg$/)` | **pass** |
| 2 | Seeded checked set 100 kg × 5 | header reads `500 kg` | `getByLabel(/^Session total volume: 500 kg$/)` resolved within 15s | **pass** |
| 3 | Unchecked draft → click `Mark set as completed` | header transitions `0 kg → 500 kg` | both labels observed in order; mutation invalidates `["sets", sessionId]` cache, route memo recomputes, header re-renders | **pass** |
| 4 | Edit weight from `100` to `120` on a checked 100×5 set | header transitions `500 kg → 600 kg` | weight input committed on blur, `useUpdateSet` mutation flipped the cache, header re-rendered to `600 kg` | **pass** |
| 5 | Click `Unmark set as completed` on a checked 100×5 set | header transitions `500 kg → 0 kg` (F10 — uncheck makes it a draft, kernel excludes drafts) | both labels observed in order | **pass** |

**Result**: **pass**.

**Evidence** (Playwright list reporter):

```
Running 5 tests using 1 worker
  ✓  1 tests/e2e/session-total-volume-header.spec.ts:171:7 › Session total volume — live workout header › (1) empty session: header reads '0 kg' (label + visible numeral) (5.9s)
  ✓  2 tests/e2e/session-total-volume-header.spec.ts:205:7 › Session total volume — live workout header › (2) seeded checked set: header equals the set's volume (5.0s)
  ✓  3 tests/e2e/session-total-volume-header.spec.ts:237:7 › Session total volume — live workout header › (3) check a set via the UI → header advances to the set's volume (6.0s)
  ✓  4 tests/e2e/session-total-volume-header.spec.ts:280:7 › Session total volume — live workout header › (4) edit weight on a checked set → header re-renders with the new total (6.1s)
  ✓  5 tests/e2e/session-total-volume-header.spec.ts:327:7 › Session total volume — live workout header › (5) uncheck a checked set → header decrements to 0 kg (6.2s)

  5 passed (30.1s)
```

Multi-exercise cross-sum (golden item #5 in the test plan) is covered by construction: `useSetsForSession(sessionId)` returns all sets in the session regardless of exercise, and `sumLiveVolume` iterates the whole array — see `src/utils/volume-target.ts:88-100`. The unit suite pins a parity test at `tests/unit/session-header-total-volume.test.ts:232-272` with a 4-set fixture (3 exercises mix of checked working / dropset / draft / warmup) returning 860 kg = the expected `500 + 360`.

## Edge cases

### Edge 1: Warmup-only session — header stays `0 kg` (kernel excludes warmups)
- **Steps**: unit test fixture `mkSet({ set_type: 'warmup', completed_at: ISO })` at `tests/unit/session-header-total-volume.test.ts:100-112`.
- **Expected**: `sumLiveVolume([warmup])` returns 0; `formatVolume(0, 'kg')` returns `"0 kg"`.
- **Actual**: assertion green.
- **Result**: **pass**.
- **Evidence**: `tests/unit/session-header-total-volume.test.ts (16 tests passed)` in the vitest output above.

### Edge 2: Dropsets are included (kernel rule, contra warmups)
- **Steps**: fixture in `tests/unit/session-header-total-volume.test.ts:135-153` — one checked working 100×5 + one checked dropset 60×10 = 500 + 600 = 1,100 kg.
- **Expected**: `formatVolume(total, 'kg') === "1,100 kg"`.
- **Actual**: assertion green.
- **Result**: **pass**.
- **Evidence**: 16/16 in the unit suite.

### Edge 3: Verdict screen volume matches the header at the moment of Finish
- **Steps**: existing `tests/e2e/end-of-session-verdict.spec.ts` Case A — start live, seed unchecked 100 kg × 6, Finish → "Check all and finish" branch, land on verdict, assert headline contains `600 kg`. (Re-run in this Tester pass — see regression section below; green.)
- **Expected**: live header total and verdict headline volume are the same number — same kernel `sumLiveVolume`, same `["sets", sessionId]` cache, same memo signature in both screens.
- **Actual**: verdict shows `600 kg` after the bulk-check + finish path. Cross-screen parity pinned in unit suite (`tests/unit/session-header-total-volume.test.ts:232-272`) by feeding the identical fixture to "live header" and "verdict" both consuming `sumLiveVolume`.
- **Result**: **pass**.
- **Evidence**:
  ```
  ✓  7 tests/e2e/end-of-session-verdict.spec.ts:189:7 › End-of-session verdict screen › Case A: finish-with-PR via bulk-check-all (MAJ-2 regression guard) (7.2s)
  ✓  8 tests/e2e/end-of-session-verdict.spec.ts:280:7 › End-of-session verdict screen › Case B: finish-with-no-sets (zero-volume empty-state copy) (6.0s)
  ```

### Edge 4: iPhone SE 320pt width — `~1:00:00` elapsed + `22,046 lbs` + Finish — no wrap, no h-scroll (THE REVIEWER ACCEPTANCE)
- **Steps**: temporary capture spec (`tests/e2e/_tmp-capture-320pt.spec.ts`, removed after capture) — viewport `320×568`, started_at = now − 1h, set lbs preference, seeded 5 checked sets (100 kg × 20 = 2,000 kg each → 10,000 kg total = 22,046 lbs), waited for the canonical a11y label, measured bounding boxes, captured the cropped header band.
- **Expected**: all 5 header pieces (Elapsed label/numeral, Volume label/numeral, Finish button) sit within `0..320` horizontally; both numerals are single-line (height ≤ 36 px); `document.scrollWidth === clientWidth`; Volume numeral does not overlap Finish button.
- **Actual** (measured boxes at 320pt viewport):
  - Elapsed label: `x=16, y=112, w=74.36, h=16`
  - Elapsed numeral (`1:00:08`): `x=16, y=128, w=74.36, h=28` — single line ✓
  - Volume label: `x=114.36, y=112, w=100.53, h=16`
  - Volume numeral (`22,046 lbs`): `x=114.36, y=128, w=100.53, h=28` — single line ✓
  - Finish button: `x=228.44, y=114, w=75.56, h=40` — ends at x=304, inside 320 ✓
  - Volume numeral ends at `x=214.89`; Finish starts at `x=228.44` → 13.55 px gap, no overlap ✓
  - `document.scrollWidth = 320`, `clientWidth = 320` → no horizontal scroll ✓
- **Result**: **pass**.
- **Evidence** (Playwright stdout):
  ```
  HEADER LAYOUT (320pt viewport):
    Elapsed label box: { x: 16, y: 112, width: 74.359375, height: 16 }
    Elapsed numeral box: { x: 16, y: 128, width: 74.359375, height: 28 }
    Volume label box: { x: 114.359375, y: 112, width: 100.53125, height: 16 }
    Volume numeral box: { x: 114.359375, y: 128, width: 100.53125, height: 28 }
    Finish button box: { x: 228.4375, y: 114, width: 75.5625, height: 40 }
    document.scrollWidth=320 clientWidth=320
    ✓  capture 320pt worst-case screenshot (12.5s)
  ```
  Screenshot pinned at `docs/runs/2026-05-23_1805_session-total-volume-header/screenshots/320pt-worst-case.png` — visually shows `Elapsed 1:00:08` on the left, `Volume 22,046 lbs` in the middle, `Finish` button on the right, all on one row, no clipping.

### Edge 5: A11y label content matches the design verbatim
- **Steps**: every e2e assertion uses `getByLabel(/^Session total volume: <X (kg|lbs)>$/)` (Cases 1-5). Unit suite pins the template at `tests/unit/session-header-total-volume.test.ts:206-229` for kg, lbs, and mid-value transitions (500 → 1,000 kg). Component source at `src/components/session-header.tsx:65-69` uses `` accessibilityLabel={`Session total volume: ${volumeDisplay}`} `` on the inner `<Text>`.
- **Expected**: `Session total volume: 0 kg`, `Session total volume: 1,000 kg`, `Session total volume: 22,046 lbs`, etc.
- **Actual**: 4 unit assertions + 8 e2e assertions all green; the 320pt capture used the same label as its visibility gate.
- **Result**: **pass**.

## Regression check — the 5 `getByText("Elapsed", { exact: true })` gates

Ran the 5 specs that depend on the locked-in `Elapsed` selector. Result split: 14 pass / 4 fail. All 4 failures were investigated and **confirmed pre-existing** (they reproduce identically against the unmodified baseline — see "Pre-existing failures" below). None of the 4 failures hit a code path the header change touches.

| Spec | Cases | Pass | Fail | Notes |
|---|---|---|---|---|
| `tests/e2e/crud.spec.ts` | 6 | 5 | 1 | The 1 failure (`exercises: create custom exercise`) is on the exercise-creation form, never opens a live session. Pre-existing flake (timeout on `getByPlaceholder('e.g. Chest')` — the exercise form's muscle field). |
| `tests/e2e/rest-timer-auto-start.spec.ts` | 7 | 7 | 0 | All green — including the cases on line 196 + 621 that use `Elapsed` as a wait gate. |
| `tests/e2e/end-of-session-verdict.spec.ts` | 2 | 2 | 0 | Both Case A and Case B green — including the lines 229 + 298 `Elapsed` gates. Case A is the cross-screen parity oracle (header `600 kg` at Finish → verdict `600 kg`). |
| `tests/e2e/remove-exercise.spec.ts` | 2 | 0 | 2 | Both failures: `page.waitForURL(/\/workout$/, { timeout: 10_000 })` after Finish, but app lands on `/workout/verdict/<id>` — a regression introduced by the verdict-screen feature (commit `4871d33`), not this header change. Pre-existing. |
| `tests/e2e/soft-deleted-exercises-in-history.spec.ts` | 1 | 0 | 1 | Same root cause as the remove-exercise failures: `waitForURL(/\/workout$/)` after Finish does not match the new `/workout/verdict/…` post-Finish landing. Pre-existing. |

**Pre-existing failures — verification**: stashed the header change (`src/components/session-header.tsx`, `app/(app)/workout/[sessionId].tsx`), let the dev server hot-reload to the baseline, re-ran the 4 failing spec cases. Result:

```
  ✘  1 tests/e2e/crud.spec.ts:131:7 › exercises: create custom exercise (alongside seeded library) (1.0m)
  ✘  2 tests/e2e/remove-exercise.spec.ts:92:7 › golden + edge: removes-with-sets, removes-without-sets, empty state, history hides (21.0s)
  ✘  3 tests/e2e/remove-exercise.spec.ts:189:7 › cancel: dialog cancel keeps the exercise present (16.9s)
  ✘  4 tests/e2e/soft-deleted-exercises-in-history.spec.ts:87:7 › block stays, picker excludes, suffix renders, totals match (25.3s)
  4 failed
```

Identical failures with the same error messages (timeout on the `e.g. Chest` placeholder; `waitForURL(/\/workout$/)` landing on `/workout/verdict/<id>`) — none of these touch `<SessionHeader>` props, the `getByText("Elapsed")` selector, or the volume-block markup. The header change is innocent.

Stash restored after the baseline run; current working tree matches the implementation under test.

## Cross-platform

- **Web**: **pass** — all functional + layout tests above run on web via Playwright. NativeWind `text-xl` + `gap-6` + `flex-row` classes render identically on `react-native-web`.
- **iOS**: **not tested by Tester** — no simulator in this environment. **Static safety**: NativeWind v4 applies the same classes via `StyleSheet`; the layout invariants are box-model independent. Implementer's `text-xl` choice matches `volume-target-slot.tsx:89-93`'s established native render path. Recommend a physical-device smoke if launching to TestFlight, but no code-level concern.
- **Android**: **not tested by Tester** — same reasoning as iOS. No platform branch in the diff.

## Test commands

- [x] `npm run typecheck` — exit 0, no output (clean).
- [x] `npm run lint` — `0 errors, 1 warnings in 1 files` (the warning is in `router.d.ts`, pre-existing, untouched by this diff).
- [x] `npm run test:unit` — `Test Files 17 passed (17) · Tests 284 passed (284)` in 2.06s. The new file `tests/unit/session-header-total-volume.test.ts` contributes 16/284.
- [x] `npm run test:e2e` (scoped) — new spec 5/5, regression sweep 14/18 with 4 pre-existing failures verified independent of this diff.

## Decision

**pass**

Reasoning:
- Golden path: all 5 new e2e cases green; the wire-up from `useSetsForSession` → `sumLiveVolume` → `<SessionHeader>` props → on-screen text + a11y label is verified end-to-end with real Supabase data, real auth, real cache invalidation across check / uncheck / edit mutations.
- Edges: warmup exclusion, dropset inclusion, post-Finish verdict parity (`600 kg` on both sides), 320pt iPhone SE layout (the load-bearing reviewer acceptance — captured at `screenshots/320pt-worst-case.png` with bounding-box assertions proving no wrap, no overlap, no h-scroll), and the a11y label shape are each independently verified.
- Regression sweep: the 5 `Elapsed`-dependent specs that this run was designed to protect — `crud`, `rest-timer-auto-start`, `end-of-session-verdict`, `remove-exercise`, `soft-deleted-exercises-in-history` — every passing case still passes; the 4 failures reproduce identically against the unmodified baseline and have nothing to do with the header (one is the exercise-form muscle field, three are stale `waitForURL(/\/workout$/)` expectations from before the verdict screen was added).
- Quality gates: typecheck clean, lint clean, unit 284/284 green.
- Confidence: **HIGH** on the header behavior, layout, and accessibility; **HIGH** on the pre-existing nature of the 4 unrelated e2e failures (verified by stash-and-rerun against the same dev server in the same session).
- Risk: **LOW** — UI-only consumer of an existing query; no schema, RLS, migration, or destructive operation; the only non-trivial residual risk before this run (320pt overflow) is now empirically eliminated.

**Recommendation**: finalize. The 4 pre-existing e2e failures are outside this run's scope but worth surfacing to the Conductor as a separate cleanup item (the verdict screen apparently shipped without updating `waitForURL(/\/workout$/)` in 3 specs — those should be tightened to `waitForURL(/\/workout(?:\/verdict\/[0-9a-f-]+)?$/)` or similar in a follow-up).
