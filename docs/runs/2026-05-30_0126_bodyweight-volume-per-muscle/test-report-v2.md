# Test report v2 — 2026-05-30_0126_bodyweight-volume-per-muscle

Testing: implementation against `design-v2.md` (final) + the MAJ-3-NEW carry-in.
Implement↔Test ROUND 2 of 2 — NARROW confirmation round.

## Decision

**PASS.**

The round-1 blocker is closed. The single shipped e2e (`weekly-muscle-volume.spec.ts` test 4) that errored in round 1 on a non-existent canonical "Pull-up" row now seeds the canonical **"Chin-up"** row and passes — I ran the spec myself (4/4, did not merely trust the Implementer's claim). All three static gates are green. The one-line change is test-data only and introduced no new regression. The 2 `chart-scroll-week-selector.spec.ts` failures remain PRE-EXISTING and out of scope.

---

## Scope of this round

Per the Conductor's narrow-confirmation mandate: re-confirm static gates, run the corrected spec, confirm the test-only change introduced no source regression, and re-confirm the chart-scroll failures are pre-existing. The full exploratory pass (golden path via probe, F-4 audit across 8 volume specs, Invariant A/B/C/D) was already completed and proven in round 1 (`test-report-v1.md`) and is NOT re-done here.

## Environment
- Run-the-app command: `npm run web` (Expo web dev server on `http://localhost:8081`). The Implementer left a server up; health-checked **HTTP 200** before the e2e run, before the chart-scroll re-run, and it stayed 200 throughout. No OOM cascade this round.
- e2e runner: `npx playwright test` (Playwright, headless Chromium, `workers: 1`, dev server NOT managed by Playwright — started manually per `playwright.config.ts`).
- Supabase env: `.env.local` present (service-role + URL/anon keys); admin-seed path works.

---

## 1. Static gates — re-confirmed (observed numbers)

```
TYPECHECK_EXIT=0   tsc --noEmit, no output
LINT_EXIT=0        expo lint, 0 errors / 0 warning lines printed (clean run)
UNIT_EXIT=0        Test Files  26 passed (26) | Tests  431 passed (431) | Duration 2.79s
```

- **`npm run typecheck`** — exit 0, no output. PASS.
- **`npm run lint`** — exit 0. This round printed no error/warning lines at all (a fully clean run prints nothing after the env-load lines). Round 1 noted 1 warning in the auto-generated `.expo/types/router.d.ts`; either way, **no source file is flagged**. PASS.
- **`npm run test:unit`** — exit 0, **431 passed / 431** across 26 test files (2.79s). Matches the expected 431 (baseline 384 + 47 new) exactly. PASS.

All three gates green — unchanged from round 1, as expected for a test-data-only edit.

---

## 2. Corrected spec — `tests/e2e/weekly-muscle-volume.spec.ts` — 4/4 PASS

Ran it myself:

```
Running 4 tests using 1 worker
[1/4] 1. section renders for a populated user; old per-session chart is gone
      [screenshot] .../screenshots/muscle-volume-section.png
[2/4] 2. check-all / uncheck-all toggles every muscle line
[3/4] 3. per-muscle chip toggles a single line's visibility
[4/4] 4. bodyweight exercise feeds the chart via the Phase-0 kernel
      [screenshot] .../screenshots/bodyweight-muscle-line.png
  4 passed (22.2s)
```
```
test-results/.last-run.json → {"status":"passed","failedTests":[]}
```

**Test 4 — the round-1 blocker — now PASSES.** It seeds canonical "Chin-up" (`weekly-muscle-volume.spec.ts:307`), a real bodyweight row whose `muscles[0]` = "Upper back", plus an 80 kg prior weigh-in, then a 4×8 unweighted (`weight: 0`) session this week. The "Weekly volume per muscle" section and the "Upper back" line both render — the same golden path I drove via a temporary probe in round 1 (which produced the identical 2,560 kg result), now exercised by the SHIPPED test.

### Visual evidence (regenerated this round, 03:04 BRT)
- `docs/runs/2026-05-30_0126_bodyweight-volume-per-muscle/screenshots/bodyweight-muscle-line.png` (test 4): **THIS WEEK 2,560 kg** = 80 kg (resolved prior weigh-in) × 8 reps × 4 sets. Hero **Max 2,560 · Now 2,560 · To PR 0**; weekly strip bar; **Best week: 2,560 kg (25/05)**; **WEEKLY VOLUME PER MUSCLE** section with a data point at 2,560 kg + "Uncheck all" control. The "same number everywhere" invariant holds for a bodyweight exercise across hero + strip + chart simultaneously. Pre-feature this would be 0.
- `docs/runs/2026-05-30_0126_bodyweight-volume-per-muscle/screenshots/muscle-volume-section.png` (test 1, barbell Bench Press): Invariant A holding for a non-bodyweight exercise; old "Volume per session" header gone.

---

## 3. No NEW regression from the one-line change — verified

The round-2 fix touches ONLY `tests/e2e/weekly-muscle-volume.spec.ts`. Confirmed test-data only:

- **`grep -i "pull-up"` on the spec → 0 matches**; `grep -i "chin-up"` → the seed call at `:307` plus comment lines. The behavioral change is the single `pickCanonicalExercise(admin, "Pull-up")` → `"Chin-up"` swap at line 307; the rest is comment prose. No test logic, no assertion target changed (the `getByText("Upper back")` assertion at `:340` holds because Chin-up's `muscles[0]` is also "Upper back").
- **No source file changed since round 1.** File-mtime audit: every tracked source file under `app/` + `src/` has mtime **02:51:08**, and the 4 untracked new source files have mtimes ≤ **02:16:41** — all BEFORE the round-1 test report was written (**02:54:52**). The only file modified after the report is the spec, at **02:57:58**. Therefore source behavior is byte-identical to what round 1 exercised and the Reviewer reviewed; the static gates (typecheck/lint/431-unit) confirm nothing else moved.

→ The round-2 edit is purely test-data; no new regression possible from it.

---

## 4. `chart-scroll-week-selector.spec.ts` — still PRE-EXISTING, out of scope

Re-ran the spec in isolation: **2 failed / 2 passed**, identical to round 1.

```
Locator: getByRole('button', { name: 'View week of 5/25' })  → not visible
  (failing at :192 and :382 — the current-week date-label assertions)
  2 failed
  2 passed (58.0s)
```

Round 1 rigorously proved these are pre-existing via `git stash` to baseline `5a2382b` (the same 2/4 failure reproduced on baseline, with the OLD `SessionVolumeChartSection` re-imported). Because no source file changed between round 1 and now (mtime audit above), that baseline proof still holds — re-running the stash test would be redundant and is explicitly out of scope. The failing locator is a DATE label (`View week of 5/25`), not a volume number; note the spec still expects the `m/d` "5/25" format while the app now renders `dd/mm` "25/05" (per commit `5a2382b`), reinforcing that this is a pre-existing spec/date-label mismatch unrelated to this feature.

**Conclusion: the 2 chart-scroll failures remain PRE-EXISTING and are NOT a blocker for this feature — log them as a separate pre-existing issue.**

---

## Cross-platform
- **Web**: PASS — tested via Playwright (Chromium). Feature works; corrected spec 4/4.
- **iOS**: not tested. Reason: the change is RN-Web-compatible only (pure TS kernel helpers, TanStack hooks, PostgREST SELECT widening, `react-native-svg` chart on the same path as the existing `<ProgressChart>`; no native modules). Risk LOW (design R-6). Unchanged from round 1.
- **Android**: not tested. Same reasoning. Risk LOW.

## Test commands
- [x] `npm run typecheck` — exit 0, no output.
- [x] `npm run lint` — exit 0, clean (no source file flagged).
- [x] `npm run test:unit` — **431 passed / 431** (26 files), exit 0.
- [x] `npm run test:e2e` (corrected spec) — `weekly-muscle-volume.spec.ts` **4/4 PASS** (22.2s).
- [x] `npm run test:e2e` (regression check) — `chart-scroll-week-selector.spec.ts` 2/4, both fails PRE-EXISTING (out of scope).

---

## Decision

**PASS.**

### Final QA sign-off

The bodyweight-volume-per-muscle feature works as specified. The round-1 blocker — the only defect found across the entire run — is closed: the shipped e2e now seeds an existing canonical bodyweight row ("Chin-up") and passes 4/4, exercised by me directly. **Invariant A holds** (non-bodyweight numbers byte-for-byte unchanged: barbell Bench Press renders the exact expected 1,500 kg in test 1 and the unit byte-identity assertions are in the green 431/431; round-1's 36/38 volume-spec audit stands because no source changed). **Bodyweight volume surfaces correctly**: an unweighted (weight=0) Chin-up session with an 80 kg prior weigh-in produces a real 2,560 kg (= 80 × 8 × 4) that appears identically on the hero, the weekly strip, the best-week callout, and the new per-muscle chart's "Upper back" line — where pre-feature it would have contributed 0. The one-line round-2 change is test-data only and introduced no new regression (confirmed via grep + a source-file mtime audit + all green gates). The 2 `chart-scroll-week-selector.spec.ts` failures are a separate PRE-EXISTING date-label issue (proven on baseline `5a2382b` in round 1), not a blocker for this feature.

### Confidence / risk
- **Round-1 blocker closed:** HIGH — ran the corrected spec myself, 4/4, with a regenerated screenshot showing the exact 2,560 kg surface.
- **No new regression from the test-data fix:** HIGH — change is comment + one seed name; mtime audit + green gates confirm zero source movement since round 1.
- **chart-scroll fails are pre-existing, not a regression:** HIGH — identical 2/4 reproduced this round; baseline-stash proof from round 1 still applies since source is unchanged.
- **Risk of shipping as-is:** LOW — feature correct, all gates green, no failing test left in this PR's spec.
