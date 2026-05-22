# Design v3 — 2026-05-22_1300_pr-context (FINAL)

> Tight delta from `design-v2.md`. Sections tagged `[v2-carryover]` / `[changed-v3]` / `[new-v3]`. Conductor-written (Designer subagent rate-limited).

## Approach `[changed-v3]`

v2 closes v1's majors. v3 fixes two regressions v2 introduced:

1. **MAJ-A**: restore the literal `"PR!"` prefix in `<PrListRow>`'s second line. Existing verdict screen ships `"PR! +X kg (was Y kg)"`; v2 wrote `[PR] +X` and broke the zero-behavior-change requirement.
2. **MAJ-B**: align `computePrsThisWeek` signature to `{rows, currentWeekStartIso, currentWeekEndIso}` to match the existing `computePrExerciseIdsThisWeek` wrapper at `progress-page-math.ts:204-208`. v1 had this; v2 regressed.

Plus minors (MIN-A through MIN-F).

## Contratos de I/O `[changed-v3]`

```ts
// progress-page-math.ts
export function computePrsThisWeek(opts: {
  rows: WeeklyVolumeRow[];
  currentWeekStartIso: string;
  currentWeekEndIso: string;
}): Array<{
  exerciseId: string;
  /** Lifetime max single-session volume BEFORE the current ISO week. */
  priorMaxKg: number;
  /** Max single-session volume DURING the current ISO week. */
  currentMaxKg: number;
  /** currentMaxKg - priorMaxKg, > 0. */
  overflowKg: number;
}>;

// existing wrapper (unchanged):
export function computePrExerciseIdsThisWeek(opts: {
  rows: WeeklyVolumeRow[];
  currentWeekStartIso: string;
  currentWeekEndIso: string;
}): Set<string> {
  return new Set(computePrsThisWeek(opts).map(p => p.exerciseId));
}

// use-progress-page.ts
export type PrSummary = {
  priorMaxKg: number;
  currentMaxKg: number;
  overflowKg: number;
};
export function usePrsThisWeek(): {
  count: number;
  prIds: Set<string>;
  prsByExerciseId: Map<string, PrSummary>;
  isLoading: boolean;
};

// MIN-E: extend ExerciseThisWeekRow type
export type ExerciseThisWeekRow = {
  // existing fields...
  exerciseId: string;
  exerciseName: string;
  muscles: string[];
  maxKg: number;      // lifetime per-exercise best single-session
  nowKg: number;
  gapKg: number;
  isPrThisWeek: boolean;
  // [new-v3] populated only when isPrThisWeek === true
  priorMaxKg?: number;
  overflowKg?: number;
};

// pr-list-row.tsx (MIN-A: drop currentMaxKg from props since unrendered)
type PrListRowProps = {
  exerciseId: string;
  exerciseName: string;
  priorMaxKg: number;
  overflowKg: number;
  unit: WeightUnit;
  onPress?: (exerciseId: string) => void;
};
```

## `<PrListRow>` render `[changed-v3]`

```tsx
<Pressable onPress={() => onPress?.(exerciseId)}>
  <Text>{exerciseName}</Text>
  <View className="mt-0.5 flex-row items-center gap-2">
    <View className="rounded-full bg-emerald-100 px-2 py-0.5 dark:bg-emerald-950/40">
      <Text className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">PR</Text>
    </View>
    <Text className="text-sm text-gray-500">
      {`PR! +${formatVolume(overflowKg, unit)} (was ${formatVolume(priorMaxKg, unit)})`}
    </Text>
  </View>
</Pressable>
```

Verdict callsite passes `priorMaxKg + overflowKg` directly from `SessionPr`. `currentKg` is not forwarded (it isn't displayed). Zero behavior change vs current verdict copy.

## `useExercisesThisWeek` wiring `[changed-v3]`

**MIN-C fix**: `useExercisesThisWeek` calls `usePrsThisWeek()` to obtain the map, then enriches rows:

```ts
const { prsByExerciseId } = usePrsThisWeek();

const enriched: ExerciseThisWeekRow[] = bareRows.map(row => {
  const pr = prsByExerciseId.get(row.exerciseId);
  if (pr) {
    return { ...row, isPrThisWeek: true, priorMaxKg: pr.priorMaxKg, overflowKg: pr.overflowKg };
  }
  return { ...row, isPrThisWeek: false };
});
```

TanStack's prefix-cache + the shared `useLifetimeWeeklyVolume()` dependency ensures one lifetime walk per render (`computePrsThisWeek` runs once inside `usePrsThisWeek`'s `useMemo`).

## Mudanças por arquivo `[changed-v3]`

Same as v2 minus the regressions. Specifically:
- `progress-page-math.ts`: kernel signature `{rows, currentWeekStartIso, currentWeekEndIso}` (matches existing wrapper).
- `pr-list-row.tsx`: `currentMaxKg` dropped from props; copy template restored to `"PR! +X kg (was Y kg)"`.
- `progress-hero.tsx`: "Show all (N)" — **MIN-B fix**: expands the accordion in-place past 5 rows (no modal). Single-state toggle `showAll: useState<boolean>(false)`.
- `use-progress-page.ts`: `useExercisesThisWeek` calls `usePrsThisWeek()` (MIN-C explicit).
- `tests/unit/progress-page-math.test.ts`: test (d) reworded to drop hedge — assert `currentMaxKg = max(in-week session volumes)` (no parenthetical).

## What did NOT change from v2

- All v2 fixes for v1 issues (legend rename, double-walk hoist, day-zero gating, chevron a11y, hitSlop, collapse-on-empty effect, multi-PR semantic = max-in-week, JSDoc, a11y-label e2e selector).
- The 6 v1 Conductor-leaned decisions.
- The `<PrListRow>` extraction approach.
- The accordion-in-hero pattern.

## Test plan `[changed-v3]`

Same 6 new kernel cases + 1 new e2e + 1 modified e2e from v2. Plus:
- **MIN-D fix**: test (d) pinned to assert `currentMaxKg = max(in-week volumes)` after a PR-then-non-PR pattern.
- Verdict regression: 7 cases must pass without modification. The restored `"PR! +X kg (was Y kg)"` template is byte-for-byte the existing verdict copy.

## Confidence / Risk `[new-v3]`

- **Confiança**: ALTA. v3 is two 1-line fixes to v2 + minor polish. v2 already addressed v1's majors cleanly.
- **Risco**: BAIXO. No new code paths. The wrapper signature alignment + literal "PR!" restoration are mechanical.
