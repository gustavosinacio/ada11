# Final summary — 2026-05-30_0126_bodyweight-volume-per-muscle

## Outcome
- **Feature**: Phase 0 — made the canonical volume kernel bodyweight-aware across every surface (bodyweight-equipment sets now contribute `(bodyweight-as-of-session + added load) × reps`); Phase 1 — added a "weekly volume per muscle group" multi-line chart to the Progress page and removed the per-session chart.
- **Pipeline result**: **shipped** (Tester PASS on the final round; all static gates green).
- **Branch / final commit**: `main`, baseline `5a2382b` (changes uncommitted in the working tree — owner to review + commit).

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (Tester verified live: weight=0 Chin-up + 80 kg prior weigh-in → 2,560 kg "Upper back" volume on chart + hero + strip; pre-feature 0) |
| Human interventions during run | 0 (2 design decisions were pre-confirmed by the owner before launch) |
| Total round-trips (sum of all loops) | 4 (D↔V ×2, I↔R ×1, I↔T ×2 — minus 1 overlap = 5 agent-iterations beyond the linear path) |
| Design ↔ Validate rounds | 2 (round 1 NO-GO: 2 majors; round 2 GO with 1 new major as a carry-in must-fix) |
| Implement ↔ Review rounds | 1 (PASS first round) |
| Implement ↔ Test rounds | 2 (round 1 FAIL: test-only — e2e seeded non-existent "Pull-up"; round 2 PASS) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~01:55 (01:26 → 03:21 BRT) |
| Token cost (if known) | n/a |

## What shipped (scope)
- **New** `src/utils/bodyweight.ts`: `effectiveWeightKg(equipment, weight, bodyweightKg)` (the single arithmetic seam; addend fires only on exact `equipment === "bodyweight"`; NaN-safe) + `bodyweightKgAsOf(measurements, instantMs)` (fallback: nearest PRIOR finite `weight_kg` → nearest LATER → null=0; UTC-instant compare; order-independent).
- **14 kernel sites** routed through `effectiveWeightKg` (incl. the 2 the original prompt missed — `computeStripModel`, the per-exercise inline reduce — and the 2 caught in validation/review — the week drill-down `weekVolumeKg`, and the History-list `groupSessionVolumes` caller). The single-kernel "same number everywhere" invariant now holds for bodyweight exercises too.
- `src/api/stats.ts` SELECT widened with `exercises!inner(equipment)`; `WeeklyVolumeRow` carries `equipment`. No migration (all columns pre-existed).
- **Phase 1**: new `<MultiSeriesChart>`, `presentWeeklyVolumeByMuscle` (ISO-week × `muscles[0]`, zero-filled shared axis, "Other" line, 7 fixed colors, no window pref), `<WeeklyMuscleVolumeSection>` (selectable lines + check-all/uncheck-all local state). Removed `SessionVolumeChartSection` + `presentSessionVolumeChart`; swapped the mount in `app/(app)/progress/index.tsx`.
- **Tests**: +47 unit (384 → 431), 2 new unit files, 5 extended, 1 new e2e spec (4/4). Regression Invariants A (non-bodyweight byte-for-byte), B (bodyweight PR create/erase), C (per-set-sum holds), D (e1RM stays logged-weight: 0-weight bodyweight set → volume point, NO e1RM point) all covered.

## Key decisions (owner pre-confirmed)
- Bodyweight-as-load applied **canonically** to every volume surface (not scoped to the new chart) — preserves the cross-surface consistency invariant; accepts that historical bodyweight PRs/max numbers shift retroactively.
- Chart uses **selectable muscle lines + check-all/uncheck-all** (not stacked area / small multiples).
- e1RM intentionally stays logged-weight (NOT bodyweight-adjusted) — Invariant D.
- Admin session-detail total stays non-bodyweight (it views other users' sessions; admin's own measurements would be the wrong bodyweight).

## Gate results (Tester-observed, final round)
- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors, 1 pre-existing warning (auto-generated `.expo/types/router.d.ts`).
- `npm run test:unit` — 431/431 (26 files).
- `npx playwright test tests/e2e/weekly-muscle-volume.spec.ts` — 4/4.

## Known pre-existing issue (NOT introduced by this run)
- `tests/e2e/chart-scroll-week-selector.spec.ts` — 2/4 failing (a "View week of 5/25" date-label assertion). Proven pre-existing by the Tester via `git stash` to baseline `5a2382b` (identical failure reproduced). Out of scope for this feature; should be filed/fixed separately.

## Out of scope (tracked in `docs/features.md` "## Open")
- Bodyweight leverage factors (push-up ≈ 0.64 BW). Secondary-muscle fractional attribution. e1RM strength chart + favorites. "Hard sets per muscle/week" dose-metric revisit. Chart-local window selector.

## Artifacts
- [`state.md`](./state.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md), [`design-v2.md`](./design-v2.md)
- [`validation-v1.md`](./validation-v1.md), [`validation-v2.md`](./validation-v2.md)
- [`implementation.md`](./implementation.md)
- [`review-v1.md`](./review-v1.md)
- [`test-report-v1.md`](./test-report-v1.md), [`test-report-v2.md`](./test-report-v2.md)
- [`transcript.md`](./transcript.md)
- `screenshots/` (muscle-volume-section, tester-bodyweight-upperback-line, round-2 confirm)

## Bugs found post-merge (backfill within 7 days)
- (none yet — owner updates as bugs surface)

## Notes
- Owner still to: review the working-tree diff and commit; optionally file the pre-existing chart-scroll-week-selector failure separately.

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-30_0126_bodyweight-volume-per-muscle/` on 2026-05-30 03:21 BRT.
