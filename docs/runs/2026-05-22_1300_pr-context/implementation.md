## Implementation — 2026-05-22_1300_pr-context

Based on: `design-v3.md` (final approved) + `validation-v3.md` (`go`, 1 minor MIN-G — applied).

## Files changed

- `src/utils/progress-page-math.ts` (edited) — new export `computePrsThisWeek(opts: {rows, currentWeekStartIso, currentWeekEndIso}): PrThisWeek[]`. Captures `priorMaxKg` at the first in-week PR + tracks `currentMaxKg = max(in-week session volumes)`. Sort `overflowKg DESC, exerciseId ASC`. JSDoc disambiguates from `SessionPr.currentKg`. Existing `computePrExerciseIdsThisWeek` becomes a thin wrapper: `new Set(computePrsThisWeek(opts).map(p => p.exerciseId))`.
- `src/hooks/use-progress-page.ts` (edited) — `usePrsThisWeek` now returns `{count, prIds, prsByExerciseId: Map<string, PrSummary>, isLoading}` (drops `isError` — no callsite read it, design-v3 contract). `useExercisesThisWeek` calls `usePrsThisWeek()` to consume the map; PR'd rows are enriched with `priorMaxKg + overflowKg`. `ExerciseThisWeekRow` extended with optional `priorMaxKg?` + `overflowKg?` (MIN-E).
- `src/components/max-now-to-pr-line.tsx` (edited) — added `maxLabel?: string` prop (defaults to `"Max"`). Replaces hard-coded `"Max"` in both the rendered text and the `accessibilityLabel`.
- `src/components/pr-list-row.tsx` (new) — reusable celebratory PR row. Props: `{exerciseId, exerciseName, priorMaxKg, overflowKg, unit, onPress?}`. Renders the verdict-byte-equivalent `"PR! +X kg (was Y kg)"` line + emerald `PR` pill. `currentMaxKg` intentionally NOT in the props (MIN-A — unrendered).
- `src/components/progress-hero.tsx` (edited) — Hero count is now `Pressable` when `count > 0`, with `hitSlop={{top:8,bottom:8,left:8,right:8}}` and a11y label `"${count} PRs this week, tap to expand"`. Toggles `expanded` state to reveal a top-5 `<PrListRow>` accordion (no modal). If `prsByExerciseId.size > 5`, shows "Show all (N)" affordance that toggles `showAll` to render the rest in-place (MIN-B). Chevron `▾`/`▸` wrapped with `accessibilityElementsHidden` + `importantForAccessibility="no"`. `useEffect` collapses both `expanded` and `showAll` when `count` transitions to 0. Legend `"Max = best week ever · Now = this week · To PR = remaining"` rendered only when `maxKg > 0`. **MIN-G applied**: callsite reads `prsQ.count` (was `prsQ.data`).
- `src/components/exercises-this-week-list.tsx` (edited) — Pass `maxLabel="Best session"` to `<MaxNowToPrLine>` for non-PR rows. For PR'd rows (when `row.priorMaxKg != null && row.overflowKg != null`), render `<PrListRow>` instead. Tap → `/(app)/exercises/{id}/progress`. PR pill markup deleted from the inline branch (now lives inside `<PrListRow>`).
- `app/(app)/workout/verdict/[sessionId].tsx` (edited) — Replaced inline PR row JSX with `<PrListRow>`. `currentKg` from `SessionPr` is no longer forwarded (it isn't rendered). Removed now-unused `Pressable` import. Behavior: byte-for-byte identical text + DOM order (the literal `"PR! +X kg (was Y kg)"` template is shared with the hero/list).
- `tests/unit/progress-page-math.test.ts` (edited) — added 6 new `computePrsThisWeek` cases: (a) empty → `[]`, (b) one PR exercise → entry with correct priors/current/overflow, (c) two PRs same week same exercise (800→900→1000) → `priorMaxKg=800, currentMaxKg=1000, overflowKg=200`, (d) PR-then-non-PR same week → `currentMaxKg = max(in-week) = 700` (MIN-D rewording, no parenthetical hedge), (e) sort `overflowKg DESC, exerciseId ASC`, (f) `priorMaxKg=0` (first-ever session) → NOT a PR. 65 tests in this file, 214 total.
- `tests/e2e/progress-page.spec.ts` (edited) — Test 6 ("PR badge") extended: tap hero a11y-label `"\d+ PRs this week"` → assert `"PR! +900 kg (was 1,500 kg)"` substring is visible. New test 8 added: tap hero count → accordion expands → tap the accordion row → URL matches `/exercises/${id}/progress`. Test numbering: existing test 7 (5-tab regression) intentionally kept at index 7 in file order; new test 8 inserted between 6 and 7. (No name collisions in Playwright; each test names is unique.)
- `tests/e2e/end-of-session-verdict.spec.ts` (unchanged) — design-v3 §"Test plan" requires the existing 7 verdict cases to pass unchanged. The byte-for-byte `"PR! +X kg (was Y kg)"` template restoration guarantees this.

## Deviations from design

- **None.** Every design-v3 §"Mudanças por arquivo" item is applied. MIN-G (callsite rename `prsQ.data` → `prsQ.count`) applied per the validation note.
- Minor: introduced a named exported type `PrThisWeek` (in `progress-page-math.ts`) instead of inlining the return-tuple in the function signature. This is a stylistic refactor required to satisfy the project's `@typescript-eslint/array-type` rule (forbids `Array<T>`, requires `T[]`). The contract surface and JSDoc semantics are unchanged. Recording this here per the Implementer rule on deviations.

## Soft callbacks made (during this implementation pass)

- None. All ambiguity in design-v3 was resolved by the prior validation cycle.

## Quality gates

- [x] `npm run typecheck` passed (clean)
- [x] `npm run lint` passed (0 errors, 1 warning — pre-existing in `router.d.ts`)
- [x] Relevant unit tests pass — `npm run test:unit` → **214 passed** (208 baseline + 6 new in the `computePrsThisWeek` describe block)
- [x] No new `any`
- [x] No new `// @ts-ignore`
- [x] No stray `console.log`

## Notes for Reviewer / Tester

- **Verdict screen byte-for-byte zero-behavior-change.** `<PrListRow>` reuses the existing `"PR! +X kg (was Y kg)"` copy and the existing emerald-pill markup. The verdict screen test suite was not touched and should pass unchanged. If a Tester runs `tests/e2e/end-of-session-verdict.spec.ts`, all 7 cases must pass.
- **Multi-PR week semantic (MIN-D).** When the user PRs multiple times in one week (800 → 900 → 1000), the hero shows `+200 (was 800)` — i.e. `priorMaxKg = pre-week lifetime max, currentMaxKg = max(in-week)`. PR-then-non-PR sequence (500 baseline → 700 PR → 600 in-week) yields `currentMaxKg = 700`, not 600 — test (d) pins this.
- **Hero accordion ordering.** `usePrsThisWeek` builds the `prsByExerciseId` Map from the kernel's already-sorted array (`overflowKg DESC, exerciseId ASC`). JS Map preserves insertion order, so `Array.from(prsByExerciseId.entries())` in the hero renders biggest PR first without re-sorting.
- **Top-5 cap behavior.** Top 5 visible by default; if more than 5 PRs in a week, a `"Show all (N)"` affordance is rendered after the 5th row. Inline expansion (no modal), per MIN-B.
- **Hook return shape changed.** `usePrsThisWeek` dropped `isError` (no callsite read it; safe). `data` renamed to `count`. The only consumer is `progress-hero.tsx`, updated. Tester: if any downstream code begins to read `prsQ.data`, it will now be undefined — currently no such consumer exists (grep verified).
- **Tester e2e selector.** New test 8 selects by accessibility role `"button"` with name pattern `/\d+ PRs this week/i`. If the Playwright snapshot drifts on web rendering of accessibility roles, consider falling back to `getByText("PRs this week").locator("..").click()` — left as a future hardening item, not blocking.
