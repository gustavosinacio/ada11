# Design v1 — 2026-05-22_1300_pr-context

## Goal (1 sentence)

Surface WHICH exercises hit a PR this week (with prior-max context) by extending the Progress hero with a tap-to-expand accordion of celebratory PR rows reused from a new shared `<PrListRow>`, and disambiguate the `Max · Now · To PR` triplet with a one-line legend at the hero level only.

## Approach

Five surfaces change in concert, all hanging off one new kernel helper. (1) `computePrsThisWeek` (new sibling to `computePrExerciseIdsThisWeek`) returns an ordered array of `{exerciseId, priorMaxKg, currentMaxKg, overflowKg}` — the existing `Set<string>` helper is kept and re-implemented as a thin wrapper for backward-compat. (2) `usePrsThisWeek` grows a `prs: PrThisWeekRow[]` field alongside its existing `prIds` Set. (3) A new `<PrListRow>` component renders one tappable row (`{name} [PR pill] / PR! +X (was Y)`) and is used in two callsites: the verdict screen (refactor; zero behavior change) and the new Progress hero accordion. (4) `<ProgressHero>` becomes interactive: the PR count is a `Pressable` that toggles an inline accordion listing each PR via `<PrListRow>`. (5) Just below the `Max · Now · To PR` line in the hero, render a single muted legend line — narrow scope per Conductor instructions. Per-row Max/Now/To PR copy in `<ExercisesThisWeekList>` PR'd rows changes its `gap=0` case from "To PR 0 kg" to "PR! +X (was Y)" using the same kernel-derived numbers, so the list row aligns with the hero accordion and the verdict screen.

