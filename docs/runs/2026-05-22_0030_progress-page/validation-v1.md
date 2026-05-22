# Validation v1 — 2026-05-22_0030_progress-page

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## Verification of Designer's claims (summarised)

Most factual claims verified against the codebase. Key correct claims:
- `WeeklyVolumeRow` is consumed only by `stats.ts`, `use-stats.ts`, `weekly-volume-strip.tsx`. Augmenting it doesn't break test imports (tests use a narrow inline `Row`).
- `weekly-volume-strip.tsx:114-117` height formula = `(b.totalKg / model.maxKg) * PLOT_HEIGHT`.
- `useFinishSession` invalidates `["stats"]` + `["progress"]` (prefix cascade).
- `exercises.muscles` schema allows empty arrays → `"Other"` fallback is reachable, not dead code.
- `volume-target.ts:124-126` correctly returns `no-pr` when `previousMaxKg === 0`.
- 7 existing tests in `weekly-volume-bucketing.test.ts`; bottom-tab layout has 2 hidden tabs already via `href: null`.

## Issues found

### Blockers

- **[BLK-1] Cache key collision.** Designer asserts new `["progress-page", ...]` keys are covered by `useFinishSession`'s `qc.invalidateQueries({ queryKey: ["progress"] })` cascade. **This is false.** TanStack matches by tuple-element equality — the literal `"progress-page"` is a distinct string from `"progress"`. After Finish, `useExercisesThisWeek` and `usePrsThisWeek` would NOT auto-refresh; the Hero count and per-exercise list show stale data until pull-to-refresh or 60s `staleTime` expiry.
  - **Suggested fix (pick one):** (a) move every Progress-page-only key under `["stats", "progress-page", …]` so the existing `["stats"]` cascade catches them all; (b) extend `useFinishSession` + `useUpdateSessionTimes` + `useSoftDeleteSession` + `useStartSession` to also `invalidateQueries({ queryKey: ["progress-page"] })`. Pin the exact call sites in v2.

- **[BLK-2] Dotted overlay line y-position uses the wrong denominator.** Designer's `<WeeklyVolumeStrip>` overlay computes y as `(bestWeekKg / model.maxKg) * PLOT_HEIGHT` where `model.maxKg` = 8-week max. When the lifetime best falls OUTSIDE the visible 8-week window (the common case), `bestWeekKg > model.maxKg`, producing y > PLOT_HEIGHT → line renders above the plot box. The chart breaks in exactly the case it's meant to communicate ("you're behind your lifetime best").
  - **Suggested fix:** rescale bar heights against `Math.max(model.maxKg, bestWeekKg ?? 0)` so the lifetime best lives at the top of the plot and current bars become proportionally shorter. Position the overlay at `PLOT_HEIGHT - PLOT_HEIGHT = 0` (top edge) when lifetime best is the ceiling. Add a unit test for the new max-aware ratio.

### Majors

- **[MAJ-1] Pagination "verbatim from `scripts/import-strong.ts:38-58`"** — that file was deleted in run `2026-05-21_2330_strong-import-setnumber`. The pattern lives only in prose at `docs/runs/2026-05-20_0127_import-strong-csv/regression-report.md`. Implementer cannot lift it verbatim; they'll reconstruct it. Suggested fix: spell out the algorithm in design-v2 with concrete loop pseudocode (`from = 0; while (true) { range(from, from+PAGE-1); if (rows.length < PAGE) break; from += PAGE }`).

- **[MAJ-2] `.gte("sessions.started_at", ...)` on embedded resource is unverified.** No precedent in this codebase. Supabase JS usually requires `referencedTable` arg (`{ referencedTable: "sessions" }`) or URL syntax for embedded filters. Suggested fix: replace with `.gte("completed_at", weekStartIso).lte("completed_at", weekEndIso)` on the `sets` table directly. Semantically equivalent for finished sessions in the same week, and uses the verified pattern from `src/api/stats.ts:29`.

- **[MAJ-3] Missing single-prior-session PR boundary test.** The test plan covers "no prior" (no-PR) and "two prior sessions" but not the boundary case: "exactly one prior session at X, current week beats it → PR". This is the off-by-one most likely to slip in during refactors. Suggested fix: add `"One prior session at 500, current week at 600 → 1 PR"` and `"One prior at 500, current at 400 → 0 PRs"` to `progress-page-math.test.ts`.

### Minors

- **[MIN-1]** Design references a `mkRow` factory in `weekly-volume-bucketing.test.ts` that doesn't exist (file uses an inline narrow `Row`). The augmentation doesn't break the test; clarify in v2 that no edit is needed.
- **[MIN-2]** Streak: spec the "Sunday 23:59, no sessions this week, last week empty too" edge case explicitly. The rule "current streak resets only when the empty week ENDS" is implicit; lock it with a test docstring.
- **[MIN-3]** Cold-start latency claim "~2.5 s" is unmeasured. Augmentation adds ~30% payload (UUID columns). Suggested: benchmark once on real account during Implement; document fallback trigger (>5 s → swap to Option B Postgres aggregate).
- **[MIN-4]** Pin the exact query key for `listFinishedSessionStartedAts` (e.g., `["sessions", "started-ats", "lifetime"]`).
- **[MIN-5]** Loading-state composition: hero + chart + list + streak all have independent queries. Cold paint can show partial loading. Spec: skeletons per block (matches `<WeeklyVolumeStrip>` precedent).
- **[MIN-6]** On the Progress page, `<WeeklyVolumeStrip>` still issues its own 8-week query in parallel with the new lifetime read. Acceptable; document it in v2 so the Implementer doesn't re-architect.
- **[MIN-7]** `findBestWeek` tie behaviour: server-side sort by `completed_at ASC` means older week wins on ties. Pin desired behaviour in v2 (oldest or newest) and test.

## Decision

**`no-go`**

Reasoning:
- 2 blockers (cache cascade lie + chart y-axis denominator) → must be fixed before Implement.
- 3 majors (dead-pointer pseudocode, unverified embedded filter, missing boundary test) → all easy to absorb but explicit fixes needed.
- 7 minors absorbable in implementation.

Decision rule: any blocker → no-go. Round 1 of 3 D↔V budget; 2 rounds remaining.

## Counts

`{ blockers: 2, majors: 3, minors: 7 }`

## Recommendation to Conductor

`invoke Designer for re-design (v2)`. Provide the blocker + major list explicitly. Conductor should require:
- (BLK-1) explicit cache-key namespace decision + exact call sites to edit
- (BLK-2) concrete max-aware height formula + new unit test
- (MAJ-1) inline pagination pseudocode
- (MAJ-2) switch to `.gte("completed_at", ...)` on sets table
- (MAJ-3) add the single-prior-session boundary tests
