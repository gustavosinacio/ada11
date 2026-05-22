# Review v1 — 2026-05-22_0030_progress-page

Reviewing: the diff for the implementation against `design-v3.md` (validator `go`, 3 minors).

## Diff scope
- Diff command: `git diff b76970eb7c6cf428cbb3e0f776b63c1d4d115575...HEAD` (HEAD == baseline; all work is uncommitted in the working tree).
- Files changed (modified in working tree + untracked): 4 edited + 11 new = 15.
- Lines (edited only via `git diff --stat HEAD`): +161 / -21. New files add ~1,200 lines (math helpers + tests + UI).

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| BLK-3: `.not("completed_at", "is", null)` on BOTH branches of `listWeeklyVolumeRows` | yes | `src/api/stats.ts:56` (sinceUtc) + `src/api/stats.ts:79` (lifetime). |
| BLK-3: post-fetch null assertion throws | yes | `src/api/stats.ts:63-67` (sinceUtc) + `src/api/stats.ts:90-94` (lifetime). |
| BLK-3: `WeeklyVolumeRow.completed_at` narrowed to `string` | yes | `src/api/stats.ts:19`. |
| BLK-2: `denom = Math.max(model.maxKg, bestWeekKg ?? 0)` | yes | `src/components/weekly-volume-strip.tsx:120`. |
| BLK-2: history mount byte-identical (no props passed) | yes | `app/(app)/history/index.tsx:48` calls `<WeeklyVolumeStrip />` with no props. When `bestWeekKg` is undefined, `denom === model.maxKg` and `showOverlay === false` (`weekly-volume-strip.tsx:121`). The new `relative` class on the bar-row View (line 141) has no visual effect without an absolutely-positioned child. |
| BLK-2: dotted overlay y-position uses same `denom` | yes | `src/components/weekly-volume-strip.tsx:122-126`. |
| MAJ-4: `listSetsThisWeek` and `ThisWeekSetRow` not present | yes | `src/api/progress-page.ts` exports only `listFinishedSessionStartedAts` (1 function). |
| MAJ-4: `useExercisesThisWeek` derives from `useLifetimeWeeklyVolume + useAllExercises` | yes | `src/hooks/use-progress-page.ts:164-247`. No new query, just `useMemo`. |
| MAJ-4: `computeLifetimeMaxPerExercise` and `computePrExerciseIdsThisWeek` exist | yes | `src/utils/progress-page-math.ts:160-184` and `:204-253`. |
| MAJ-4: PR semantics — first-ever session is NOT a PR (`priorMax > 0`) | yes | `src/utils/progress-page-math.ts:242`. |
| MAJ-4: PR semantics — single-prior beat IS a PR | yes | tests #23 (`progress-page-math.test.ts:432-450`) and #24 (`:452-470`). |
| Cache namespace: all keys under `["stats", …]` | yes | `use-stats.ts:23,44` and `use-progress-page.ts:107`. `["stats"]` cascade in `use-sessions.ts:62/108/121` confirmed. |
| Pagination loop matches design pseudocode | yes | `src/api/stats.ts:72-89`: `while (true)`, `.range(from, from+PAGE-1)`, `if (page.length < PAGE) break; from += PAGE`. |
| `muscles[0]` grouping; empty → "Other"; multi → first only | yes | `src/utils/progress-page-math.ts:266-288` + tests #54 (`:950-955`), #55 (`:957-962`), #27 (`:579-583`), #26 (`:572-577`). |
| Soft-fallback streak (current-week-empty + last-week-qualified → trailing count) | yes | `src/utils/progress-page-math.ts:361-367` + test #32 (`:639-643`). |
| 5th tab added between History and Profile, `TrendingUp` icon | yes | `app/(app)/_layout.tsx:53-59`, between `history` (line 46-52) and `measurements` (line 60-63). `measurements` has `href: null` so visible order is History → Progress → Profile. |
| 56+ unit tests | yes | `npm run test:unit` → 59 tests in `progress-page-math.test.ts` (56 numbered + 3 supporting `computeCurrentWeekVolume`). 158 total green. |
| Tests #42-#45 (BLK-3 null filter) present | yes | `tests/unit/progress-page-math.test.ts:798-842`. |
| Tests #23-#24 (single-prior PR boundary) present | yes | `tests/unit/progress-page-math.test.ts:432-470`. |
| `useFinishedSessionStartedAts` `staleTime: 60_000` (MIN-9) | yes | `src/hooks/use-progress-page.ts:109`. |
| `npm run typecheck` clean | yes | re-ran; no output. |
| Deviation #1 (`findBestWeek` label via Jan-4 reverse-derivation) | yes | `src/utils/progress-page-math.ts:106-117`. Pure, deterministic. Acceptable. |
| Deviation #2 (`computeCurrentWeekVolume` extracted) | yes | `src/utils/progress-page-math.ts:127-142` + 3 tests in `progress-page-math.test.ts:1003+`. Pure, tested. Acceptable. |