The accordion is preferred over scroll-to because (a) no precedent for scroll-anchoring exists on the Progress page, (b) it avoids platform-specific scroll quirks on web vs native, (c) the data is small (PRs are rare; bounded by the number of distinct exercises trained this week), and (d) the user sees the answer without losing the hero context.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/utils/progress-page-math.ts` | edited | Add `computePrsThisWeek(opts)` returning ordered `PrThisWeekRow[]`. Re-implement `computePrExerciseIdsThisWeek` as a thin wrapper (returns `new Set(computePrsThisWeek(opts).map(p => p.exerciseId))`). Add `PrThisWeekRow` type export. Algorithm preserves the running-`priorMax` semantic but captures `priorMax` and the PR session's `volume` (= `currentMaxKg` semantic; see below) at the moment a PR is detected within the week window. |
| `src/hooks/use-progress-page.ts` | edited | `usePrsThisWeek()` return shape extended to `{ data: number, prIds: Set<string>, prs: PrThisWeekRow[], isLoading, isError }`. The `useMemo` body calls the new kernel once; `prIds` is derived (kept for backward-compat with consumers that may import the Set). Also: `useExercisesThisWeek()` joins the new kernel output into `ExerciseThisWeekRow` so PR'd rows carry `priorMaxKg` + `overflowKg`. Add two optional fields to `ExerciseThisWeekRow` (`priorMaxKg?: number`, `overflowKg?: number`), populated only when `isPrThisWeek === true`. |
| `src/components/pr-list-row.tsx` | new | Shared celebratory PR row: exercise name + PR pill (right) + emerald `PR! +X (was Y)` line (below). Tap routes to `/(app)/exercises/${id}/progress`. Single source of truth for the rendering shared by verdict + Progress hero accordion. |
| `src/components/progress-hero.tsx` | edited | Wrap the count in a `Pressable` when `prs > 0`; toggle local `expanded` state. When expanded, render a list of `<PrListRow>` items below the `Max · Now · To PR` line. Disabled tap state when `prs === 0` (no interactive affordance). Add chevron (`▾`/`▸`) glyph next to the count when interactive. |
| `src/components/progress-hero-legend.tsx` | new | Stateless one-liner: `"Max = best week ever · Now = this week · To PR = remaining"`. Rendered just under `<MaxNowToPrLine>` inside `<ProgressHero>`. Small, muted, no border. Single use; co-located with hero to keep the legend's scope obvious. |
| `src/components/exercises-this-week-list.tsx` | edited | For PR'd rows (`row.isPrThisWeek`), replace the `<MaxNowToPrLine>` instance with a celebratory emerald `"PR! +${overflowKg} (was ${priorMaxKg})"` line (same copy as `<PrListRow>`). Non-PR rows stay on `<MaxNowToPrLine>` unchanged. |
| `app/(app)/workout/verdict/[sessionId].tsx` | edited | Replace inline PR row (lines 172–195) with `<PrListRow>` mapped over `prs`. Verdict still owns its scope (single-session PR), passes `priorMaxKg` + `overflowKg` from `SessionPr`. Zero behavior change. |
| `tests/unit/progress-page-math.test.ts` | edited | New describe block `computePrsThisWeek` (~12 cases): empty rows; one PR with prior=500/current=900 → `{priorMaxKg:500, overflowKg:400}`; two PRs both in week → both returned in deterministic order (overflow DESC, exerciseId ASC, mirroring `computePrsForSession`); PR session in prior weeks (not this week) → excluded; strict-`>` boundary (current === prior → not a PR); first-ever session not a PR (prior=0 guard); multi-session-this-week climb (early-week PR + later session that doesn't beat the early PR → only the early one returned, with priorMax = the lifetime max before the early-week session). Add 1 backward-compat test: `computePrExerciseIdsThisWeek` still returns the matching Set of ids. |
| `tests/e2e/progress-page.spec.ts` | edited | New test 8: seed a prior PR session + a this-week PR session, navigate to Progress, assert `PR! +900 kg (was 1,500 kg)` is NOT visible until the count is tapped, then visible after. Reuse the seeding pattern from test 6. Test 6 (PR pill) unchanged. |
| `tests/e2e/end-of-session-verdict.spec.ts` | edited | Adjust selector if the verdict PR-row markup nested element layout changes due to component extraction (assertion text stays the same — `"PR! +"` substring). Regression: zero text change. |

Total: 5 edited + 2 new source files, 3 test files.

## Page composition

### Progress hero — collapsed (count tappable)

```
┌──────────────────────────────────────────────────────────────┐
│ PRS THIS WEEK                                                │
│ 2  ▸                                                         │ ← Pressable; chevron only when count > 0
│ ───────────────────────────────────────────────────────────  │
│ Max 26,210 kg · Now 5,400 kg · To PR 20,810 kg               │
│ Max = best week ever · Now = this week · To PR = remaining   │ ← NEW legend line (text-xs, gray-500)
└──────────────────────────────────────────────────────────────┘
```

### Progress hero — expanded (after tap)

```
┌──────────────────────────────────────────────────────────────┐
│ PRS THIS WEEK                                                │
│ 2  ▾                                                         │
│ ───────────────────────────────────────────────────────────  │
│ Max 26,210 kg · Now 5,400 kg · To PR 20,810 kg               │
│ Max = best week ever · Now = this week · To PR = remaining   │
│ ───────────────────────────────────────────────────────────  │
│ Bench press                                          [PR]    │ ← <PrListRow>, tappable → exercise progress
│ PR! +400 kg (was 1,500 kg)                                   │
│                                                              │
│ Squat                                                [PR]    │ ← <PrListRow>
│ PR! +900 kg (was 8,100 kg)                                   │
└──────────────────────────────────────────────────────────────┘
```

Empty state (count === 0): hero renders as today, count is plain `Text` (not `Pressable`), no chevron, no accordion. Legend line still renders (it explains the volume triplet, which is independent of PR existence).

### Per-muscle list row — PR'd exercise

Before:
```
CHEST
Bench press                                           [PR]
Max 8,400 kg · Now 6,000 kg · To PR 0 kg              ← clamped, meaningless
```

After:
```
CHEST
Bench press                                           [PR]
PR! +400 kg (was 1,500 kg)                            ← emerald-700, tabular-nums
```

Non-PR rows in the same list are unchanged.

## Hooks + API additions

### New kernel signature

```ts
// src/utils/progress-page-math.ts

export type PrThisWeekRow = {
  exerciseId: string;
  /** Lifetime max single-session volume across ALL sessions BEFORE the PR session. */
  priorMaxKg: number;
  /** Volume of the PR session itself (single session that beat priorMax this week). */
  currentMaxKg: number;
  /** currentMaxKg - priorMaxKg, strictly > 0 by construction. */
  overflowKg: number;
};

