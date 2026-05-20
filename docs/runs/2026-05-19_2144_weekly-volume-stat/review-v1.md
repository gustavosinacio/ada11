# Review v1 — 2026-05-19_2144_weekly-volume-stat

Reviewing: the diff for the implementation against `design-v2.md` and `validation-v2.md` (go, 6 non-gating minors).

## Diff scope
- Diff command: `git diff b51dd014d62e2d4d11cf3b1883284720c3e2d5e7...HEAD`
- Files changed: 8 (4 new, 4 edited)
- Lines: +172 / -8 (4 edits totalling +51/-8; 4 new files summing to ~121 lines net new)
- New files: `src/utils/dates.ts`, `src/api/stats.ts`, `src/hooks/use-stats.ts`, `src/components/weekly-volume-strip.tsx`
- Edited files: `src/utils/units.ts`, `src/hooks/use-sessions.ts`, `src/hooks/use-sets.ts`, `app/(app)/history/index.tsx`

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| `src/utils/dates.ts` uses `date-fns` v4, `weekStartsOn: 1`, device-local | yes | `src/utils/dates.ts:29` `WEEK_OPTS = { weekStartsOn: 1 as const }`; `startOfWeek`/`endOfWeek` are called on local Dates. |
| `weekKeyOf` derives the key from the **local Monday** (matches `lastNIsoWeeks`) | yes | `src/utils/dates.ts:45-47` — `format(isoWeekStart(d), "RRRR-'W'II")`. Same input as `lastNIsoWeeks` (`format(start, "RRRR-'W'II")` at line 63). Keys will never disagree at bucket boundaries. |
| `listWeeklyVolumeRows` query shape (5 filters + order) matches design | yes | `src/api/stats.ts:21-30` — all 5 clauses present in declared order; matches §Contratos verbatim. |
| `useWeeklyVolume` cache key is `["stats", "weekly-volume", sinceUtc.slice(0,10)]`, `staleTime: 60_000` | yes | `src/hooks/use-stats.ts:23,25`. |
| `formatVolume` rounds-then-compares (MIN-3 fix) | yes | `src/utils/units.ts:41-45` — `Math.round(value) >= 1000` precedes the shorthand branch; trace at 999.5 kg → `rounded=1000` → `(999.5/1000).toFixed(1)` = `"1.0k kg"`. |
| All 5 mutation hooks invalidate `["stats"]` on success | yes | `useFinishSession` (`use-sessions.ts:61`), `useSoftDeleteSession` (`use-sessions.ts:97`), `useLogSet` (`use-sets.ts:43`), `useUpdateSet` (`use-sets.ts:55`), `useDeleteSet` (`use-sets.ts:66`). All 5 confirmed. |
| Render-branch order: early `return null` BEFORE any wrapper View (except loading) | yes | `src/components/weekly-volume-strip.tsx:87-89` — three bare `return null` statements before the `<View …>` in branch 3 (line 93). Loading branch (line 75) has its own wrapper as designed. |
| `computeStripModel` is a local pure helper inside the component file | yes | `src/components/weekly-volume-strip.tsx:34-60` — declared above the component, not exported, no I/O. |
| Loading skeleton has 4 placeholder blocks including a date-label row | yes | `src/components/weekly-volume-strip.tsx:78-81` — 4 `<View>` skeletons: label (h-3 w-20), value (h-7 w-32), plot (h-24 w-full), label row (h-3 w-full). |
| `useCallback` imported in History | yes | `app/(app)/history/index.tsx:2` — `import { useCallback } from "react";`. |
| `isRefetching` is logical-OR of both queries | yes | `app/(app)/history/index.tsx:56` — `refreshing={isRefetching \|\| isRefetchingWeekly}`. |
| `onRefresh` is `useCallback` awaiting `Promise.all([refetch(), refetchWeekly()])` | yes | `app/(app)/history/index.tsx:20-22`. |
| No new `any` types | yes | `as unknown as WeeklyVolumeRow[]` cast in `src/api/stats.ts:32` mirrors `src/api/progress.ts:21` precedent (same `sessions!inner(...)` join inference issue). |
| No new `// @ts-ignore` | yes | grep returned 0 hits in new/edited files. |
| `weeks[0]!` non-null assertion is justified — `lastNIsoWeeks(8)` always returns 8 entries | yes | `src/utils/dates.ts:54-67` — loop runs `i = 7..0` (8 iterations), always pushes 8 entries; assertion is sound. Inline comment at `use-stats.ts:18-20` explains it. |
| `date-fns` imports are explicit (not wildcard) | yes | `src/utils/dates.ts:1-7` — named imports for `endOfWeek`, `format`, `parseISO`, `startOfWeek`, `subWeeks` only. Tree-shake-friendly. |
| NativeWind tokens match design's dark-mode tokens | yes | All 7 design tokens (border, bg, text-primary, text-muted, bar-current, bar-past, bar-zero, skeleton) reproduced verbatim in `weekly-volume-strip.tsx`. |
| Strip mounted as `ListHeaderComponent` on the existing `FlatList`, not wrapping it in a `ScrollView` | yes | `app/(app)/history/index.tsx:48`. No `ScrollView` added. |
| `npm run typecheck` clean | yes | Re-ran `tsc --noEmit` — exits 0, no output. |
| `npm run lint` — only the pre-existing `router.d.ts` warning | yes | Re-ran — confirmed: 0 errors, 1 warning, all in auto-generated `router.d.ts`. |
| `npm run test:unit` — 5/5 in `formulas.test.ts` | yes | Re-ran — 5/5 passed in 222 ms. |

