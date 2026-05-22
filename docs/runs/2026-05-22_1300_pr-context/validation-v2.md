# Validation v2 — 2026-05-22_1300_pr-context

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## v1 issues — verification

| Issue | v2 fix | Verified |
|---|---|---|
| MAJ-1 (legend collision) | `maxLabel` prop; hero keeps "Max"; list passes "Best session". | ✓ |
| MAJ-2 (double walk) | `prsByExerciseId: Map` in `usePrsThisWeek`. | ✓ (with MIN-C: hook wiring implicit) |
| MIN-1..MIN-10 | Mostly resolved; MIN-6 "Show all" affordance behavior unspecified. | partial |

## NEW majors found in v2

- **[MAJ-A] `<PrListRow>` template drops the `"PR!"` prefix.** v2 line 37: `{exerciseName} [PR] +{overflowKg} kg (was {priorMaxKg} kg)`. Existing verdict at `verdict/[sessionId].tsx:192-194` ships `"PR! +X kg (was Y kg)"`. v1 had it; v2 lost it. The v2 test plan line 42 STILL asserts substring `"PR! +100 kg (was 500 kg)"` — internal contradiction. "Zero behavior change" claim is false.
  - **Fix**: restore `"PR! "` prefix in `<PrListRow>` second-row copy.

- **[MAJ-B] Kernel signature mismatch breaks wrapper.** v2 specifies `computePrsThisWeek(rows, now)`. Existing wrapper takes `{rows, currentWeekStartIso, currentWeekEndIso}` (`progress-page-math.ts:204-208`). Wrapper can't bridge — there's no `now`, only ISO strings. v1 had the right signature.
  - **Fix**: align `computePrsThisWeek` signature with the wrapper input shape: `(opts: {rows, currentWeekStartIso, currentWeekEndIso})`.

## NEW minors

- **[MIN-A]** `currentMaxKg` prop on `<PrListRow>` is dead — not in the rendered string. Drop or document as metadata.
- **[MIN-B]** "Show all (N)" tap behavior unspecified.
- **[MIN-C]** Hook wiring implicit: design doesn't state `useExercisesThisWeek` calls `usePrsThisWeek()` to consume the map. Without that, the double-walk fix is defeated.
- **[MIN-D]** Test case (d) hedged ("or whatever v2 picks"). Pin to "max in-week" per Approach #3.
- **[MIN-E]** `ExerciseThisWeekRow` type extension (`priorMaxKg?`, `overflowKg?`) not in I/O contracts.
- **[MIN-F]** Verdict callsite mapping `currentKg → currentMaxKg` not documented (if prop stays).

## Decision

**`no-go`** (round 2 of 3; 1 round remaining).

## Counts

`{ blockers: 0, majors: 2, minors: 6 }`

## Recommendation to Conductor

`invoke Designer for re-design (v3)`. Both majors are 1-line fixes. Required:
1. Restore `"PR! +X kg (was Y kg)"` template — keep the existing verdict copy.
2. Align `computePrsThisWeek` signature to `{rows, currentWeekStartIso, currentWeekEndIso}`.
3. Pin minors A-F or accept as known debt.
