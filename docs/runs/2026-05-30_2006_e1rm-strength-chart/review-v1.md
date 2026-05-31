# Review v1 — 2026-05-30_2006_e1rm-strength-chart

Reviewing: the diff for the implementation against `design-v1.md` (approved GO) + `validation-v1.md` (MAJ-1 + MIN-1/2/3 carry-in).

## Diff scope
- Baseline `state.md`: `3c00d8e02ac15eedf2dcd42e1b06909fef7c669a`. HEAD is still AT baseline; changes are in the working tree (3 untracked new files + 1 unstaged edit). Reviewed the on-disk files + `git diff 3c00d8e -- <path>`.
- Files changed: 5.
  - `src/utils/e1rm-strength.ts` (new, 188 lines) — F1 presenter.
  - `src/components/e1rm-strength-section.tsx` (new, 165 lines) — F2 section.
  - `app/(app)/progress/index.tsx` (edited, +11 / -6) — F3 mount + docstring.
  - `tests/unit/e1rm-strength.test.ts` (new, 13 cases) — F4.
  - `tests/e2e/e1rm-strength.spec.ts` (new, 3 tests) — F5.
- `src/components/multi-series-chart.tsx`: **untouched** (`git diff` empty) — reused as-is per Decision #5. Confirmed.

## Gates re-run by Reviewer (NOT trusted from implementation.md)
| Gate | Result | Implementer claim | Match |
|---|---|---|---|
| `npm run typecheck` | 0 errors (`tsc --noEmit` exit 0) | 0 errors | yes |
| `npm run lint` | 0 errors, 1 warning (`.expo/types/router.d.ts`, auto-generated, baseline-unchanged) | 0 err, 1 pre-existing warn | yes |
| `npm run test:unit` | **444 passed (444)**, 27 files | 444/444 | yes |

## Items 1–10 (per the Conductor's review brief)

**1. Invariant D (logged weight only) — CONFIRMED.** `e1rm-strength.ts:107` `const w = row.weight ? parseFloat(row.weight) : 0;`, `:108` `const r = row.reps ?? 0;`, `:109` guard `if (!(w > 0 && r > 0)) continue;`. NO `effectiveWeightKg`, NO `measurements` arg, NO bodyweight resolution — grep-clean across the file for `effectiveWeightKg` / `measurements` / `bodyweight` (the only `bodyweight` token is in a code comment at `:16`). A `weight=0` set fails the guard BEFORE any cell write / eligibility / session add (`:113-130` all live below the `continue`), so it contributes nothing. Matches the kernel path `progress.tsx:155-159`.

**2. Invariant E1 (MAX not sum) — CONFIRMED.** `e1rm-strength.ts:126-127`: `const prev = agg.cell[idx]; if (prev === undefined || est > prev) agg.cell[idx] = est;` — max-into-cell, NO `+=`. Contrast the volume presenter `weekly-muscle-volume.ts:112` `values[idx]! += w * r;` (independently re-read). No `+=` anywhere in the file (grep-clean). Unit cases #3 (`:99` MAX across same-week sessions, asserts `132` not `~248.67`) + #4 (`:128` MAX across sets in one session, asserts `121`) pin it.

**3. LOCF correctness — CONFIRMED (traced the index-0 edge).** Two passes (`e1rm-strength.ts:151-181`):
- Pass 1 (`:154-164`): carry-forward — `cell[w]` defined → `values[w]=cellMax; last=cellMax`; else `values[w] = last` (genuinely `null` only for strictly-leading weeks before the first real cell).
- `firstReal` lookup (`:168-174`) + Pass 2 (`:175-179`): `seenReal` is set on the iteration where `cell[w]` is first defined, and the `if (!seenReal) values[w] = firstReal` check runs AFTER setting the flag — so the first real index is NOT overwritten (already holds `cellMax`), every index `< first` IS backfilled with `firstReal`, every index `> first` is left as the pass-1 carry-forward. **Index-0 edge traced**: if the first real week is index 0, pass 1 sets `values[0]=cellMax` + `last`; there are zero leading nulls; pass 2 sets `seenReal=true` at w=0 and never overwrites — no leading null, no leading 0, no off-by-one. The array is fully numeric (eligibility guarantees ≥1 real cell so `firstReal` always resolves). `epley1RM` is CALLED (`:111`), not re-inlined — grep-clean for `1 + reps / 30` / `* (1 +`. Unit cases #5 (`:153`, asserts `values[1] !== 0` and `toBeCloseTo(116.67)`) + #6 (`:183`, asserts `values[0]===values[1] > 0`) pin it.
- Note: the `last as number` cast at `:162` writes `null` into a `number[]` slot transiently; that slot is provably a strictly-leading week (only `< firstRealIndex` slots are still `null` after pass 1) and is unconditionally overwritten by pass 2 (`:178`). No `null` survives into the emitted `values[]`. Correct but slightly indirect — see MIN-1.