/**
 * Returns one entry per exercise that hit ≥1 strict-PR session during the
 * current ISO week.
 *
 * If an exercise hits multiple PRs in the same week (each beating the running
 * priorMax), only the FIRST in-week PR is returned, with `priorMaxKg` = the
 * lifetime max BEFORE that first in-week PR session. This matches Discovery
 * unknown #9 option (i): "priorMaxKg = lifetime max BEFORE this week's first
 * PR session". Simpler than reporting the running max, matches existing
 * running-priorMax semantics at progress-page-math.ts:240-249.
 *
 * Sorted by `overflowKg` DESC, then `exerciseId` ASC (mirrors
 * `computePrsForSession` for consistency).
 */
export function computePrsThisWeek(opts: {
  rows: WeeklyVolumeRow[];
  currentWeekStartIso: string;
  currentWeekEndIso: string;
}): PrThisWeekRow[];

/** Backward-compat wrapper. Calls `computePrsThisWeek` and projects ids. */
export function computePrExerciseIdsThisWeek(opts: {
  rows: WeeklyVolumeRow[];
  currentWeekStartIso: string;
  currentWeekEndIso: string;
}): Set<string>; // unchanged signature; unchanged behavior
```

### Hook shape change

```ts
// src/hooks/use-progress-page.ts

export function usePrsThisWeek(): {
  data: number;                  // unchanged: count
  prIds: Set<string>;            // unchanged: ids
  prs: PrThisWeekRow[];          // NEW: ordered array with priorMax + overflow
  isLoading: boolean;
  isError: boolean;
};

export type ExerciseThisWeekRow = {
  // ...existing fields...
  isPrThisWeek: boolean;
  /** Populated iff `isPrThisWeek === true`. */
  priorMaxKg?: number;
  /** Populated iff `isPrThisWeek === true`. */
  overflowKg?: number;
};
```

### Component contracts

```ts
// src/components/pr-list-row.tsx

type Props = {
  exerciseId: string;
  exerciseName: string;
  priorMaxKg: number;
  overflowKg: number;
  unit: WeightUnit;
  /** Optional override; defaults to "{name}, view progress". */
  accessibilityLabel?: string;
};

export function PrListRow(props: Props): React.JSX.Element;
```

Visual contract (verified against both callsites today; zero divergence):
- Container: `Pressable className="border-b border-gray-100 px-4 py-3 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950"`
- First row: name (`flex-1 text-base font-medium text-black dark:text-white`) + PR pill on the right (existing emerald style).
- Second row: `text-sm tabular-nums text-emerald-700 dark:text-emerald-400` rendering `PR! +${formatVolume(overflowKg, unit)} (was ${formatVolume(priorMaxKg, unit)})`.

### Hero `expanded` state

```ts
// src/components/progress-hero.tsx (inside ProgressHero)

