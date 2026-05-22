# Design v2 — 2026-05-22_1300_pr-context

> Delta from `design-v1.md`. Sections tagged `[v1-carryover]` / `[changed-v2]` / `[new-v2]`.

## Scope `[v1-carryover]`

(Reference design-v1.md §Scope. No change.)

## Approach `[changed-v2]`

Same direction as v1, with two surgical fixes:

1. **MAJ-1 (legend collision)** — rename the per-row `Max` label to `"Best session"`. The hero keeps `Max` (with the new legend "Max = best week ever"). `<MaxNowToPrLine>` gets a new optional prop `maxLabel?: string` defaulted to `"Max"`. Hero passes default; `<ExercisesThisWeekList>` passes `"Best session"`. Per-row triplet becomes `Best session: 4,900 kg · Now: 3,200 kg · To PR: 1,700 kg` — self-documenting.

2. **MAJ-2 (double walk)** — hoist PR-row enrichment into `usePrsThisWeek`. New return shape:
   ```ts
   {
     count: number,
     prIds: Set<string>,
     prsByExerciseId: Map<string, { priorMaxKg: number; currentMaxKg: number; overflowKg: number }>,
     isLoading: boolean,
   }
   ```
   `useExercisesThisWeek` consumes `prsByExerciseId.get(row.exercise_id)` when joining instead of calling the kernel a second time. One lifetime walk per render.

3. **Multi-PR semantic** (MIN-5): `currentMaxKg = max(in-week session volumes)` per exercise. So if user PRs 800→900→1000 in one week, `priorMaxKg = 800` (pre-week lifetime max) and `currentMaxKg = 1000` → display `+200 (was 800)`. Matches the eventual lifetime-max state and the verdict screen's "best in this session" framing.

4. **Minors absorbed**: legend gated on `maxKg > 0` (MIN-1), chevron a11y (MIN-2), `hitSlop` on tappable count (MIN-3), collapse-on-empty effect (MIN-4), accordion cap at 5 + "Show N more" (MIN-6), `currentMaxKg` JSDoc (MIN-8), new test cases (MIN-9), a11y-label-based e2e selector (MIN-10).

## Mudanças por arquivo `[changed-v2]`

