# Validation v1 — 2026-05-23_0211_configurable-max-volume-window

Reviewing: `design-v1.md`.

## Verification of Designer's claims

| Claim | Verified? | Evidence |
|---|---|---|
| `0008_max_volume_window.sql` is the next free migration number | **NO** | `supabase/migrations/0008_sets_unique_set_number.sql` already exists. Next free is `0009`. |
| `seed_new_user()` omits the new column → DEFAULT applies, no rewrite needed | yes | `supabase/migrations/0001_rls_and_seed.sql:55` inserts only `(user_id, weight_unit)`. |
| Drizzle schema already imports `integer` | yes | `src/db/schema.ts:6` |
| `useLifetimeBestWeek`, `usePrsThisWeek`, `useExercisesThisWeek` consume the lifetime dataset | yes | `src/hooks/use-progress-page.ts:38, 88, 198` |
| `computePrsThisWeek` uses `started_at` for the in-week check | yes (contradicts design's `completed_at` filter — see MAJ-1) | `src/utils/progress-page-math.ts:248-249, 266` |
| Length-unit row uses the segmented `flex-1 rounded-md py-2` pattern | yes | `app/(app)/profile.tsx:53, 95` (2 segments) |
| `computeVolumeTarget` operates on `SessionSets[]` with `started_at` | yes | `src/api/progress.ts:4-8` |
| `["stats"]` invalidation cascade picks up window-driven re-derivation via `useMemo` deps | yes (with `new Date()` dep-stability caveat) | `src/hooks/use-progress-page.ts:39-43, 89-115, 205-288`; `useSetLengthUnit` precedent at `use-preferences.ts:33-39` |
| 5 surfaces all wire through | yes | all 5 call sites verified in design |
| Per-exercise progress chart (`bestE1rm`) intentionally out of scope | partial | Verified separate kernel at `app/(app)/exercises/[id]/progress.tsx:54-93`. Defensible deferral; see MIN-1. |
| `bestWeekKg` prop is optional | yes | strip caller in `app/(app)/progress/index.tsx:50` provides; history caller does not |
| Default `0 = lifetime` preserves existing tests via `windowStartIso = undefined` | yes | spot-checked `progress-page-math.test.ts` cases #1-#9, `computePrsThisWeek` opts shape, `computeVolumeTarget` input shape |
| `subWeeks` from `date-fns` is available | yes | `src/utils/dates.ts:7, 65` |
| `isoWeekStart` returns local Monday 00:00 (not UTC) | yes | `src/utils/dates.ts:40-42` |
| Monday-of-week minus N weeks derivation (for `now=2026-05-23 Sat W21`, N=10 → Mon `2026-03-09` W11; set `[W11..W20]`) | yes | manual ISO-week math confirmed |
| ISO-string lexicographic compare equals chronological compare on production data | **NO** | `docs/runs/2026-05-20_0127_import-strong-csv/regression-report.md:35` documents this trap: PostgREST returns `+00:00`, `Date.toISOString()` returns `Z`. See BLK-2. |
| RLS unchanged is correct | yes | policies are column-agnostic `auth.uid() = user_id` |

## Issues found

### Blockers

- **[BLK-1] Migration filename collision.** Design proposes `supabase/migrations/0008_max_volume_window.sql`, but `0008_sets_unique_set_number.sql` already exists. Fix: rename to `0009_max_volume_window.sql`.

- **[BLK-2] Lexicographic string compare on heterogeneous ISO timestamps is incorrect.** Design's "Filter predicate (uniform across kernels)" section and Performance subsection claim *"ISO-8601 strings sort lexicographically the same as chronological order, so we compare strings directly."* This is **false for production data shape**: `WeeklyVolumeRow.completed_at` and `SessionRow.started_at` arrive from PostgREST as `YYYY-MM-DDTHH:MM:SS+00:00`, while `new Date(...).toISOString()` returns `YYYY-MM-DDTHH:MM:SS.sssZ`. Comparing `"2026-03-09T03:00:00+00:00"` (row) with `"2026-03-09T03:00:00.000Z"` (windowStartIso) — both representing the same instant — the row is lexicographically LESS (`+` 0x2B < `.` 0x2E), so the row at the boundary is silently excluded. The codebase's own kernels (`weekly-volume-strip-math.ts:56`, `progress-page-math.ts:34, 133`, `use-progress-page.ts:214`) already use `parseISO(...).getTime()` for date math. The exact same bug was burned in the strong-csv import run — see `docs/runs/2026-05-20_0127_import-strong-csv/retro.md:20`. Fix: filter via `parseISO(row.completed_at).getTime() >= windowStartMs` where `windowStartMs = parseISO(windowStartIso).getTime()` is precomputed once per kernel call.

### Majors

- **[MAJ-1] Window field mismatch between kernels — splits sessions at week boundaries.** Design filters `computePrsThisWeek` rows by `row.completed_at`, but the existing kernel determines "in current week" via `s.startedAt` at `progress-page-math.ts:248-249, 266`. A late-evening session whose `started_at` falls in one ISO week and whose `completed_at` falls in the next is split — some rows enter `priorMax`, others don't, producing a fractional session-volume that does not correspond to any real session. Fix: filter at the **session aggregate** level (drop sessions whose `startedAt < windowStart`), not at the row level. Apply the same consistency rule to `computeLifetimeMaxPerExercise` (group rows into per-session aggregates first, then drop session aggregates outside the window). Pick one anchor per kernel and pin it in the design's Contracts section.

- **[MAJ-2] Profile segmented row will overflow on small phones.** Design adds 4 segments (`Lifetime` / `10w` / `20w` / `30w`) using the same `flex-1 rounded-md py-2` pattern that today has 2 segments. Back-of-envelope width on 320pt screen (iPhone SE/Mini): (320 − 80pt chrome − 24pt gaps)/4 = **54pt per segment**. The label `"Lifetime"` at `text-base font-medium` (16pt) needs ~62-68pt → wraps or clips. Fix options: (a) abbreviate `Lifetime → All`, (b) `flex-wrap` 2 × 2 grid, or (c) full-width row below the section title with `gap-1` and `text-sm`. Designer's choice; pin in the design.

### Minors

- **[MIN-1] Per-exercise progress chart deferral worth surfacing in copy.** `app/(app)/exercises/[id]/progress.tsx:54-93` shows `bestE1rm` over ALL sessions. User lands there after tapping a PR row from the hero accordion; mismatch between hero's windowed PR and chart's lifetime `Best est. 1RM` may confuse. Defensible (it's a detail screen, and the metric is e1RM not volume), but add a JSDoc note explaining the rationale.

- **[MIN-2] Hook name `useLifetimeBestWeek` becomes a misnomer.** Acceptable trade-off if avoiding 2 ripple sites; future reader greps for `Lifetime` and finds windowed logic.

- **[MIN-3] `useMemo` dep stability around `new Date()`.** Design flags this but punts to implementation. Concrete recipe: `useMemo(() => windowStartIsoForWeeks(weeks, new Date()), [weeks])` — calling `new Date()` inside the factory keeps deps to `[weeks]`. Pin in design.

- **[MIN-4] CHECK constraint vs typed enum drift.** Adding `52` (yearly) later requires 3 coordinated edits (migration + types + Profile row). Acceptable v1 trade-off; flag for future evolution.

- **[MIN-5] Copy string format risk on strip overlay caption.** `Best of last 30 weeks: 12,345 kg (May 11)` ~50 chars; verify wrap on smaller screens during Implement.

- **[MIN-6] Setter return-shape coupling.** Existing seed users all have a `user_preferences` row (per `0001_rls_and_seed.sql:55`); new column picks up `0` default on rewrite. Safe — flagging for Implementer's data checklist.

## Decision

**no-go**

Reasoning:
- Two blockers (filename collision; lexicographic ISO compare bug that the codebase has already burned itself on).
- Two majors (cross-anchor split; small-phone overflow) either of which would push to no-go.

Counts: blockers=2, majors=2, minors=6.

What Designer must address in v2:
1. Rename migration to `0009_max_volume_window.sql`.
2. Replace lexicographic ISO compare with `parseISO(...).getTime()` numeric compare across `bucketLifetimeWeeklyVolumes`, `computeLifetimeMaxPerExercise`, `computePrsThisWeek`, `computeVolumeTarget`. Precompute threshold once per kernel call.
3. Pick one time anchor per kernel; document the consistency rule. Recommend: in `computePrsThisWeek`, drop entire sessions whose `started_at < windowStart` AFTER per-session aggregation.
4. Address Profile-row overflow — pick one of the three options in MAJ-2.
5. Pin the `useMemo` recipe from MIN-3 in the Risks section.

Confidence: **HIGH** on BLK-1, BLK-2, MAJ-1 (direct file:line evidence + prior regression report for BLK-2). **MEDIUM** on MAJ-2 (back-of-envelope width math; a 320pt-simulator screenshot would confirm deterministically).
Risk if shipped as-is: **HIGH** — BLK-2 silently corrupts windowed PR detection at boundary instants; BLK-1 may fail migration apply; MAJ-1 produces incorrect prior-max values for late-night sessions.

Round 1 of ≤3. Recommendation: **invoke Designer for re-design (v2)**.