const [expanded, setExpanded] = useState(false);
const interactive = prs > 0;
// onPress only attached when interactive; AccessibilityRole "button" gated.
// `accessibilityState={{ expanded }}` exposed for screen readers.
```

### DB / queries

No DB changes. No new query. The math runs against the existing `useLifetimeWeeklyVolume` cache (lifetime sets read). RLS untouched.

## Riscos

- **Data integrity**: kernel preserves the exact strict-`>` PR semantic (`current > priorMax && priorMax > 0`) — same algorithm as today's `computePrExerciseIdsThisWeek`. No new PR being counted that wouldn't have been before; no PR being dropped. Backward-compat tests on `computePrExerciseIdsThisWeek` re-prove this. No migration. No RLS surface change.
- **UX regressions**:
  - `<ExercisesThisWeekList>` PR'd rows change their second-line copy. Existing e2e test 6 asserts the PR pill is visible (substring `"PR"`) — passes both before and after. New test 8 asserts the new accordion copy. The `To PR 0 kg` text disappears on PR'd rows — no test relies on it (verified by grep against the test suite).
  - Verdict screen PR-row markup nests slightly differently after extraction. The visible text (`PR! +X (was Y)`) is identical. `tests/e2e/end-of-session-verdict.spec.ts` asserts on text substrings, not DOM structure — risk low. If a selector breaks, fix per regression budget.
  - Hero count tap is a NEW gesture on a previously static surface. Tap-target is `text-3xl` heading + chevron — no overlap with the existing `<MaxNowToPrLine>` below (separated by an `h-px` divider). No risk of capturing the swipe-to-refresh gesture (gesture is on the parent `ScrollView`).
- **Platform-specific**:
  - Web: `Pressable` works; chevron is a simple `Text` glyph (no SVG, no icon font). No hover state added (degrades on touch by Discovery note — confirmed against existing modal precedents).
  - iOS/Android: `Pressable` + `accessibilityState={{ expanded }}` is the RN convention; no platform-conditional code.
  - Universal-app constraint respected: NativeWind classes only, no styled-components.
- **Performance**:
  - Kernel work is O(N) over `rows` (same as existing). Capturing `priorMax` at PR detection adds O(1) per PR. Sort is O(K log K) over PR count, K ≤ #exercises trained this week — bounded.
  - Hero accordion expand/collapse is local component state; no re-fetch, no cache miss.
  - `<PrListRow>` is rendered up to K times when expanded — no virtualisation needed (K is small; PRs are rare).

## Alternativas descartadas

1. **Scroll-to-first-PR-row on hero count tap** — would jump the scroll position to the first PR'd row inside `<ExercisesThisWeekList>`. Descartada porque: no precedent on the Progress page; cross-platform scroll-into-view is finicky (web smooth-scroll vs native `scrollTo`); the user loses the hero context; accordion delivers the same info in-place with simpler code.
2. **Dedicated "PRs this week" section above the per-muscle list (option b)** — descartada porque duplicates information (per-muscle list already lists PR rows first inside each group, and the hero now expands to show them); adds vertical surface area for a feature that only matters when PRs > 0.
3. **Modal popup instead of inline accordion** — descartada porque the data is small and celebratory; a modal feels heavier than the content warrants, and the hero context is what gives the count meaning.
4. **Reuse `<SessionPr>` type directly instead of new `PrThisWeekRow`** — descartada porque the semantics differ: `currentKg` in `SessionPr` is the just-finished session's total; in the week-scope kernel, it's the PR session's total within the week. Different scope, different name (`currentMaxKg`) avoids confusion. Both types are interchangeable at the `<PrListRow>` prop boundary because the row only needs `priorMaxKg` + `overflowKg` + name + id.
5. **Add the legend to every `<MaxNowToPrLine>` callsite** — descartada per Conductor scope: keep legend at hero only. Per-row repetition would clutter; the hero is the entry point, and once read, the user has the semantic for the rest of the page.
6. **Tooltip / help-icon ("?") next to the triplet** — descartada per Conductor scope (no new tooltip primitive). Inline legend is the lower-risk, no-new-abstraction path.
7. **Capture all in-week PRs (multiple per exercise)** — descartada because Discovery unknown #9 picked option (i) "priorMax before the first in-week PR session". Simpler kernel; matches the existing running-priorMax semantic; multiple climbs in the same week is a vanishingly rare case and would inflate the accordion list with same-exercise rows.
8. **Auto-expand accordion when count > 0** — descartada because (a) it costs vertical space for users who only glance at the count, (b) collapsed default mirrors the calm hero pattern, (c) the chevron + tap discoverability is sufficient (and the count itself is large + emerald-pill adjacent, so it draws the eye).

## Out of scope

- Refactoring `<VolumeTargetSlot>` to consume `<MaxNowToPrLine>` (carried over from prior runs).
- App-wide help icons / tooltips. Legend is hero-only.
- DB / API changes. Everything client-side.
- History tab PR highlighting.
- Cross-week PR comparison ("best PR week ever").
- Editing / dismissing PR records.
- Tooltip primitive (no new abstraction).
- Per-row legend on `<ExercisesThisWeekList>` rows.

## Test plan

### Unit kernel (`tests/unit/progress-page-math.test.ts`)

New `describe("computePrsThisWeek")` block, ~12 cases:

1. Empty rows → `[]`.
2. One exercise, prior=500, current=900 in week → `[{exerciseId, priorMaxKg:500, currentMaxKg:900, overflowKg:400}]`.
3. Strict-`>` boundary: prior=500, current=500 in week → `[]` (matches `(#24)`).
4. First-ever session in-week (no prior) → `[]` (priorMax=0 guard).
5. Prior PR (not this week) → not returned.
6. Two PR'd exercises this week → both returned, ordered by `overflowKg` DESC then `exerciseId` ASC.
7. Same exercise PRs twice this week → returned ONCE with `priorMaxKg` = lifetime max BEFORE the first in-week PR session (not before the second).
8. PR session exactly at week boundary (`started_at === currentWeekStartIso`) → included.
9. PR session at week-end boundary (`started_at === currentWeekEndIso`) → included.
10. Warmup-only / weight-0 / reps-0 rows filtered (existing kernel behavior; assert via row mix).
11. Multiple exercises, only one PRs → result has length 1.
12. Backward-compat: `computePrExerciseIdsThisWeek(sameInput)` returns `new Set(computePrsThisWeek(sameInput).map(p => p.exerciseId))` — assert identical id-set.

Existing PR-set surface tests (#50-#52) still pass — wrapper preserves contract.

### E2E hero accordion (`tests/e2e/progress-page.spec.ts`)

New test 8: "PRs this week — tap count expands accordion with celebratory copy".

```
Seed: prior session 100×5×3 = 1,500 kg, current week session 100×6×4 = 2,400 kg.
expected overflow = 900, priorMax = 1,500.

Steps:
1. signInViaUi + gotoProgress.
2. Wait for "PRs this week" eyebrow visible.
3. Assert the celebratory text `PR! +900 kg (was 1,500 kg)` is NOT visible (collapsed default).
4. Tap the count (`getByText("1")` near the eyebrow, or use accessibilityLabel "Show PR details").
5. Assert `PR! +900 kg (was 1,500 kg)` IS visible.
6. Assert the exercise name is visible inside the accordion.
7. Tap the count again → assert the celebratory text is gone (collapse).
```

Test 6 (existing PR pill) is unchanged — the pill is still rendered on the per-muscle list row.

### E2E verdict regression (`tests/e2e/end-of-session-verdict.spec.ts`)

No new test. Existing assertions on `"PR! +"` substring + exercise name continue to match the new `<PrListRow>` markup. Quick smoke pass of the existing test suite verifies extraction didn't break selectors. If any assertion uses a brittle DOM-path selector (audit before implementation), rewrite to use text/`getByRole` selector.

### Manual smoke

- Toggle accordion 5× rapidly: no state desync.
- Pull-to-refresh while expanded: state preserved (local component state — survives query refetch).
- Dark mode: emerald-300 / emerald-400 dark variants verified.
- Long exercise names in the accordion: `flex-1` truncation behavior matches the per-muscle list row.
- Empty state (zero PRs): count is plain `Text`, no chevron, no tap target — assert no tap area exists.

## Open risks

1. **Test selector fragility on verdict extraction.** If existing verdict e2e uses parent-DOM-path selectors instead of text/role, extraction could break them. Mitigation: audit `end-of-session-verdict.spec.ts` during implementation; prefer text/role selectors throughout.
2. **`useExercisesThisWeek` join cost.** Calling `computePrsThisWeek` from inside `useExercisesThisWeek` (to enrich PR'd rows with `priorMaxKg`/`overflowKg`) means the kernel runs twice per render of the Progress page — once from `usePrsThisWeek`, once here. Both are O(N) over the same rows. Acceptable; same data is already O(N)-walked multiple times in this hook. If profiling shows it matters, hoist to a shared `useMemo` later (out of scope for this run).
3. **Accordion vertical growth pushes content below the fold.** If a user PR's 10 exercises in a week (improbable but possible), the accordion is ~10 rows tall. Acceptable — the surrounding screen is a `ScrollView`, content reflows. No `maxHeight` cap planned.
4. **Same-week multiple-PR semantic (option i vs option ii).** Locked to option (i) per Discovery unknown #9 recommendation. If a user does PR twice for the same exercise in a week, the second climb isn't reflected in the celebratory copy. Documented in the kernel comment and out-of-scope for this run.
5. **Legend wraps on narrow screens.** The legend line is ~58 characters; on an iPhone SE (320pt) it may wrap. Acceptable — `text-xs` (12px-ish) typically fits; if it wraps, two lines is still readable. No truncation logic added.

## Resposta a issues do Validator

N/A — this is design-v1.
