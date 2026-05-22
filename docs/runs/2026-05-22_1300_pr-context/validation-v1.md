# Validation v1 — 2026-05-22_1300_pr-context

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## Verified claims (highlights)

- `computePrExerciseIdsThisWeek` at `progress-page-math.ts:204-253` already tracks `priorMax` at lines 240-249 and discards it. The extension only needs to capture, not recompute.
- Verdict PR row pattern at `verdict/[sessionId].tsx:172-195` matches the per-muscle list PR pill (`exercises-this-week-list.tsx:111-117`) byte-for-byte. Clean extraction candidate.
- `<MaxNowToPrLine>` does NOT serve `<VolumeTargetSlot>` — that surface has its own bespoke render. Three places use `Max · Now · To PR` semantics: hero, per-muscle list, live-strip slot.
- `usePrsThisWeek` has one consumer (`progress-hero.tsx:26`); refactor risk is bounded.
- Day-zero empty branch (`maxKg === 0` in `progress-hero.tsx:58-70`) doesn't render the triplet at all.

## Issues

### Blockers
**None.**

### Majors

- **[MAJ-1] Legend semantics collide with per-row triplet.** Designer's hero legend reads `"Max = best week ever · Now = this week · To PR = remaining"`. That's correct for the hero (`maxKg = bestWeekQ.data.totalKg`). But the per-row `Max` in `<ExercisesThisWeekList>` comes from `computeLifetimeMaxPerExercise` — it's the **lifetime best single-session volume per exercise**. Same word, different meaning, same page. Locking in the legend as "Max = best week ever" makes the per-row rows actively misleading.
  - **Fix (pick one)**:
    - (a) Anchor the legend with a scope label, e.g. `"This week vs your best week ever — Max = your best week's total · Now = this week's total · To PR = remaining"`. Per-row context is then visibly different.
    - (b) Add a scope-aware second legend under per-row triplets (Designer descartou em Alt #5 — re-evaluate).
    - (c) Rename so the same word never means two things — e.g., per-row `Max` → `Best session`, OR hero `Max` → `Best week`.

- **[MAJ-2] Two redundant lifetime walks.** Designer's "join via second kernel call" claims the two `useMemo`s share work. They don't — they're in different hook closures (`usePrsThisWeek` + `useExercisesThisWeek`), each walks the lifetime rows independently. Re-introduces a duplication pattern Reviewer-v1 has flagged before.
  - **Fix**: hoist the PR-row enrichment into `usePrsThisWeek` (return `{count, prIds, prsByExerciseId: Map<string, {priorMaxKg, currentMaxKg, overflowKg}>}`). `useExercisesThisWeek` consumes the map by id when joining. One walk per render.

### Minors

- **[MIN-1]** Legend must opt out in day-zero empty-state branch (`maxKg === 0` doesn't render the triplet).
- **[MIN-2]** Chevron glyph `▾`/`▸` leaks into screen reader. Mark `accessibilityElementsHidden` (iOS) / `importantForAccessibility="no"` (Android), or wrap in `aria-hidden`. A11y label goes on the parent `Pressable`.
- **[MIN-3]** No `hitSlop` / min-touch-target on tappable count. Spec `hitSlop` or vertical `py-2`.
- **[MIN-4]** No spec for `expanded` state when `prs` transitions to 0. Add an effect to collapse, OR guard render on `interactive && expanded`.
- **[MIN-5]** Same-week multi-PR semantic (first in-week PR's `priorMax`). User PRs 800→900→1000 in one week → display says `+100 (was 800)` while later screens show lifetime max = 1000. Inconsistency. Alternative: `currentMaxKg = best in-week session volume` so overflow = best-this-week − pre-week-max. Pin behavior + add a test.
- **[MIN-6]** No max-height cap on accordion. 10 PRs would push everything below fold. Consider 5-row cap + "Show all" or accept.
- **[MIN-7]** Line-number drift in test references (cosmetic).
- **[MIN-8]** Field naming: `currentKg` (verdict) vs `currentMaxKg` (this kernel). Be deliberate; JSDoc clearly.
- **[MIN-9]** Test plan misses "PR-then-non-PR session same week" case.
- **[MIN-10]** E2E selector `getByText("1")` brittle to "1 PR" eyebrow. Use a11y label on the `Pressable` instead.

## Decision

**`no-go`**

Reasoning:
- 0 blockers + 2 majors → no-go.
- Both majors are surgical. Expect tight v2.

Round 1 of 3. 2 rounds remaining.

## Counts

`{ blockers: 0, majors: 2, minors: 10 }`

## Recommendation to Conductor

`invoke Designer for re-design (v2)`. Required:
1. **MAJ-1**: pick legend strategy explicitly. Recommend (c) — rename hero's `Max` to `Best week` (or per-row to `Best session`). Cleaner long-term than wrapping the existing terms in scope copy.
2. **MAJ-2**: hoist PR-row enrichment into `usePrsThisWeek`, return `prsByExerciseId: Map`. Single walk.
3. Minors absorbed in v2.
