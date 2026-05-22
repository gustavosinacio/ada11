# Final summary — 2026-05-22_1130_chart-scroll-week-selector

## Outcome

- **Feature**: Weekly volume strip becomes horizontally scrollable through full ISO-week history; tappable `<VisibleRangePill>` opens a bottom-sheet `<WeekSelector>` to jump to a specific year/month. Default scroll position pinned to right edge (most recent week). Lifetime-best overlay anchored inside the scroller. Shared by History + Progress.
- **Pipeline result**: **shipped**.
- **Branch / final commit**: `main`. Working tree dirty.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (208/208 unit, 3/3 feature e2e + 19/19 adjacent regression after I↔T r2) |
| Human interventions during run | 1 (Conductor's mid-run reminder) |
| Total round-trips | 4 (D↔V 2, I↔R 1, I↔T 2) |
| Design ↔ Validate rounds | 2 (v1 `no-go` 1/3/7 → v2 `go` 0/0/6) |
| Implement ↔ Review rounds | 1 (`pass`) |
| Implement ↔ Test rounds | 2 (v1 fail on test seed/regex → v2 pass) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~75 min (11:30 → 12:45 BRT) |

## What shipped (12 files)

**New:**
- `src/utils/weekly-volume-strip-math.ts` — `computeStripModel(rows): StripModel | null` (returns null on empty data per MAJ-1).
- `src/components/week-selector.tsx` — bottom-sheet modal + `<VisibleRangePill>` (`forwardRef` + `useImperativeHandle` per MAJ-3).
- `tests/e2e/chart-scroll-week-selector.spec.ts` — 3 new cases.

**Edited:**
- `src/utils/dates.ts` — added `isoWeeksBetween` + `isoWeekContaining`.
- `src/api/stats.ts` — added `opts = {}` default (MIN-A); signature preserved (BLK-1 fix from v1).
- `src/hooks/use-stats.ts` — deleted `useWeeklyVolume` + `WEEKS_WINDOW`; `useLifetimeWeeklyVolume` is the sole consumer hook.
- `src/components/weekly-volume-strip.tsx` — rewritten for `<ScrollView horizontal>` + lifetime data + ref-based pill updates + week-rollover auto-scroll (MIN-5).
- `app/(app)/history/index.tsx` — swap to `useLifetimeWeeklyVolume`.
- `app/(app)/history/week/[isoWeek].tsx` — swap + delete the `isInWindow` guard.
- `tests/unit/dates.test.ts` — new cases for the contiguous-weeks helper.
- `tests/unit/weekly-volume-bucketing.test.ts` — dynamic buckets + empty-data null.
- `tests/e2e/week-drill-down.spec.ts` — anchored regex + extended seed plan (v2 test-only fixes).

## Decisions made during the run

1. **Data consolidation**: `useWeeklyVolume` deleted. Both consumers + drill-down screen use `useLifetimeWeeklyVolume`. Paginated fetch handles ~5-year data sets.
2. **`listWeeklyVolumeRows` signature preserved**: `opts?: {sinceUtc?: string} = {}`. Dead-but-harmless `sinceUtc` branch keeps test #43 working.
3. **Scrolling primitive**: native `<ScrollView horizontal>`. No FlashList (deferred per design alt 1).
4. **Week selector**: hand-rolled bottom-sheet (no date-picker dep). Mirrors `<SetRowMenu>` pattern.
5. **Lifetime-best overlay**: positioned inside the scroller. Always visible (user can see they're chasing their best week).
6. **Scroll re-render avoidance** (MAJ-3): `<VisibleRangePill>` owns its own label state via `useImperativeHandle`. Strip parent never `setState`s on scroll — calls `pillRef.current?.setRange(...)` only.
7. **Week roll-over auto-scroll** (MIN-5): if user is pinned to the right edge and a new bucket appears (Monday rollover while page mounted), the scroller auto-pins to the new edge.

## Bugs caught by the pipeline

- **v1 BLK-1**: Designer claimed no tests imported the `sinceUtc` signature. Test #43 (`progress-page-math.test.ts:807-813`) actively called it. v2 kept the signature with a `= {}` default.
- **v1 MAJ-1**: `isoWeeksBetween` helper was needed for lifetime bucketing — Discovery flagged, Designer initially missed. v2 added it.
- **v1 MAJ-2**: Modal mockup contradicted cited `<SetRowMenu>` bottom-sheet pattern. v2 redrew.
- **v1 MAJ-3**: 260-bar re-render on every scroll frame. v2 routed scroll state through a child ref.
- **v1 I↔T fail**: `week-drill-down.spec.ts` regex collision with the new pill label + 1-bucket seed gap. v2 anchored regex with `^...$` + extended seed plan to `[0, 5]`.

## Known debt (non-gating)

- 5 Reviewer minors (initialLabel magic number, rightAnchorX math looseness, jump-to-future-month fallback, e2e #2 scroll-x assertion, pre-existing labelTexts ≥8 assertion).
- Cold-start latency on populated History page not measured locally (inherits ~2.96s estimate from Progress page run).
- Lifetime-best overlay y-pin under scroll covered by review only, not e2e.
- New-week rollover re-pin covered by review only, not e2e.

## Artifacts

- [`state.md`](./state.md), [`transcript.md`](./transcript.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md), [`validation-v1.md`](./validation-v1.md) — no-go
- [`design-v2.md`](./design-v2.md), [`validation-v2.md`](./validation-v2.md) — **go**
- [`implementation.md`](./implementation.md) — includes I↔T r2 section
- [`review-v1.md`](./review-v1.md) — pass
- [`test-report-v1.md`](./test-report-v1.md) — fail (test seed/regex)
- [`test-report-v2.md`](./test-report-v2.md) — pass

## Notes for the owner

- **Working tree uncommitted.** Suggested commits:
  - `feat(chart): horizontal scrolling + week selector for weekly-volume strip` — 12 files.
  - `docs(pipeline): archive chart-scroll-week-selector run`.
- **Manual check on prod**: confirm scrolling left through older weeks lands at sensible bars; tap the pill, jump to an old month (e.g. last year), confirm bars are gray-stub (or volume) as expected.

## Archive

- Pending Conductor archive command.
