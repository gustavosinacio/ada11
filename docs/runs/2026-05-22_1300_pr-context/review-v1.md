# Review v1 — 2026-05-22_1300_pr-context

Reviewing: the diff against `design-v3.md` (final) + `validation-v3.md` (go w/ 1 mechanical minor MIN-G applied).

## Diff scope

- Diff command: `git diff ccc3d7294435f5a44bc403a9e81d2fec38ad36fc...HEAD`
- Files changed (code only, excluding docs/runs artefacts):
  - **New**: `src/components/pr-list-row.tsx`
  - **Edited**: `src/utils/progress-page-math.ts`, `src/hooks/use-progress-page.ts`, `src/components/max-now-to-pr-line.tsx`, `src/components/progress-hero.tsx`, `src/components/exercises-this-week-list.tsx`, `app/(app)/workout/verdict/[sessionId].tsx`, `tests/unit/progress-page-math.test.ts`, `tests/e2e/progress-page.spec.ts`
- Sanity: `tsc --noEmit` → No errors found.

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| **MAJ-A** verdict copy restored byte-for-byte: `"PR! +X kg (was Y kg)"` | yes | `pr-list-row.tsx:55` literal template matches baseline `verdict/[sessionId].tsx` JSX at commit `ccc3d72` exactly: same `Text` wrapper className (`mt-1 text-sm tabular-nums text-emerald-700 dark:text-emerald-400`), same emerald PR pill markup, same Pressable a11y attrs (`accessibilityRole="button"`, `accessibilityLabel="${name}, view progress"`, same container className). |
| **MAJ-B** kernel signature `{rows, currentWeekStartIso, currentWeekEndIso}` | yes | `progress-page-math.ts:225-229` — signature matches; wrapper at `:310-315` calls it cleanly. |
| **MIN-G** `progress-hero.tsx` reads `prsQ.count` (not `prsQ.data`) | yes | `progress-hero.tsx:46` `const count = prsQ.count;`. Grep across `src/` + `app/` confirms only this file consumes `prsQ.*`; no dangling `prsQ.data` reader exists. |
| Hook wiring: `useExercisesThisWeek` consumes the map from `usePrsThisWeek()` | yes | `use-progress-page.ts:203` `const { prsByExerciseId } = usePrsThisWeek();`. Memo at `:205-288` reads `prsByExerciseId.get(exId)` once per row. TanStack's prefix cache + shared `useLifetimeWeeklyVolume` dep means the inner `computePrsThisWeek` runs once per render. |
| Legend gating on `maxKg > 0` | yes | `progress-hero.tsx:153` `{maxKg > 0 ? ... : <Log your first session> }`. Legend text at `:163` only renders inside the truthy branch. |
| Accordion top-5 cap + "Show all (N)" | yes | `progress-hero.tsx:85-86` slice + overflow flag; `:135-146` "Show all" Pressable; tap toggles `showAll`, rendering full list. Chevron `aria-hidden` via `accessibilityElementsHidden` + `importantForAccessibility="no"` at `:106-110`. `hitSlop` at `:99`. Collapse-on-empty effect at `:47-52` resets both `expanded` + `showAll`. |
| Per-row `<MaxNowToPrLine maxLabel="Best session">` | yes | `exercises-this-week-list.tsx:135` passes `maxLabel="Best session"` to the non-PR branch. `max-now-to-pr-line.tsx:35` default param `"Max"`. |
| Verdict refactor: zero behavior change | yes | Compared `git show ccc3d72:app/(app)/workout/verdict/[sessionId].tsx` lines 173-196 against current `<PrListRow>` rendering. Identical: container `className`, inner `View` layout, font weights, emerald PR pill, copy template, accessibilityRole/Label, `onPress` target. The mapping `pr.overflowKg` + `pr.priorMaxKg` from `SessionPr` is unchanged. `currentKg` was never rendered in the prior version either. |
| Kernel ordering: `overflowKg DESC, exerciseId ASC` | yes | `progress-page-math.ts:289-292`. Unit test (e) at `progress-page-math.test.ts:686-742` exercises both criteria. |
| Multi-PR semantic 800→900→1000 → `priorMaxKg=800, currentMaxKg=1000, overflowKg=200` | yes | Test (c) at `progress-page-math.test.ts:623-652`. Kernel logic at `:266-277` captures `priorAtFirstWeekPr` once + tracks running `currentMaxKg`. Test (d) at `:654-684` pins the PR-then-non-PR case (700 stays as `currentMaxKg`, not the later 600). |