## Issues

### Blockers
None.

### Majors
None.

### Minors

- **[MIN-1]** `src/hooks/use-progress-page.ts:6,9`: duplicate import block from `~/db/types` (`type MuscleGroup` on line 6, value `MUSCLE_GROUPS` on line 9 — two separate import statements for the same module path). Fix: combine into a single `import { MUSCLE_GROUPS, type MuscleGroup } from "~/db/types";` and place it where alias imports are alphabetized (currently between `~/api/progress-page` and `~/hooks/use-exercises`). Cosmetic; lints clean today but trips the project's "imports follow project style" convention.

- **[MIN-2]** `src/hooks/use-progress-page.ts:67-87`: `usePrsThisWeek` exports an additional `prIds: Set<string>` field not declared in the design contract (design-v3.md:367 says `{ data: number; isLoading; isError }`). Only consumer (`progress-hero.tsx:26`) reads `prsQ.data`; `prIds` is dead surface. Not declared in `implementation.md` §"Deviations from design". Fix: either delete the field and revert to `{ data: number; isLoading; isError }` (preferred — restores the design contract), or document the deviation. Behaviour is unaffected.

- **[MIN-3]** `src/utils/progress-page-math.ts:74-93`: the comment block inside `findBestWeek` narrates a wandering thought process ("we accept that we can't perfectly invert without a sample Date", "we keep a second pass via `bucketLifetimeWeeklyVolumes` is impractical") rather than the *why* of the final choice. The chosen algorithm (Jan 4 anchor + week-1 Monday + weekly offset) is correct and elegant; the prose around it should say so in one line and remove the false-start narration. Fix: replace lines 74-93 with a single comment like `// Reverse the ISO-week key via Jan 4 (always in ISO week 1) + (week-1)*7 days. Local-tz Monday matches every other ISO-week label in the app.` Style only.

## Security checklist
- [x] **RLS**: all new queries land on existing RLS-protected tables (`sets`, `sessions`, `exercises`). No new tables; no new policies needed.
- [x] **Secrets**: no `SUPABASE_SERVICE_ROLE_KEY` or service-role token referenced in any new/edited file under `app/` or `src/`. Grep clean.
- [x] **Input handling**: no `.rpc()` calls in any new/edited file. All queries are PostgREST filter chains with parameterized values (`.gte`, `.is`, `.not`, `.neq`, `.range`).
- [x] **Public env vars**: no new `EXPO_PUBLIC_*` references.

## Style / convention checklist
- [x] No new `any`. `grep -E ": any\b|<any>|\bas any\b"` clean across all touched files.
- [x] No new `// @ts-ignore` / `@ts-expect-error`.
- [x] Comments narrate *why*, not *what* — with one exception flagged as MIN-3 (`findBestWeek` block).
- [x] Imports follow project style — one minor exception flagged as MIN-1 (split imports from `~/db/types`).
- [x] New files placed in conventional folders: `src/api/`, `src/hooks/`, `src/utils/`, `src/components/`, `app/(app)/progress/`, `tests/unit/`, `tests/e2e/`. All correct.

## Decision

**pass**

Reasoning:
- All three validator-flagged blockers/majors (BLK-3, BLK-2, MAJ-4) from the v2 round are correctly folded into the diff and verified at `file:line` against design-v3.md.
- Validator-v3 minors (MIN-10/11/12) are addressed in `implementation.md` §"Surfaced validator-v3 minors" — `endOfWeek` is imported at `use-progress-page.ts:2`; the O(N) post-fetch assertion runs once per cold lifetime fetch (cheap); MIN-12 hook tests #53-#56 ship at the pure-helper level with a documented rationale.
- Two declared deviations (`findBestWeek` label derivation, extracted `computeCurrentWeekVolume`) are correctness-preserving and tested. No undeclared behavioural deviations.
- 158/158 unit tests pass. Typecheck clean. No security findings.
- Three minor issues (duplicate import block, undocumented `prIds` field, verbose `findBestWeek` comment block) are pure style — none block the decision.
- Counts: `{ blockers: 0, majors: 0, minors: 3 }` → pass per `.claude/agents/reviewer.md` rule (≤1 major).

Recommendation to Conductor: `invoke Tester`. The three minors can be folded into the next implementer pass post-Tester, or recorded as debt in `retro.md`.
