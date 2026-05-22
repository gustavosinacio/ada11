# Final summary — 2026-05-22_1300_pr-context

## Outcome

- **Feature**: PR context on Progress page — hero count is now tappable, expands an accordion of `<PrListRow>` instances showing `{exercise} PR! +X kg (was Y kg)` for each this-week PR. Per-muscle list PR'd rows swap from `Max · Now · To PR: 0 kg` to the celebratory `<PrListRow>`. New legend under the hero clarifies `Max = best week ever · Now = this week · To PR = remaining` (only when there's data). Per-row triplet uses `"Best session"` instead of `"Max"` to avoid collision with the hero's terminology. Verdict screen and Progress hero share a single `<PrListRow>` component.
- **Pipeline result**: **shipped**.
- **Branch / final commit**: `main`. Working tree dirty.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (214/214 unit, 8/8 feature e2e, 7/7 verdict regression) |
| Human interventions during run | 1 (Designer subagent rate limit; Conductor wrote v2 + v3 inline) |
| Total round-trips | 5 (D↔V 3, I↔R 1, I↔T 1 + Conductor v2 closure) |
| Design ↔ Validate rounds | 3 (v1 `no-go` 0/2/10 → v2 `no-go` 0/2/6 [v2 had regressions] → v3 `go` 0/0/1) |
| Implement ↔ Review rounds | 1 (`pass`) |
| Implement ↔ Test rounds | 2 (v1 fail on selector ambiguity → v2 Conductor `.first()` patch + dev-server restart → pass) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~70 min (13:00 → 14:10 BRT) |

## What shipped (9 files)

**New:**
- `src/components/pr-list-row.tsx` — reusable PR row shared by verdict + Progress hero. Render: `"PR! +X kg (was Y kg)"` (literal prefix). Emerald pill.

**Edited:**
- `src/utils/progress-page-math.ts` — new `computePrsThisWeek(opts: {rows, currentWeekStartIso, currentWeekEndIso}): PrThisWeek[]`. Existing `computePrExerciseIdsThisWeek` is now a thin wrapper. JSDoc disambiguates from `SessionPr.currentKg`.
- `src/hooks/use-progress-page.ts` — `usePrsThisWeek` returns `{count, prIds, prsByExerciseId: Map<string, {priorMaxKg, currentMaxKg, overflowKg}>, isLoading}`. `useExercisesThisWeek` calls `usePrsThisWeek()` and enriches PR rows. `ExerciseThisWeekRow` extended with optional `priorMaxKg?` + `overflowKg?`.
- `src/components/max-now-to-pr-line.tsx` — new optional `maxLabel?: string` prop (default `"Max"`).
- `src/components/progress-hero.tsx` — pressable count + 5-row accordion + "Show all (N)" expand + legend gated on `maxKg > 0` + chevron a11y-hidden + `hitSlop` + collapse-on-empty effect.
- `src/components/exercises-this-week-list.tsx` — PR'd rows render `<PrListRow>`; non-PR rows pass `maxLabel="Best session"`.
- `app/(app)/workout/verdict/[sessionId].tsx` — inline JSX → `<PrListRow>`. Byte-for-byte preserved.
- `tests/unit/progress-page-math.test.ts` — 6 new `computePrsThisWeek` cases (empty, single, multi-PR same week 800→900→1000, PR-then-non-PR same week, sort order, no-prior-max).
- `tests/e2e/progress-page.spec.ts` — extended test 6 (accordion + celebratory copy with `.first()` qualifier) + new test 8 (tap count → expand → tap row → route).

## Decisions made during the run

1. **Option (c) extension** — PR pill already existed on per-muscle list; this run swapped the entire row to `<PrListRow>` (celebratory copy) + added a hero accordion entry point.
2. **Legend semantics**: per-row `Max` renamed to `Best session` to eliminate collision with hero's `Max = best week ever`. Hero legend gated on `maxKg > 0`.
3. **Multi-PR same week semantic**: `currentMaxKg = max(in-week session volumes)` matches the eventual lifetime-max state.
4. **Shared `<PrListRow>`**: single source for the celebratory copy. Used by verdict + Progress.
5. **Hook wiring**: `useExercisesThisWeek` calls `usePrsThisWeek()` explicitly to consume the map → single walk per render.

## Bugs caught by the pipeline

- **v1 MAJ-1**: Designer's "one legend explains all" pattern was empirically wrong (hero `Max` ≠ per-row `Max`). v2 picked the rename.
- **v1 MAJ-2**: Two redundant lifetime walks. v2 hoisted into `usePrsThisWeek`.
- **v2 MAJ-A**: Conductor-written v2 dropped the literal `"PR!"` prefix in `<PrListRow>` (regression vs verdict ship). v3 restored.
- **v2 MAJ-B**: Conductor-written v2 changed kernel signature from `{rows, currentWeekStartIso, currentWeekEndIso}` to `(rows, now)` — broke the wrapper. v3 reverted to v1's signature.
- **v1 I↔T fail**: e2e selector strict-mode collision because celebratory copy now appears in TWO places (hero + per-muscle list, both intentional). v2 added `.first()`.

## Known debt

- 1 cosmetic minor: existing JSDoc on `usePrsThisWeek` doesn't explicitly call out that `isError` field was dropped from the v3 return shape.

## Artifacts

- [`state.md`](./state.md), [`transcript.md`](./transcript.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md), [`validation-v1.md`](./validation-v1.md) — no-go
- [`design-v2.md`](./design-v2.md), [`validation-v2.md`](./validation-v2.md) — no-go (Conductor-written v2 introduced regressions)
- [`design-v3.md`](./design-v3.md), [`validation-v3.md`](./validation-v3.md) — **go**
- [`implementation.md`](./implementation.md)
- [`review-v1.md`](./review-v1.md) — pass
- [`test-report-v1.md`](./test-report-v1.md) — fail (selector strict-mode + dev-server missing)
- [`test-report-v2.md`](./test-report-v2.md) — pass

## Notes for the owner

- **Working tree uncommitted.** Suggested split:
  - `feat(progress): show which PRs hit this week + label disambiguation` — 9 files (1 new component, 6 edited, 2 test files).
  - `docs(pipeline): archive pr-context run`.
- **Manual visual check**: navigate to Progress, tap the PR count, verify the accordion expands with celebratory rows. Tap a row → exercise progress chart.
- **Verdict screen check**: finish a workout, hit a PR, confirm the verdict reads identically to before (zero-behavior-change requirement).

## Archive

- Pending Conductor archive command.