## Issues

### Blockers

- None.

### Majors

- None.

### Minors

- None.

## Notes (non-issues, observed during review)

- `progress-hero.tsx:42` `isLoading` does not include `exercisesQ.isLoading`. If `prsQ` resolves but `exercisesQ` is still cold (unlikely — both hang off cached lifetime read), the accordion would render "Unknown exercise" briefly. Pre-existing fallback at `:64`; out of scope for this diff. Worth a follow-up but not blocking.
- `useEffect` at `progress-hero.tsx:47-52` includes `expanded` + `showAll` in the deps array to satisfy `react-hooks/exhaustive-deps`. The guard `if (count === 0)` makes this safe (re-runs are idempotent setters that early-out when state is already `false`).
- `computePrsThisWeek` JSDoc at `progress-page-math.ts:196-199` correctly disambiguates from `SessionPr.currentKg` per design-v3 §"Contratos de I/O".
- `PrThisWeek` named export at `:215-223` is a stylistic substitution for the inline return type per `@typescript-eslint/array-type` (forbids `Array<T>`). Surface unchanged — recorded in implementation.md.

## Security checklist

- [x] **RLS**: no new `from('table').*` calls — kernel + hooks only consume existing `useLifetimeWeeklyVolume()` which lands on already-RLS-protected `sets` + `sessions`. No new tables.
- [x] **Secrets**: no `SUPABASE_SERVICE_ROLE_KEY` referenced in any file under `src/` or `app/` that this diff touches. The `tests/e2e/progress-page.spec.ts` reference is pre-existing test-only code, not bundled to client.
- [x] **Input handling**: no raw SQL `rpc` calls; no user-typed input fed to queries.
- [x] **Public env vars**: no new `EXPO_PUBLIC_*` references.

## Style / convention checklist

- [x] **No new `any`.** Grepped diff for `: any` and `<any>` — none introduced.
- [x] **No new `// @ts-ignore`.** None.
- [x] **Comments narrate *why*, not *what*.** Spot-checked: `progress-page-math.ts:196-214` JSDoc explains disambiguation + semantics; `use-progress-page.ts:200-202` MIN-C comment explains the cache-sharing rationale; `progress-hero.tsx:44-45` collapse-on-empty comment explains the *why* (RLS reload, week rollover, undo). All narrative.
- [x] **Imports follow project style.** `~/` aliases used consistently; package imports first, then `~/` (`pr-list-row.tsx:1-4`, `progress-hero.tsx:1-13`, etc.).
- [x] **New files placed in conventional folder.** `src/components/pr-list-row.tsx` — matches `src/components/{kebab-case}.tsx` convention.

## Decision

**pass**

Reasoning:
- 0 blockers + 0 majors + 0 minors.
- All design-v3 §"Mudanças por arquivo" items applied; MAJ-A and MAJ-B regressions from v2 closed; MIN-G mechanical fix applied per validation-v3.
- Verdict screen byte-for-byte equivalence verified against baseline commit (`ccc3d72`); the existing 7 verdict e2e cases should hold without modification.
- Unit-test plan delivers all 6 new `computePrsThisWeek` cases (a-f); 214 unit tests passing per Implementer report.
- Security + style checklists clean.

Recommendation to Conductor: `invoke Tester`.
