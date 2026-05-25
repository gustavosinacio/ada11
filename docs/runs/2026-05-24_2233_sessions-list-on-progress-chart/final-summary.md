# Final summary — 2026-05-24_2233_sessions-list-on-progress-chart

## Outcome
- **Feature**: Sessions list on the per-exercise progress chart screen. The `/exercises/{id}/progress` screen now appends a "SESSIONS" section below the Total volume chart, showing each session (date + `N × VOLUME` aggregate). DESC (newest first). Tap-through to `/history/{sessionId}`.
- **Pipeline result**: **shipped**
- **Branch / baseline**: `main` / `06dd4217f61e62b327d8606ba27f5f53808efae8`

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (3/3 new e2e + regression sweep + screenshot) |
| Human interventions | 0 |
| Total round-trips | 4 (2 D↔V + 1 I↔R + 1 I↔T) |
| D↔V rounds | 2 (round 2 → go) |
| I↔R rounds | 1 (pass) |
| I↔T rounds | 1 (pass) |
| Soft callbacks | 0 |
| Wall-clock | ~52 min (22:33 → 23:25 BRT) |

## Validator catches

### Round 1 (no-go, 1 blocker + 2 majors + 6 minors)
- **BLK-1**: aggregate regex `^\d+ × [\d,]+ kg$` hardcoded `kg` → fails lbs mode. v2: `(kg|lbs)` + explicit lbs e2e case.
- **MAJ-1**: same-day a11y label collision (`"Open session from Thu, May 14"` for both morning + evening sessions). v2: a11y label uses `includeTime: true` while visible date stays time-less.
- **MAJ-2**: section header styling diverged from existing `SECTION_HEADER` precedent at `history/week/[isoWeek].tsx:20-21`; horizontal alignment (`px-4` row vs `px-6` ambient) produced a visible jog. v2: inlined `SECTION_HEADER` literal classes + dropped row `px-4`.

### Round 2 (go, 3 polish minors)
- All 1 blocker + 2 majors closed file:line. 3 new polish minors: doc inaccuracy on rejected alt rationale, RNTL→Playwright tooling translation, warmup-only session edge case (handled gracefully via empty `volumeLabel`).

## Files touched

### New
- `src/utils/exercise-session-row-format.ts` — pure presenter `presentExerciseSessionRow({sets, unit}): {count, volumeKg, volumeLabel}`. JSDoc explains why parts are returned (unit-test ergonomics + future per-set line).
- `src/components/exercise-session-row.tsx` — `<ExerciseSessionRow>` with `includeTime: true` a11y label.
- `tests/unit/exercise-session-row-format.test.ts` — 7 vitest cases including warmup-only edge.
- `tests/e2e/exercise-session-row-list.spec.ts` — 3 Playwright cases including lbs mode.

### Edited
- `src/utils/volume-target.ts` — `function sumPastVolume` → `export function sumPastVolume` (single-line, no behavior change).
- `app/(app)/exercises/[id]/progress.tsx` — added `sessionsDesc` memo (`[...progressQ.data].reverse()`) and new SESSIONS section inside the `e1rmData.length > 0` truthy branch (preserves 3 pinned empty-state assertions). Section header uses inlined `SECTION_HEADER` literal with cross-screen sync comment.

**Diff size**: +44/-17 lines on 2 production files; +~480 lines new helper/component + tests.

## Quality gates
- Typecheck: clean.
- Lint: 0 errors, 1 pre-existing warning (`router.d.ts`).
- Unit tests: 354/354 pass (+7 new vs prior 347).
- E2E new: 3/3 pass.
- E2E regression: `read-only-history` 5/5 + `max-volume-window` 6/6 green.
- Visual: long-page screenshot pinned at `screenshots/progress-long-page.png`.

## Cross-screen evidence
- Row aggregates cross-check against Total volume chart points within rounding.
- Same-day a11y labels differ via time-of-day (`"Open session from Sun, May 24, 10:22 PM"` vs `"…5:22 PM"`).
- Soft-deleted exercise still renders the list (screen mounts via `useAllExercise(id)`).
- Empty exercise (no sessions) → section not rendered (existing empty-state gate).

## Pre-existing flakes flagged by Tester
- 2 in `exercise-progress-ia.spec.ts` and 4 in `progress-page.spec.ts` — verified pre-existing on baseline commit `06dd421` via git stash replay. Root cause: live workout flow now routes to `/workout/verdict/{id}` after Finish (commit `4871d33`); specs still wait for `/workout$`. Same flakes as F3/F4/F6/F7 runs surfaced. Separate stabilization pass warranted.

## Why we stopped
Not escalated. Budgets at end: D↔V 1/3, I↔R 1/2, I↔T 1/2, soft-callbacks 2/2.

## Artifacts
- state, discovery
- design-v1 → superseded
- validation-v1 → no-go (1/2/6)
- design-v2 ← shipped
- validation-v2 → go (0/0/3)
- implementation, review-v1 (returned inline), test-report-v1 → pass
- transcript
- `screenshots/progress-long-page.png`

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-24_2233_sessions-list-on-progress-chart/` on 2026-05-24.
