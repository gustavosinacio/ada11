# Validation v2 — 2026-05-22_0030_progress-page

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## v1 issues — verification

| Issue | v2 fix | Verified |
|---|---|---|
| BLK-1 (cache key collision) | Option (a) namespace `["stats", "progress-page", …]`; existing `["stats"]` prefix cascade catches all. | ✓ `use-sessions.ts:62/108/121` + `use-sets.ts:48/60/71/86` all invalidate `["stats"]`. |
| BLK-2 (chart denominator) | `denom = max(model.maxKg, bestWeekKg ?? 0)`. History byte-identical when `bestWeekKg` undefined. | ✓ Math holds; 3 new tests listed. |
| MAJ-1 (pagination pseudocode) | Inline `while(true) { range(from, from+PAGE-1); if (page.length<PAGE) break }`. | ✓ + correct precedent doc cited. |
| MAJ-2 (embedded filter) | `.gte("completed_at", weekStart).lte("completed_at", weekEnd)` on sets table. | ✓ Matches `stats.ts:29` idiom. |
| MAJ-3 (single-prior PR boundary) | Tests #23 and #24 added. | ✓ Both in plan. |
| MIN-1..7 | All acknowledged inline. | ✓ |

**All v1 blockers and majors are fixed in v2.**

## New issues found in v2

### Blockers

- **[BLK-3] Lifetime branch will crash on unchecked sets in finished sessions.** Location: design-v2 lifetime-branch query (`listWeeklyVolumeRows` with `sinceUtc` omitted).
  - **Fact**: existing `stats.ts:29` uses `.gte("completed_at", sinceUtc)` which implicitly excludes `completed_at IS NULL` rows (PostgreSQL: `NULL >= '...'` evaluates to NULL → row dropped). v2's lifetime branch drops that filter for the unbounded read but does NOT add `.not("completed_at", "is", null)` as compensation.
  - **Crash path**: `SetRow.completed_at: string | null` (`src/db/types.ts:124`). `finishSession` (`sessions.ts:62-71`) only stamps `ended_at`; it does NOT auto-stamp `completed_at` on remaining unchecked sets — those persist with `completed_at = null` in finished sessions. The lifetime read returns them; downstream `weekly-volume-strip.tsx:44` calls `weekKeyOf(parseISO(row.completed_at))`; `parseISO(null)` returns `Invalid Date`; `format(Invalid Date, "RRRR-'W'II")` throws `RangeError: Invalid time value`. Crash inside React render → ErrorBoundary or app crash on the Progress page.
  - **Suggested fix**: add `.not("completed_at", "is", null)` to BOTH branches of `listWeeklyVolumeRows`. Add a unit test asserting null-`completed_at` rows are excluded from bucketing. Defensive: apply the same filter to `listSetsThisWeek` even though that branch is currently safe via `.gte("completed_at", ...)`.

### Majors

- **[MAJ-4] `useExercisesThisWeek` data source not pinned.** Design-v2 says "via `listSetsThisWeek` OR derive from lifetime rows filtered client-side — Implementer call; default = derive from lifetime rows to save a round-trip".
  - Either path is workable but Implementer must not be left guessing. The lifetime-row payload carries `exercise_id` but not `name`/`muscles`/`deleted_at` — those would come from `useAllExercises`. If the Implementer derives, `listSetsThisWeek` becomes dead code in the spec.
  - **Suggested fix**: pin one path. Recommendation: derive from lifetime rows + `useAllExercises` join (saves a round-trip; fewer moving parts) and drop `listSetsThisWeek` from the API. If kept, document why both surfaces coexist.

### Minors

- **[MIN-8]** File-ordering description in Mudanças por arquivo says "between `history` and `measurements`" but `measurements` is `href: null` (hidden). Visible neighbor after History is Profile. Imprecise prose; fix to "between History and Profile in tab order (source order is alphabetical)".
- **[MIN-9]** `staleTime: 60_000` is specified for `useLifetimeWeeklyVolume` but not for `useFinishedSessionStartedAts`. Pin to `60_000` for consistency.

## Decision

**`no-go`**

Reasoning:
- v1 blockers/majors all fixed.
- **BLK-3** is a real crash bug (not hypothetical) — instant any user with an unchecked set in any finished session opens Progress, the app crashes inside React render.
- MAJ-4 is a real ambiguity that will cost an Implement-time decision and likely a re-spin.

Round 2 of 3 D↔V used. 1 round remaining. v3 should be tight: 4 small fixes.

## Counts

`{ blockers: 1, majors: 1, minors: 2 }`

## Recommendation to Conductor

`invoke Designer for re-design (v3)`. Required v3 fixes:
1. (BLK-3) Add `.not("completed_at", "is", null)` to both branches of `listWeeklyVolumeRows`; add a unit test for null-`completed_at` filtering; apply defensively to `listSetsThisWeek` too.
2. (MAJ-4) Pin the `useExercisesThisWeek` derivation path (recommend: derive client-side from lifetime + `useAllExercises`); drop `listSetsThisWeek` if not used.
3. (MIN-8) Fix the file-ordering phrasing.
4. (MIN-9) Add `staleTime: 60_000` to `useFinishedSessionStartedAts`.