| File | Type | Change |
|---|---|---|
| `src/utils/progress-page-math.ts` | edited | New export `computePrsThisWeek(rows, now): Array<{exerciseId, priorMaxKg, currentMaxKg, overflowKg}>` ordered by `overflowKg DESC, exerciseId ASC`. `currentMaxKg = max(per-session volume for that exercise in current ISO week)`. JSDoc disambiguates from `SessionPr.currentKg`. Existing `computePrExerciseIdsThisWeek` becomes a thin wrapper returning `new Set(computePrsThisWeek(rows, now).map(p => p.exerciseId))`. |
| `src/hooks/use-progress-page.ts` | edited | `usePrsThisWeek` returns `{count, prIds, prsByExerciseId: Map<string, {priorMaxKg, currentMaxKg, overflowKg}>, isLoading}`. Uses `useMemo` over `lifetimeQ.data` to compute `computePrsThisWeek(...)` once. `useExercisesThisWeek` consumes the Map for PR'd rows: `const pr = prsByExerciseId.get(row.exercise_id); if (pr) { row.priorMaxKg = pr.priorMaxKg; row.overflowKg = pr.overflowKg; }`. Drops the internal `computePrExerciseIdsThisWeek` call (now derived from `prIds`). |
| `src/components/max-now-to-pr-line.tsx` | edited | New optional prop `maxLabel?: string` defaulted to `"Max"`. Replaces hard-coded `"Max"` text. |
| `src/components/pr-list-row.tsx` | **new** | Reusable PR row: `{exerciseName} [PR] +{overflowKg} kg (was {priorMaxKg} kg)`. Props: `{exerciseId, exerciseName, priorMaxKg, currentMaxKg, overflowKg, onPress?, unit}`. Tap → `onPress(exerciseId)` (caller routes). Emerald pill matches verdict + per-muscle list. |
| `src/components/progress-hero.tsx` | edited | Hero count becomes `Pressable` when `count > 0`. New `hitSlop` (8px each side). A11y label: `"${count} PRs this week, tap to expand"`. Tap toggles `expanded: useState<boolean>(false)`. Accordion below the headline renders top-5 `<PrListRow>` instances; if `prsByExerciseId.size > 5`, renders "Show all (N)" affordance. Chevron `▾`/`▸` wrapped in `accessibilityElementsHidden` + `importantForAccessibility="no"`. `useEffect(() => { if (count === 0 && expanded) setExpanded(false) }, [count, expanded])`. Legend `"Max = best week ever · Now = this week · To PR = remaining"` rendered ONLY when `maxKg > 0`. |
| `src/components/exercises-this-week-list.tsx` | edited | Pass `maxLabel="Best session"` to `<MaxNowToPrLine>`. For PR'd rows (where `row.priorMaxKg` is set), swap the `<MaxNowToPrLine>` render for a `<PrListRow>` instance. Tap navigates to `/(app)/exercises/{id}/progress`. |
| `app/(app)/workout/verdict/[sessionId].tsx` | edited | Replace inline PR row JSX with `<PrListRow>`. Zero behavior change — existing 7 verdict e2e assertions still hold (text content + DOM order unchanged). |
| `tests/unit/progress-page-math.test.ts` | edited | Add `computePrsThisWeek` test cases: (a) empty data → `[]`; (b) one PR exercise → 1-element array with correct `priorMaxKg`/`currentMaxKg`/`overflowKg`; (c) two PRs same week, same exercise (800→900→1000) → 1 entry with `priorMaxKg=800, currentMaxKg=1000`; (d) PR-then-non-PR session same week → 1 entry with `currentMaxKg = first PR's volume` (or whatever v2 picks — see Approach #3, which says max; pin this); (e) sort order test (overflowKg DESC, exerciseId ASC tiebreak); (f) priorMaxKg=0 ⇒ NOT a PR (matches existing semantic). |
| `tests/e2e/progress-page.spec.ts` | edited | Update test 6 (PR pill) to also assert the accordion expand → `<PrListRow>` substring `"PR! +100 kg (was 500 kg)"`. New test: tap hero count → accordion expands → tap a row → routes to exercise progress page. A11y label selector: `getByRole("button", { name: /\d+ PRs this week/i })`. |
| `tests/e2e/end-of-session-verdict.spec.ts` | unchanged | Existing 7 cases must still pass with `<PrListRow>` replacing inline JSX. |

## Contratos de I/O `[changed-v2]`

```ts
// progress-page-math.ts
export function computePrsThisWeek(
  rows: WeeklyVolumeRow[],
  now: Date,
): Array<{
  exerciseId: string;
  /** Lifetime max single-session volume BEFORE the current ISO week. */
  priorMaxKg: number;
  /** Max single-session volume DURING the current ISO week. */
  currentMaxKg: number;
  /** currentMaxKg - priorMaxKg, > 0. */
  overflowKg: number;
}>;

// use-progress-page.ts
export function usePrsThisWeek(): {
  count: number;
  prIds: Set<string>;
  prsByExerciseId: Map<string, { priorMaxKg: number; currentMaxKg: number; overflowKg: number }>;
  isLoading: boolean;
};

// max-now-to-pr-line.tsx
type MaxNowToPrLineProps = {
  maxKg: number;
  nowKg: number;
  unit: WeightUnit;
  maxLabel?: string; // defaults to "Max"; per-row callers pass "Best session"
};

// pr-list-row.tsx (new)
type PrListRowProps = {
  exerciseId: string;
  exerciseName: string;
  priorMaxKg: number;
  currentMaxKg: number;
  overflowKg: number;
  unit: WeightUnit;
  onPress?: (exerciseId: string) => void;
};
```

## Test plan `[changed-v2]`

- Kernel (`computePrsThisWeek`): 6 new unit cases as enumerated in the file table.
- Hero accordion e2e: tap count → expand → assert visible `<PrListRow>` rows + counts.
- Per-muscle list: PR'd row now renders as `<PrListRow>` instead of `<MaxNowToPrLine>` — assert the celebratory copy substring.
- Verdict regression: 7 existing cases must pass without modification (proves the shared-component refactor is zero-behavior-change).

## Riscos `[changed-v2]`

- **Cold-start cost unchanged** — the single hoisted kernel call replaces two; net slightly faster.
- **No-PR session list inconsistency** (MIN-5 hardened): `currentMaxKg = max` semantic matches the verdict screen's framing.
- **Accordion overflow** (MIN-6): capped at 5 rows; "Show all (N)" affordance for power weeks. Renders inline (no modal).

## Alternativas consideradas `[v1-carryover]`

(Reference design-v1.md §Alternativas. No change. The legend-collision Alternative #5 has been re-evaluated in v2's MAJ-1 resolution.)

## What did NOT change from v1

- `<PrListRow>` extraction approach.
- Accordion (not scroll-to) decision.
- Verdict screen shared-component refactor with zero-behavior-change requirement.
- `computePrExerciseIdsThisWeek` kept as backward-compat wrapper.
- Out-of-scope list (no app-wide help-icon system).
- Hero accordion state lives in component-local `useState`, not persisted across navigation.