**4. Eligibility-before-ranking + total-order comparator — CONFIRMED.** The `byExercise` map (`:98`) is populated ONLY inside the guard-passing branch (`:113-122` are below the `:109 continue`), so an exercise with no `w>0 && r>0` set is never created → never ranked → cannot claim a top-N slot. The comparator (`:139-147`) is a TOTAL ORDER: `sessions.size DESC` → `lastActiveMs DESC` → `name.localeCompare ASC` → `id.localeCompare ASC`, with no `Map`-iteration-order reliance (it sorts `Array.from(byExercise.values())`). Unit case #10 (`:347`, 10-session bodyweight-only Push-up excluded; 2-session weighted Bench is the sole series) + #13 (`:425`, identical id-order under forward/reversed/shuffled rows) pin it.

**5. MAJ-1 carry-in (e2e false-green fix) — CONFIRMED, anchor has teeth.** `e1rm-strength.spec.ts:301-303`: the negative test awaits `page.getByText("Streak", { exact: true }).first()` to be visible BEFORE the two `toHaveCount(0)` assertions (`:307`, `:310`). Verified the anchor has teeth: `streak-card.tsx` renders the literal "Streak" text ONLY at `:44`, inside the loaded (non-loading, non-error) branch; the `isLoading` branch (`:18-26`) is a skeleton with NO "Streak" text. So awaiting "Streak" genuinely gates on a hydrated page — a wrongly-rendered e1RM section would already be in the DOM at that point. "Streak" is unique on the Progress page (grep-confirmed: only `streak-card.tsx:44`; `.first()` is belt-and-suspenders). Positive cases #1/#2 seed WEIGHTED exercises (Bench Press, Squat (Barbell)) and assert a visible header + `getByLabel("Toggle …")` chip (`:188-194`, `:237-245`). (Caveat: the positive cases assert the legend chip + section, not a literal SVG `<polyline>`/`<line>` element — see Tester note T-2.)

**6. Deviation sanity-check.**
- **Dev #1 (e2e seed names) — LOW risk, reasoning verified.** The Implementer correctly identified that `0001_rls_and_seed.sql` is the per-user *trigger* seed, NOT the shared canonical catalog `pickCanonicalExercise` queries (`canonical-exercise.ts:38-43`, `WHERE user_id IS NULL`). I cross-checked all three names against currently-green specs: `"Bench Press"` (used in `bottom-tab-home-link`, `canonical-exercise-gating`, `weekly-muscle-volume`, `exercise-note`, `exercise-progress-back-nav`, `soft-deleted-session-volume-leak`, etc.), `"Squat (Barbell)"` (`rest-timer-auto-start`, `auto-fill-placeholder-on-check`, `exercise-progress-back-nav`, `remove-exercise`), and crucially `"Chin-up"` — used at `weekly-muscle-volume.spec.ts:307` `pickCanonicalExercise(admin, "Chin-up")` (the just-shipped, feedback-confirmed-green muscle spec, AND the exact name the prior run's Tester *proved* works after the "Pull-up"→"Chin-up" fix). All three resolve in the live catalog the green suite uses. This is the right substitution — the design's `Push-up` was cited against the wrong source (`0001`), the exact defect class that cost the prior run an I↔T round. Still a DB-state property the Reviewer cannot *execute* — handed to Tester (T-1) but pre-verified as low-risk.
- **Dev #2 (3 e2e tests not 4) — CONFIRMED all §5 intents present.** Design case #2 (check-all/uncheck-all) + case #3 (per-line chip toggle) folded into test "2." (`:204`): chip toggle via `opacity-40` (`:244-250`) AND the `Hide all`/`Show all` button flip (`:252-266`). Case #1 (`:157`, section + legend chip) and case #4 (`:272`, negative bodyweight) kept standalone. No assertion intent dropped.

**7. MultiSeriesChart reuse + section mirror — CONFIRMED.** `<E1rmStrengthSection>` (`e1rm-strength-section.tsx`) mirrors `<WeeklyMuscleVolumeSection>` line-for-line (read both): id-keyed selection state (`:60` `useState<Set<string>>`, keyed `s.id`), the `seriesKeysSig`/`lastSig` re-seed idiom (`:59-70`, identical to muscle `:60-71`), `opacity-40` OFF chips (`:148`), `colorForRank` palette by rank (`:40-41`, `:80`, `:152`), `formatWeight(v, unit)` formatter (`:123`), `return null` on loading/empty (`:87-88`), NO `useMeasurements` (grep-clean — only `useLifetimeWeeklyVolume` + `useAllExercises` + `useWeightUnit`). `<MultiSeriesChart>` consumed as-is (`:117-124`); the component file is untouched.

