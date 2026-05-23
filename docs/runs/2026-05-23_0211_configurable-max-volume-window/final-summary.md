# Final summary — 2026-05-23_0211_configurable-max-volume-window

## Outcome
- **Feature**: Configurable max-volume window — user picks `All / 10w / 20w / 30w` in Profile; the choice flows uniformly into the Progress hero, weekly volume strip overlay, exercises-this-week list, end-of-session verdict PR detection, and live-workout volume-target strip.
- **Pipeline result**: **shipped**
- **Branch / final commit**: `main` / pending (work tree dirty; commit owned by user)
- **Baseline commit**: `688e3422f470dcd668a7fcdce09fd0c5135aa1e5`

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (6 new e2e scenarios + regression sweep all green) |
| Human interventions during run | 0 |
| Total round-trips (sum of all loops) | 4 (2 D↔V + 1 I↔R + 1 I↔T) |
| Design ↔ Validate rounds | 2 (round 2 → go) |
| Implement ↔ Review rounds | 1 (pass first try) |
| Implement ↔ Test rounds | 1 (pass first try) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~03:15 (02:11 → 05:25 BRT) |
| Token cost (if known) | n/a |

## Decisions of record (the 10 unknowns from Discovery)

1. **Uniform window** across all 5 surfaces (hero, strip overlay, exercises list, verdict, live target).
2. **Allowed values**: `[0, 10, 20, 30]` literal (prompt-faithful). `0 = lifetime / "All"`.
3. **Default**: `0` (lifetime). Opt-in, zero behaviour change for existing users.
4. **Semantics**: last N weeks **excluding** current week. `windowStartMs = parseISO(subWeeks(isoWeekStart(now), N).toISOString()).getTime()`.
5. **PR semantic under window**: PR is relative to the chosen window; uniform across surfaces.
6. **Hero legend copy**: lifetime keeps the existing string; windowed becomes `"Max = best of last ${N} weeks · Now = this week · To PR = remaining"`.
7. **Hook name**: kept `useLifetimeBestWeek`; JSDoc explains window semantic.
8. **Storage**: `user_preferences.max_volume_window_weeks` (server-side, per length-unit precedent).
9. **Storage shape**: `integer NOT NULL DEFAULT 0 CHECK (max_volume_window_weeks IN (0, 10, 20, 30))`.
10. **Per-exercise progress chart `bestE1rm`**: deferred (out of scope); JSDoc note added.

## Files touched (20 total: 4 new + 16 edited)

### New
- `supabase/migrations/0009_max_volume_window.sql` — schema column + CHECK.
- `src/utils/window-utils.ts` — `computeWindowStart(weeks, now): number | undefined` (single source of truth for the numeric threshold).
- `tests/unit/window-utils.test.ts` — helper tests.
- `tests/unit/profile-max-volume-window.test.ts` — Profile smoke test (MutationObserver pattern; no RNTL in repo).
- `tests/e2e/max-volume-window.spec.ts` — 6 Playwright scenarios (added by Tester).

### Edited (source)
- `src/db/schema.ts`, `src/db/types.ts` — Drizzle model + types.
- `src/api/preferences.ts`, `src/hooks/use-preferences.ts` — `setMaxVolumeWindowWeeks`, `useMaxVolumeWindowWeeks`.
- `src/hooks/use-progress-page.ts` — wires `windowStartMs` into `useLifetimeBestWeek`, `usePrsThisWeek`, `useExercisesThisWeek`.
- `src/utils/progress-page-math.ts` — `bucketLifetimeWeeklyVolumes`, `computeLifetimeMaxPerExercise`, `computePrsThisWeek` now accept `windowStartMs?` and aggregate per-session BEFORE filtering. Dual-anchor rule for bucketing (`started_at` decides inclusion, `completed_at` decides bucket placement).
- `src/utils/session-verdict-math.ts`, `src/utils/volume-target.ts` — same windowing contract.
- `src/components/progress-hero.tsx` — legend branches on `weeks === 0`.
- `src/components/volume-target-slot.tsx` — windowed copy.
- `app/(app)/profile.tsx` — 4-segment row + legend caption.
- `app/(app)/progress/index.tsx` — passes windowed `bestWeekKg` to the strip; in-code comment about intentional bar-vs-overlay asymmetry.
- `app/(app)/workout/verdict/[sessionId].tsx` — windowed PR detection.
- `app/(app)/exercises/[id]/progress.tsx` — JSDoc note only (intentional deferral).

### Edited (tests)
- `tests/unit/progress-page-math.test.ts` — windowed cases (a)–(e) including cross-week MAJ-1 regression.
- `tests/unit/session-verdict-math.test.ts`, `tests/unit/volume-target.test.ts` — windowed cases.

**Diff size**: +1,224 / -159 lines across source + test files (excludes screenshot churn and 3 pre-existing modified docs unrelated to this run).

## Quality gates at end of run
- Typecheck: clean.
- Lint: 0 errors, 1 pre-existing warning in `router.d.ts` (unrelated).
- Unit tests: 268/268 pass (up from 229 baseline — +39 new windowed cases).
- E2E new: 6/6 pass.
- E2E regressions verified: 8 Progress + 2 verdict regressions all green.
- Visual evidence: 6 Chromium screenshots captured in `screenshots/01-profile-default.png` through `06-empty-user-30w.png`.

## Notes / non-blocking findings flagged by Tester
1. **AsyncStorage persister debounce** — Playwright hard navigation (`page.goto`) re-hydrates the cache before the ~1 s debounce flushes; tests wait 1.5 s. Real users (SPA tab navigation) unaffected.
2. **Pre-existing flake** in `tests/e2e/volume-target.spec.ts` ("golden path: chasing copy") — reproduces on baseline `HEAD`; not caused by this feature.
3. **Native (iOS/Android) Profile-row visual sign-off** — verified in Chromium headless; recommend a quick load on iPhone SE/Mini preset before final shipping. MAJ-2 mitigated by abbreviation `Lifetime → All`, but real-device confirmation is the next step.

## Migration status
`supabase/migrations/0009_max_volume_window.sql` was pushed to the linked Supabase project during Tester's run (Tester confirmed via column probe). Schema in remote = schema in repo. New users seeded via `seed_new_user()` will pick up `max_volume_window_weeks = 0` via DEFAULT (no seed function rewrite required).

## Why we stopped
Not escalated — pipeline completed cleanly. Round budgets remaining at end: D↔V 1/3, I↔R 1/2, I↔T 1/2, soft-callbacks 2/2.

## Artifacts
- [`state.md`](./state.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md) → superseded
- [`validation-v1.md`](./validation-v1.md) → no-go (2 blockers + 2 majors + 6 minors)
- [`design-v2.md`](./design-v2.md) ← shipped
- [`validation-v2.md`](./validation-v2.md) → go (0 blockers + 0 majors + 3 polish minors)
- [`implementation.md`](./implementation.md)
- [`review-v1.md`](./review-v1.md) → pass (0/0/0)
- [`test-report-v1.md`](./test-report-v1.md) → pass
- [`transcript.md`](./transcript.md)
- `screenshots/01-profile-default.png` … `06-empty-user-30w.png`

## Bugs found post-merge (backfill within 7 days)
- (none yet — owner updates as bugs surface)

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-23_0211_configurable-max-volume-window/` on 2026-05-23.
