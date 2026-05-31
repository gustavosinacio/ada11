# Implementation — 2026-05-30_2006_e1rm-strength-chart

Based on: `design-v1.md` (approved) and `validation-v1.md` (`go`, carry-in MAJ-1 + MIN-1/2/3).

## Files changed
- `src/utils/e1rm-strength.ts` (new) — F1: pure `presentTopExerciseE1rm(args)` presenter. Ranks top-N eligible (weighted) exercises by distinct sessions, computes best-e1RM per (exercise × ISO week) via `epley1RM` on LOGGED weight (Invariant D), MAX-not-sum (Invariant E1), LOCF-fills untrained weeks + leading flat lead-in (Decision #7a). No React, no I/O. `E1RM_TOP_N = 5` exported.
- `src/components/e1rm-strength-section.tsx` (new) — F2: `<E1rmStrengthSection>` mirroring `<WeeklyMuscleVolumeSection>`. Hooks `useLifetimeWeeklyVolume` + `useAllExercises` + `useWeightUnit` (NO `useMeasurements`). Selection state keyed by exercise `id` with the re-seed idiom; `E1RM_PALETTE` by rank (`colorForRank`); eyebrow `"Estimated 1RM per exercise"`; `formatValue={(v)=>formatWeight(v, unit)}`; `<MultiSeriesChart>` reused as-is; `return null` on loading / empty.
- `app/(app)/progress/index.tsx` (edited) — F3: import + mount `<E1rmStrengthSection />` immediately after `<WeeklyMuscleVolumeSection />`, before `<ExercisesThisWeekList />`; refreshed the stale docstring (now lists the actual 6 children).
- `tests/unit/e1rm-strength.test.ts` (new) — F4: 13-case Vitest suite (injectable `now`, no fake timers). Reuses `mkRow`/`mkExercise` (drops `mkMeasurement`).
- `tests/e2e/e1rm-strength.spec.ts` (new) — F5: Playwright e2e mirroring the muscle harness. Positive (Bench Press + Squat (Barbell) weighted across weeks) + negative (Chin-up bodyweight-only → NO line), with the MAJ-1 settle-gate.

## Deviations from design

1. **E2E negative-case seed name: `Push-up` → `Chin-up` (and positive uses `Bench Press` + `Squat (Barbell)`).** The design (§5 F5) and the Validator both cite the seed migration `0001_rls_and_seed.sql` as proof that `Push-up`/`Pull-up`/`Bench Press` exist. **`0001` is the per-user *trigger* seed — NOT the catalog that `pickCanonicalExercise` queries.** That helper queries `exercises WHERE user_id IS NULL` (the shared canonical catalog, `canonical-exercise.ts:38-43`), whose source of truth is migration `0011_canonical_exercises.sql` (which flipped the original user's rows to canonical) and which was subsequently reshaped — migration `0014_backfill_exercise_muscles.sql:133` references `'Pull Up'` (no hyphen), proving the live canonical names diverged from the `0001` seed. This is the *exact* class of defect that cost the prior run an I↔T round (it seeded `pickCanonicalExercise(admin, "Pull-up")` against the wrong source; "Pull-up" was MISSING from the live catalog while "Chin-up" existed).
   - I was blocked from probing the live shared backend directly (service-role read denied by the sandbox classifier — a reasonable guardrail). I instead established the verified names from an *authorized* runtime source-of-truth: the **existing passing e2e suite**. A grep shows the green specs resolve exactly these canonical names: `"Bench Press"` (21 call sites, incl. the just-shipped muscle spec the feedback confirmed green), `"Squat (Barbell)"` (1), and `"Chin-up"` (1 — the bodyweight exercise the prior run's Tester *proved* works after the "Pull-up"→"Chin-up" fix). All three are therefore verified-present in the catalog `pickCanonicalExercise` actually queries.
   - Net: positive cases use `Bench Press` (+ `Squat (Barbell)` for the multi-line check-all test); the bodyweight-only negative case uses `Chin-up` (verified bodyweight + verified present), NOT the design's unverified `Push-up`. Behaviour-equivalent for Invariant D (both are bodyweight, both yield no e1RM line), but seeded against a source that is proven to exist.

2. **E2E test count is 3, not 4 (design §5 listed cases 1–4).** I folded design case #2 (check-all/uncheck-all) and case #3 (per-line chip toggle) into a single test ("2. per-exercise chip toggle + check-all / uncheck-all"), because both exercise the same populated section and splitting them would re-seed an identical user twice for no added coverage. The negative Invariant-D case is kept standalone (numbered "4." to match the design's mapping). All assertion content from design cases #1–#4 is present.

## MAJ-1 handling (carry-in must-fix)
Handled in the e2e negative case (`tests/e2e/e1rm-strength.spec.ts`, test "4."). Before the two `toHaveCount(0)` assertions, the test awaits a reliably-present, settled-page anchor — the `<StreakCard>` "Streak" eyebrow (`streak-card.tsx:44`), which always renders once the page is past `isLoading` (this user has one finished session → `current:1, best:1`, the non-day-zero branch). Only after that anchor is visible does the test assert the e1RM section header + the `Toggle Chin-up` chip each have count 0 — at which point a wrongly-rendered section would already be in the DOM. This closes the pre-hydration false-green the Validator flagged: the section is `null` BOTH while loading AND when correctly empty, so a cold `toHaveCount(0)` had no settle-gate. The "Streak" anchor is unique on the Progress page (grep-confirmed no other on-screen "Streak" text) and is matched with `.first()` per the strict-mode convention.

## MIN-1/2/3 handling
- **MIN-1 (tangled LOCF prose):** Implemented the clean §4-step-6 version, not the self-contradictory §86-89 prose. The presenter walks oldest→newest carrying the last real value forward, then backfills leading weeks (before the first real value) with the first non-null value (flat lead-in). The doc comment on `E1rmSeries.values` and the inline comments state this cleanly and consistently. Unit cases #5 (carry-forward, `values[1] !== 0`) and #6 (leading flat lead-in, `values[0] === values[1] > 0`) pin it.
- **MIN-2 (`noUncheckedIndexedAccess`):** The week cell is typed `(number | undefined)[]`; the "realness" test is the explicit `cell[idx] !== undefined` (a passing guard never yields 0, so unset is distinguishable from a real value). Index access uses the established `!` idiom where the value is known-present. Typecheck is clean under the strict flag.
- **MIN-3 (duplicate exercise-name residual, R-7):** The chart `label` is `s.name` (legend text + the chart's internal React key); selection + color key off `s.id`. The accepted LOW/LOW collision is documented inline in `chartSeries` and NOT over-engineered. No `" "`-padding alternative shipped.

## Other notes
- **Invariant D:** the presenter uses `w = row.weight ? parseFloat(row.weight) : 0` with guard `w > 0 && r > 0` — NO `effectiveWeightKg`, NO `measurements` arg, NO `useMeasurements` hook. A bodyweight-only exercise never becomes eligible (verified by unit cases #7/#10 + e2e case #4).
- **Invariant E1:** per (exercise, week) the cell takes `max(epley1RM(...))`, never `+=` (unit cases #3/#4).
- **`epley1RM` reuse:** the presenter is the 3rd e1RM site / 2nd caller — it calls `epley1RM(w, r)`, never re-inlines `* (1 + reps/30)`. Kernel signature unchanged → no call-site wiring forced. `progress.tsx` left intact per design §3 scope guard (no dedup benefit, regression risk).
- **Tie-break determinism:** unit case #9 gives the count-1 pair (ex-e, ex-f) strictly different last-activity timestamps so the recency tie-break (#2) decides the 5th slot deterministically (ex-f wins; name ASC would have picked ex-e, so the test proves recency outranks name). Case #13 confirms row-order independence.

## Soft callbacks made (during this implementation pass)
- None. design-v1 was detailed enough to implement; the one ambiguity (e2e seed name vs the cited-but-wrong `0001` source) was resolvable against the authorized passing-spec source-of-truth without escalation.

## Quality gates
- [x] `npm run typecheck` passed — `tsc --noEmit`, 0 errors (run after each file + after the broad edits).
- [x] `npm run lint` passed — 0 errors, 1 pre-existing warning (auto-generated `.expo/types/router.d.ts`, baseline-unchanged).
- [x] Relevant unit tests pass — `npm run test:unit` → **444/444** (baseline 431 + 13 new e1RM cases). New suite alone: 13/13.
- [x] No new `any` — grep-clean across all 5 new/edited files.
- [x] No new `// @ts-ignore` / `@ts-expect-error` / `eslint-disable` — grep-clean.
- [x] No stray `console.log` — only the two `[screenshot]` logs in the e2e (matches `weekly-muscle-volume.spec.ts:200,345` convention); none in source/unit.

## Notes for Reviewer / Tester
- **Tester:** the e2e author does NOT run e2e (per the contract) — please run `tests/e2e/e1rm-strength.spec.ts`. The MAJ-1 settle-gate (await `<StreakCard>` "Streak" before `toHaveCount(0)`) needs your "does it have teeth?" check: confirm test #4 would FAIL if the section were wrongly rendered for a bodyweight-only user. The seed names (`Bench Press`, `Squat (Barbell)`, `Chin-up`) are the ones the existing green suite uses — but I could not probe the live catalog directly (sandbox denied the service-role read), so if any name resolves to a `pickCanonicalExercise` throw at seed-time, that is the catalog having drifted further; substitute with a name from a currently-green spec.
- **Reviewer:** the single material algorithmic divergence from the muscle presenter is MAX-into-cell (Invariant E1) vs `+=`; verify `src/utils/e1rm-strength.ts` does not accumulate. The LOCF backfill (two passes: carry-forward, then leading-null backfill) is the subtlest code — unit cases #5/#6 pin it.

## Round 2 (test-only locator fix)

Triggered by `test-report-v1.md` (Tester FAIL, split-attributed): the e1RM feature PASSED on its own merits (gates 444/444, new spec 3/3, the SVG line renders and trends up), but ONE pre-existing adjacent test — `tests/e2e/progress-page.spec.ts :: 4. per-row navigation` — went green→red because the new e1RM legend chip now renders the exercise name EARLIER in DOM order, so the test's fragile bare-text `.first()` locator bound to the non-navigable "Toggle <name>" chip instead of the navigable list row. The Tester proved this is feature-interaction (stash-to-baseline replay: baseline PASS, feature FAIL, reproduced twice) and that the break is in the TEST's locator, not feature code.

### Change (one locator)
- `tests/e2e/progress-page.spec.ts:278` — replaced the fragile bare-text `.first()` with the robust role+accessible-name locator that the SIBLING test #8 in the SAME file already uses at line 448:
  - **before:** `const row = page.getByText(exerciseName, { exact: true }).first();`
  - **after:** `const row = page.getByRole("button", { name: \`${exerciseName}, view progress\` }).first();`
- The accessible name is confirmed verbatim against the navigable row component: `src/components/exercises-this-week-list.tsx:120-121` exposes `accessibilityRole="button"` + `accessibilityLabel={\`${row.exerciseName}, view progress\`}`. This role+name pair targets the navigable row and does NOT match the e1RM chip's `"Toggle <name>"` label — disambiguating cleanly. The subsequent `.click()` + `waitForURL(/exercises/${exerciseId}/progress/)` are unchanged. Added a 4-line comment above the locator explaining the chip-collision, mirroring test #8's own DOM-order comment.
- This is the codebase's own established pattern for targeting that row (test #8, proven green), not an invented one. No `getByText` form was retained.

### Scope discipline
- Touched ONLY `tests/e2e/progress-page.spec.ts` (one locator + its explanatory comment). NO change to the e1RM feature code, the new `e1rm-strength.spec.ts`, any other test, or `docs/features.md`.
- Did NOT touch the historically-known `chart-scroll-week-selector` pre-existing failures (explicitly out of scope per the round-2 brief).

### Verification (this env — e2e RAN)
- `npm run typecheck` → `tsc --noEmit` exit 0, 0 errors. **pass**.
- `npm run lint` → 0 errors, 1 pre-existing auto-generated warning (`.expo/types/router.d.ts`, baseline-unchanged). **pass**.
- Started a fresh Expo web dev server on `:8081` (the Tester had shut theirs down), health-checked 200 before each batch.
- `npx playwright test tests/e2e/progress-page.spec.ts` → **8/8 PASS**, incl. the previously-RED `4. per-row navigation` (5.0s). **pass**.
- `npx playwright test tests/e2e/e1rm-strength.spec.ts` → **3/3 PASS** (feature spec unchanged). **pass**.
- Shut the dev server back down after the runs (left `:8081` clean for the final Tester round).