**8. Mount + docstring — CONFIRMED.** `progress/index.tsx:75` mounts `<E1rmStrengthSection />` immediately after `<WeeklyMuscleVolumeSection />` (`:74`), before `<ExercisesThisWeekList />` (`:76`) — exactly the design slot. Import at `:4`. The stale docstring was DOUBLY stale (the prior "four blocks" list had already silently dropped `<WeeklyMuscleVolumeSection>`); the fix (`:20-37`) now correctly enumerates all 6 children including both the muscle and e1rm sections, and generalizes the lead-in to "independent trend + summary blocks" so it won't rot on the next insert. Good.

**9. MIN-2/MIN-3 + looseness — CONFIRMED.** MIN-2 (`noUncheckedIndexedAccess`): the cell is typed `(number | undefined)[]` (`:61`), realness test is the explicit `cell[idx] !== undefined` (`:126`, `:156`, `:170`, `:177`), and the `!` idiom is used only where the value is known-present (`:41`, `:171`). Typecheck is clean under the strict flag (re-run). MIN-3 (duplicate-name residual): chart `label = s.name` (`:79`) with selection/color keyed off `s.id` (`:82`, `:80`); the accepted LOW/LOW collision is documented inline (`:75-78`), no `" "`-padding alternative shipped — single canonical decision. No new `any` / `as unknown` / `@ts-ignore` / `@ts-expect-error` / `eslint-disable` across all 5 files (grep-clean). The only `console.log` are the two `[screenshot]` logs in the e2e (`:198`, `:314`), matching the `weekly-muscle-volume.spec.ts` convention; none in source/unit.

**10. Gates — re-run, all green** (table above). Matches the Implementer's claims (typecheck 0 / lint 0+1 / 444/444).

## Verification of implementation.md claims
| Claim | Verified? | Notes |
|---|---|---|
| Invariant D — logged weight, no `effectiveWeightKg`/`measurements`/`useMeasurements` | yes | `e1rm-strength.ts:107-109`; grep-clean; section `:44-46` |
| Invariant E1 — MAX, never `+=` | yes | `:126-127`; vs volume `weekly-muscle-volume.ts:112` |
| `epley1RM` called, not re-inlined; 3rd site / 2nd caller; kernel unchanged | yes | `:111`; `formulas.ts:1-5` untouched (re-read) |
| `progress.tsx` left intact (no shared-helper extraction) | yes | not in diff; only `progress/index.tsx` edited |
| LOCF two-pass (carry-forward + leading backfill) | yes | `:151-181`, traced (item 3) |
| Tie-break determinism: recency outranks name for the 5th slot | yes | unit #9 `:273` (ex-f wins on recency over ex-e) |
| 13-case unit suite, drops `mkMeasurement` | yes | `grep -c it(` = 13; fixtures `:23-63`, no `mkMeasurement` |
| 3 e2e tests, MAJ-1 settle-gate, seed names Bench/Squat/Chin-up | yes | `e1rm-strength.spec.ts:156-318`; item 5/6 |
| MIN-1/2/3 handled; clean §4-step-6 LOCF prose, not the tangled §86-89 | yes | doc comment `:35-44` + inline are consistent; item 9 |
| Gates: typecheck 0 / lint 0+1 / 444/444 | yes | re-run by Reviewer; table above |
| No new `any`/`@ts-ignore`/`eslint-disable`/stray `console.log` | yes | grep-clean (item 9) |

## Issues

### Blockers
- none.

### Majors
- none.