## Issues

### Blockers
(none)

### Majors
(none)

### Minors

- **[MIN-1]** `src/utils/dates.ts:70-71` — `parseISO` is imported and re-exported solely so `weekly-volume-strip.tsx` doesn't need a second `from "date-fns"` import. This is a small convenience deviation from the design (design only listed `isoWeekStart`, `weekKeyOf`, `lastNIsoWeeks` as exports), but it's defensible because it concentrates the `date-fns` import surface in one place (the design's intent per §Riscos "first-import discoverability"). Severity minor / debt — leave as-is, but worth a brief note in the module header next time so a future reader knows the re-export is intentional. Fix: optionally rename the trailing comment to "Re-exported intentionally so `~/utils/dates` is the single date-fns import surface for app code." (current comment is close but reads as "for fewer imports", which understates the design rationale).

- **[MIN-2]** `src/components/weekly-volume-strip.tsx:104` — the `model.maxKg === 0` short-circuit inside the bar `.map` is dead code because branch 2 (`if (model.maxKg === 0) return null;` at line 89) returns before this loop runs. Harmless defensive guard, but minor dead-code-ish. Fix (optional): drop the ternary and inline `Math.max(MIN_BAR_HEIGHT, Math.round((b.totalKg / model.maxKg) * PLOT_HEIGHT))`. Leaving it is fine — the cost is one extra branch per render of 8 bars.

- **[MIN-3]** `src/utils/units.ts:42` — the `formatVolume` boundary doc-comment says "999.5 kg rounds to 1000 and renders as '1.0k kg', avoiding the kg-vs-lbs asymmetry where the same underlying volume would abbreviate in one unit and not the other." Strictly speaking, the kg-vs-lbs asymmetry is **not** eliminated — at 999 kg (under boundary, no shorthand → `"999 kg"`), the lbs equivalent is 2202 lbs (rounded ≥ 1000 → `"2.2k lbs"`). The fix only collapses the 999.5 cliff, not the cross-unit asymmetry. The validator's MIN-3 explicitly said this asymmetry is "fine" / "either approach works", so this is not a defect — only the comment overclaims. Fix (cosmetic): tighten the comment to "avoiding the 999.5 boundary cliff" rather than the broader "kg-vs-lbs asymmetry". Non-gating.

## Security checklist
- [x] **RLS** — `sets` and `sessions` are RLS-protected via `auth.uid() = user_id` (`supabase/migrations/0001_rls_and_seed.sql:25-44`, applied via the `do $$` loop). No new tables in this diff.
- [x] **Service role** — no `SUPABASE_SERVICE_ROLE_KEY` reference in any new/edited file (grep clean across all 8 files).
- [x] **Raw SQL / `rpc`** — no `.rpc(...)` calls in the new code; all data access through the supabase-js builder (`.from().select().is().not().neq().gte().order()`).
- [x] **`EXPO_PUBLIC_*`** — no new env vars introduced.

## Style / convention checklist
- [x] **No new `any`** — confirmed by grep. The one cast (`as unknown as WeeklyVolumeRow[]` in `src/api/stats.ts:32`) mirrors the pre-existing precedent at `src/api/progress.ts:21` for the same Supabase `sessions!inner(...)` inference issue.
- [x] **No new `// @ts-ignore`** — confirmed by grep.
- [x] **Comments narrate *why*, not *what*** — module header in `src/utils/dates.ts` explains *why* device-local (not UTC); `computeStripModel` JSDoc explains *why* it's local (validator MIN-2); `formatVolume` JSDoc explains *why* it's distinct from `formatWeight`; `use-stats.ts` explains *why* `sinceUtc.slice(0,10)` and *why* no `user_id`. All good.
- [x] **Imports follow project style** — package imports first, blank line, then `~/`-relative imports. Verified in all 4 new files.
- [x] **New files placed in conventional folders** — `src/utils/dates.ts` (utility), `src/api/stats.ts` (API), `src/hooks/use-stats.ts` (hook), `src/components/weekly-volume-strip.tsx` (presentational). All match `docs/playbook.md` / project convention.

## Quality-gate re-run (Reviewer-side)
- `npm run typecheck` → clean (`tsc --noEmit` exits 0).
- `npm run lint` → 0 errors, 1 warning, all in pre-existing auto-generated `router.d.ts` (not in this diff).
- `npm run test:unit` → 5/5 pass in `tests/unit/formulas.test.ts`.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 3 minors. All 3 minors are cosmetic / dead-code-ish / doc-precision and are shippable as documented debt.
- All 6 validation-v2 minors were correctly absorbed (verified one-by-one against the implementation).
- The 3 implementer-declared deviations (non-null assertion on `weeks[0]!`, `as unknown as WeeklyVolumeRow[]` cast, `React.JSX.Element` over `JSX.Element`) are all justified, all match precedent, and all preserve type safety.
- Design fidelity is high: every line of UI pseudo-code, every filter clause in the query, every NativeWind class, every cache-key shape, every mutation invalidation lands in the diff exactly as specified.
- Security checklist: clean. No RLS gap, no service-role leak, no rpc-injection surface, no public-env-var exposure.
- Style/convention checklist: clean. No new `any`, no new `ts-ignore`, comments explain *why*, imports and file locations follow project convention.
