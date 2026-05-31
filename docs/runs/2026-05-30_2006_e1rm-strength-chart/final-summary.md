# Final summary — 2026-05-30_2006_e1rm-strength-chart

## Outcome
- **Feature**: Phase 2a — an "Estimated 1RM per exercise" strength-progress chart on the Progress page. A multi-line chart (reusing `<MultiSeriesChart>`) plotting each top-N exercise's best e1RM per ISO week over time, auto-populated with the owner's most-performed (weighted) exercises, with selectable lines + check-all/uncheck-all. The strength complement to the Phase 1 weekly per-muscle volume chart.
- **Pipeline result**: **shipped** (Tester PASS on the final round; all static gates green).
- **Branch / final commit**: `main`, baseline `3c00d8e` (the Phase 0/1 commit). Phase 2a changes uncommitted at summary time — Conductor commits next.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (Tester verified live: Bench Press e1RM line renders as an SVG polyline trending UP — e1RM 105→116.67 as weight 90→100 kg over 2 weeks; selectable lines + check-all work; bodyweight-only user correctly produces NO e1RM line) |
| Human interventions during run | 0 |
| Total round-trips (sum of all loops) | D↔V ×1, I↔R ×1, I↔T ×2 |
| Design ↔ Validate rounds | 1 (GO; 1 new major caught — e2e false-green risk — carried as a must-fix) |
| Implement ↔ Review rounds | 1 (PASS first round) |
| Implement ↔ Test rounds | 2 (round 1 FAIL: adjacent test-locator regression from the new legend chip; round 2 PASS) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~01:20 (20:06 → ~21:25 BRT) |
| Token cost (if known) | n/a |

## What shipped (scope)
- **New** `src/utils/e1rm-strength.ts`: pure `presentTopExerciseE1rm(args)`. Ranks top-5 eligible exercises by distinct sessions (deterministic 4-key tie-break), computes best e1RM per (exercise, week) via the existing `epley1RM` on LOGGED weight, LOCF-fills untrained weeks.
- **New** `src/components/e1rm-strength-section.tsx`: section mirroring `<WeeklyMuscleVolumeSection>` (id-keyed selection, check-all/uncheck-all, `opacity-40` OFF chips, palette-by-rank, `formatWeight` y-ticks). Reuses `<MultiSeriesChart>` AS-IS. No `useMeasurements` (Invariant D).
- **Edited** `app/(app)/progress/index.tsx`: mounts `<E1rmStrengthSection />` after `<WeeklyMuscleVolumeSection />`; stale docstring refreshed.
- **Edited** `tests/e2e/progress-page.spec.ts`: round-2 test-only locator fix (see below).
- **Tests**: +13 unit (431→444) covering Invariants D (logged-weight), E1 (MAX-not-sum), LOCF carry-forward + leading flat lead-in, eligibility-before-ranking, top-N + determinism; new e2e (3/3) seeding a weighted exercise for a visible line + a bodyweight negative case.

## Key decisions
- **Per-WEEK x-axis** — the only shape that aligns multiple exercises on `<MultiSeriesChart>`'s shared index without extending the component.
- **Untrained weeks = carry-forward (LOCF), NOT zero-fill** — the subtlest call: a 0 for a peak metric like e1RM is false (you didn't get weaker to zero on a rest week) and would crash the line to the axis. Holds the last tested value; leading weeks take the first real value (flat lead-in). Strength-decay modeling deferred.
- **e1RM stays LOGGED-weight (Invariant D)** — consistent with Phase 0: a 0-weight bodyweight set produces no e1RM point; bodyweight-only exercises plot no line and (eligibility-before-ranking) can't claim an invisible top-N slot.
- **MAX per (exercise, week), not sum (Invariant E1)** — e1RM is a peak metric.
- **Reused `<MultiSeriesChart>` and `epley1RM` as-is** — `progress.tsx` deliberately NOT refactored (no dedup benefit; e1RM was already centralized — Discovery confirmed exactly 2 sites).

## Gate results (Tester-observed, final round)
- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors, 1 pre-existing warning (`.expo/types/router.d.ts`).
- `npm run test:unit` — 444/444 (27 files).
- `npx playwright test tests/e2e/e1rm-strength.spec.ts` — 3/3.
- `npx playwright test tests/e2e/progress-page.spec.ts` — 8/8 (the round-1-regressed #4 now green).

## The round-1 regression (closed)
The new e1RM legend chip renders the exercise name earlier in the DOM, which broke `progress-page.spec.ts:278`'s fragile `getByText(name).first()` (it bound to the chip, not the navigable row). Proven a real feature-interaction via stash-to-baseline replay. Fix is test-only: target the navigable row by role + accessible name (`{ name: "<name>, view progress" }`) — the pattern the file's own test #8 already used. Feature code unchanged. Closed and re-verified live (8/8).

## Out of scope (tracked in `docs/features.md` "## Open")
- **Favorites (Phase 2b)** — favorite toggle on the exercise detail page + per-user `user_exercise_favorites(user_id, exercise_id)` join table + RLS. This run was auto-selection ONLY.
- Bodyweight leverage factors; secondary-muscle attribution; "hard sets/week" dose metric; per-session x-axis; non-zero y-min / true-gap `<MultiSeriesChart>` extension; strength-decay modeling across long untrained gaps.

## Artifacts
- [`state.md`](./state.md), [`discovery.md`](./discovery.md), [`design-v1.md`](./design-v1.md), [`validation-v1.md`](./validation-v1.md), [`implementation.md`](./implementation.md), [`review-v1.md`](./review-v1.md), [`test-report-v1.md`](./test-report-v1.md), [`test-report-v2.md`](./test-report-v2.md), [`transcript.md`](./transcript.md)
- `screenshots/` (rendered e1RM line + full-page)

## Bugs found post-merge (backfill within 7 days)
- (none yet)

## Notes
- Owner data gut-check (carried from the prior batch) still pending: glance at the Progress page on real data to confirm the bodyweight-volume numbers + the new e1RM lines read right.
- Pre-existing `chart-scroll-week-selector.spec.ts` failures remain out of scope (proven pre-existing in the prior run).

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-30_2006_e1rm-strength-chart/` on 2026-05-30 ~21:25 BRT.