### Minors
- **[MIN-1]** `src/utils/e1rm-strength.ts:162`: `values[w] = last as number;` writes a genuine `null` (typed as `number`) into the array for strictly-leading weeks, relying on pass 2 (`:178`) to overwrite every such slot. The reasoning is sound and traced-correct (the only post-pass-1 `null` slots are `< firstRealIndex`, all overwritten), but the `as number` on a known-`null` value is a small type-honesty smell — a future edit that weakens pass 2 (e.g. an early-return) would silently ship a `null` in a `number[]`. Fix (non-blocking): either initialize the array and skip the cast by deferring leading slots to pass 2 only, or add a one-line `// transiently null; backfilled at :178` marker on `:162`. The existing `:160-162` comment partially covers this; tightening the cast comment is enough. Cosmetic / robustness-future — does NOT affect runtime output (unit #6 proves no leading 0/null).
- **[MIN-2]** `src/utils/e1rm-strength.ts:168-179` (the `firstReal` lookup + pass 2): re-scans `agg.cell` twice more after pass 1 already walked it once — three O(weeks) passes per series where one combined pass would do (capture `firstRealIndex`/`firstReal` during pass 1, then a single leading-backfill loop). At N≤5 series × small week counts this is immaterial (R-6 LOW), so this is style-only. Fix (optional): fold the `firstReal` capture into pass 1. Not required.

## Security checklist
- [x] RLS: no new query surface. The presenter is a pure function over the already-fetched `useLifetimeWeeklyVolume()` (`["stats"]`) + `useAllExercises()` (`["exercises"]`) caches — both pre-existing RLS-protected reads on this page (Validator confirmed `0018` is the latest migration; no new column/table). The e2e seeds via the service-role `admin` client (test-only setup), reads the system-under-test via the signed-in UI — established suite convention.
- [x] No `SUPABASE_SERVICE_ROLE_KEY` in client-bundled code. `SUPABASE_SERVICE_ROLE_KEY` appears ONLY in `tests/e2e/e1rm-strength.spec.ts:37` (Playwright admin-seed, never bundled). Grep-clean in `src/` + `app/`.
- [x] No raw SQL / `rpc`. Pure computation + PostgREST reads via existing hooks; no string-concat of user input.
- [x] `EXPO_PUBLIC_*`: no new public env vars. The spec reads pre-existing `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (anon key is publishable by design).

## Style / convention checklist
- [x] No new `any` (grep-clean across all 5 files).
- [x] No new `// @ts-ignore` / `@ts-expect-error` / `eslint-disable` (grep-clean).
- [x] Comments narrate *why* (Invariant D/E1 rationale at `:13-24`, LOCF/no-gap-support at `:22-24`, R-7 residual at section `:75-78`, MAJ-1 settle-gate rationale at spec `:294-300`) — not what.
- [x] Imports follow project style (`~/`-rooted, package imports first; the section's import block mirrors the muscle section).
- [x] New files in conventional folders: presenter in `src/utils/`, section in `src/components/`, unit in `tests/unit/`, e2e in `tests/e2e/` — all match siblings.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 2 minors → per the decision rule (`0 blockers and ≤1 major → pass`), this is a clear **pass**.
- The two correctness-critical invariants (D — logged weight; E1 — MAX not sum) are faithful and structurally enforced; the subtlest code (the two-pass LOCF backfill) was independently traced including the index-0 edge and is correct, with deterministic unit coverage (#5/#6). Eligibility-before-ranking is enforced by construction (the agg map is built only on guard pass), and the ranking comparator is a verified total order. The MAJ-1 carry-in is correctly closed with a settle-gate that provably has teeth (StreakCard "Streak" renders only post-hydration). Both deviations are sound: Dev #1's seed names are pre-verified against currently-green specs (incl. `Chin-up` at `weekly-muscle-volume.spec.ts:307`), and Dev #2 preserves every design §5 assertion intent.
- The 2 minors are a type-honesty smell on a transient cast (MIN-1, no runtime effect — unit #6 proves it) and a micro-inefficiency (MIN-2, R-6 LOW). Neither blocks; both can be addressed in a follow-up or left as-is.

### Non-blocking notes for the Tester (run the e2e — the author does not)
- **T-1 (DB-state, NOT statically verifiable — pre-flagged per the feedback lesson):** the spec seeds `pickCanonicalExercise(admin, "Bench Press")`, `"Squat (Barbell)"`, and `"Chin-up"` against the LIVE shared canonical catalog (`user_id IS NULL`), NOT the `0001` migration. I pre-verified all three appear in currently-green specs (Chin-up at `weekly-muscle-volume.spec.ts:307`), so the risk is LOW — but the Reviewer cannot probe the live catalog. **Confirm each name resolves (no `pickCanonicalExercise` throw at seed-time);** a throw = the catalog drifted further, substitute with a name from a green spec.
- **T-2 (positive case asserts legend, not the line):** tests #1/#2 assert the section header + `Toggle <name>` chip + `opacity-40` toggle, but do NOT assert a visible SVG `<polyline>`/`<line>` for the seeded exercise. The chart renders from `chartSeries[].values` (kg), and the seed produces an increasing weight (90→100) across 2 weeks → a real upward line. Spot-check live that the line/dots actually render (not just the legend chip) — the design's "visible upward line proves the feature" intent (§5 F5) lands on the SVG, which the chip assertion alone doesn't cover.
- **T-3 (MAJ-1 teeth — empirical confirmation):** confirm test #4 would FAIL if the section were wrongly rendered for a bodyweight-only user (i.e. flip the guard locally or trust the Validator's "does it have teeth" mandate). The static analysis says yes (the "Streak" anchor gates on hydration; the section would be in the DOM at assert time), but the Tester owns the empirical close-loop.
- **T-4 (Invariants to spot-check live):** Invariant D end-to-end is test #4 (bodyweight Chin-up → no section). Invariant E1 (MAX) + LOCF are unit-only (cases #3/#4/#5/#6) — no e2e covers them, which is the correct home (the algorithm belongs in unit). No live spot-check needed for E1/LOCF; just confirm the unit suite ran (444/444, re-confirmed by Reviewer).

Recommendation to Conductor: **invoke Tester.**
