# Implementation — 2026-05-19_2144_weekly-volume-stat

Based on: `design-v2.md` (final approved) and `validation-v2.md` (matching `go`, 6 non-gating minors).

## Files changed

- `src/utils/dates.ts` (new) — ISO-week bucketing helpers built on `date-fns` v4: `IsoWeek` type, `isoWeekStart(d)`, `weekKeyOf(d)` (returns `'YYYY-Www'`), `lastNIsoWeeks(n, now?)`. Device-local throughout (`startOfWeek`/`endOfWeek` with `weekStartsOn: 1`). Re-exports `parseISO` for callers. Label format uses the literal token `'M/d'`. Key uses `'RRRR-\'W\'II'` (ISO week-numbering year + zero-padded ISO week number) derived from the local Monday.
- `src/api/stats.ts` (new) — `WeeklyVolumeRow` type + `listWeeklyVolumeRows({ sinceUtc })`. Single Supabase query: `.from("sets").select("completed_at, weight, reps, set_type, sessions!inner(started_at, ended_at)").is("deleted_at", null).not("sessions.ended_at", "is", null).neq("set_type", "warmup").gte("completed_at", sinceUtc).order("completed_at", { ascending: true })`. No client-side reduction.
- `src/hooks/use-stats.ts` (new) — `useWeeklyVolume()` with hardcoded 8-week window, cache key `["stats", "weekly-volume", sinceUtc.slice(0,10)]`, `staleTime: 60_000`.
- `src/utils/units.ts` (edited) — added `formatVolume(kg, unit)`. Applies MIN-3 by rounding the converted value BEFORE comparing to 1000 (so `999.5 kg` rounds to 1000 → `"1.0k kg"`, avoiding the kg-vs-lbs asymmetry at the boundary). Existing `formatWeight` / `parseWeightToKg` / `kgToLbs` / `lbsToKg` exports are untouched.
- `src/components/weekly-volume-strip.tsx` (new) — presentational component, no props. Local `computeStripModel(data)` helper (per MIN-2) builds 8 zero-filled buckets, applies the existing kernel (`parseFloat(weight) * reps` guarded by `Number.isFinite && > 0`), and computes `maxKg` + `currentWeekKg`. Three render branches: (1) loading -> wrapper + 4 skeleton blocks including a date-label row placeholder per MIN-1, with `mt-1` between label and value (matches data branch); (2) error / no data / `maxKg === 0` -> bare `return null` before any wrapper; (3) data -> wrapper + header line + bars + Monday-`M/d` labels. Bucket math memoized on `data` only; `formatVolume(currentWeekKg, unit)` is inline so the unit toggle re-renders without busting the memo.
- `src/hooks/use-sessions.ts` (edited) — `useFinishSession.onSuccess` and `useSoftDeleteSession.onSuccess` each gain `qc.invalidateQueries({ queryKey: ["stats"] })`.
- `src/hooks/use-sets.ts` (edited) — `useLogSet.onSuccess`, `useUpdateSet.onSuccess`, `useDeleteSet.onSuccess` each gain `qc.invalidateQueries({ queryKey: ["stats"] })`. Arrow bodies switched from expression form to block form to accommodate the second statement.
- `app/(app)/history/index.tsx` (edited) — imported `WeeklyVolumeStrip`, `useWeeklyVolume`, and `useCallback`; mounted strip as `ListHeaderComponent={<WeeklyVolumeStrip />}` on the existing `FlatList`. Kept the existing `useSessions()` inline destructure per MIN-4; captured `useWeeklyVolume()`'s `refetch` and `isRefetching` into separately-named locals (`refetchWeekly`, `isRefetchingWeekly`). `onRefresh` is now a `useCallback` that awaits `Promise.all([refetch(), refetchWeekly()])`; `refreshing` is the logical OR of both query flags.

## Deviations from design

- **`use-stats.ts` — non-null assertion on `lastNIsoWeeks(8)[0]`**: TS `noUncheckedIndexedAccess` flagged `weeks[0]` as possibly undefined. Added a single `!` with an inline comment explaining the invariant (`lastNIsoWeeks(8)` always returns 8 entries). No `any`, no `// @ts-ignore`. Pure type-system accommodation; doesn't change runtime behavior.
- **`WeeklyVolumeRow` cast**: Supabase JS infers the joined `sessions!inner(...)` shape as `{ ... }[]` (array) rather than `{ ... }` (single) by default. Used `as unknown as WeeklyVolumeRow[]` to honor the design's typed contract. Matches the precedent in `src/api/progress.ts:20-21` which does the same kind of cast on the same `sessions!inner(...)` shape. No `any` introduced; the row contract is still typed downstream.
- **Component return type**: declared as `React.JSX.Element | null` instead of the design's `JSX.Element | null`. The global `JSX` namespace is no longer auto-imported under modern `@types/react`; `React.JSX.Element` is the supported form. Cosmetic; equivalent at the type level.

### Absorbed minors from validation-v2 (6 total)

- **MIN-1** (skeleton missing date-label-row stand-in + `mt-2` vs `mt-1` mismatch): loading branch now renders 4 skeleton blocks including the 4th `mt-1 h-3 w-full` placeholder for the date labels, and uses `mt-1` between label and value to match the data branch. No layout jump on data arrival.
- **MIN-2** (`computeStripModel` location): declared as a local helper inside `src/components/weekly-volume-strip.tsx`, scoped above the component. Not exported (no other caller needs it).
- **MIN-3** (`formatVolume` boundary at 999.5): rounded-then-compared. `Math.round(value) >= 1000` controls the shorthand branch, so 999.5 kg -> "1.0k kg" (not "1000 kg") and the kg-vs-lbs asymmetry at the boundary is gone. Documented in a JSDoc note on `formatVolume`.
- **MIN-4** (history destructure shape): kept the existing inline destructure of `useSessions()` (no refactor of touched files beyond the design ask). Captured `useWeeklyVolume()`'s `refetch`/`isRefetching` into separately-named locals (`refetchWeekly`, `isRefetchingWeekly`) so neither name collides with the sessions destructure.
- **MIN-5** (`useCallback` import): added `import { useCallback } from "react";` to `app/(app)/history/index.tsx`.
- **MIN-6** (volume kernel wording): used `set.weight ? parseFloat(set.weight) : 0` + `Number.isFinite(w) && w > 0 && r > 0` guard. The `Number.isFinite` check is technically redundant after the `> 0` test, but it makes the intent explicit and matches the design wording exactly.

## Soft callbacks made (during this implementation pass)

None. All ambiguity was either covered by the design or surfaced as a validator MIN that the design told me to absorb.

## Quality gates

- [x] `npm run typecheck` passed (`tsc --noEmit` clean)
- [x] `npm run lint` passed — only pre-existing warning is in `.expo/types/router.d.ts` (auto-generated; "unused eslint-disable directive"). All new/edited files: 0 warnings, 0 errors.
- [x] Relevant unit tests pass — `npm run test:unit` (5/5 in `tests/unit/formulas.test.ts`; no test file existed for `units.ts` or `dates.ts` before this run, so no regressions there)
- [x] No new `any` (one `as unknown as WeeklyVolumeRow[]` cast in `src/api/stats.ts`, justified by Supabase join inference — same pattern as `src/api/progress.ts`)
- [x] No new `// @ts-ignore`
- [x] No stray `console.log`

## Notes for Reviewer / Tester

### Where to look first
- `src/utils/dates.ts` — the only place that uses `date-fns`. Verify `weekKeyOf` and `lastNIsoWeeks` agree at the boundary (both derive from `startOfWeek(..., { weekStartsOn: 1 })` so they should). Verify the `'RRRR-\'W\'II'` format token actually produces `'YYYY-Www'` from `date-fns` v4 (it does; `R` = ISO week-numbering year, `I` = ISO week number).
- `src/api/stats.ts` — verify the `sessions!inner(...)` join correctly excludes in-progress sessions via `.not("sessions.ended_at", "is", null)` (parallels `src/api/progress.ts:14`).
- `src/components/weekly-volume-strip.tsx` — verify the three render branches match design pseudo-code, especially: (a) early `return null` happens BEFORE any wrapper View; (b) loading branch has 4 skeleton blocks (not 3); (c) `mt-1` (not `mt-2`) between label-skeleton and value-skeleton.
- `src/hooks/use-sessions.ts` + `src/hooks/use-sets.ts` — verify all 5 mutation hooks invalidate `["stats"]` on success: `useFinishSession`, `useSoftDeleteSession`, `useLogSet`, `useUpdateSet`, `useDeleteSet`.

### Tester scenarios
1. **Strip appears once any non-warmup, finished set exists in the last 8 weeks** — bare `return null` if all 8 buckets are zero (e.g. brand-new account, or 8 straight rest weeks).
2. **Unit toggle re-renders header inline** — flip `kg`/`lbs` on the Profile screen; the "This week" line should reformat without a network refetch (the memo on bucket math should NOT bust).
3. **Cache invalidation** — finish a workout, soft-delete a session, log/update/delete a set: the strip's "This week" value should reflect the change after the mutation resolves.
4. **Pull-to-refresh** — pulling the History list should refresh both `sessions` AND `stats` in parallel; spinner dismisses when both finish (TanStack's `refetch()` never rejects, so no hang).
5. **In-progress workout exclusion** — start a session, log a few non-warmup sets but DO NOT finish; the strip's "This week" value should NOT include those sets until the session is finished.
6. **Layout stability across loading -> data** — loading skeleton's total vertical height should equal the data branch's height (label + value + bars + bottom date-labels). No jiggle.
7. **Empty-state coexistence** — for an account with zero sessions, the "No sessions yet" screen renders (strip is inside the `FlatList`-branch which only mounts when `data && data.length > 0`, so the strip is correctly hidden in this case).
8. **`formatVolume` boundary** — visually verify 1000 kg renders as `"1.0k kg"` (not `"1000 kg"`). 999 kg renders as `"999 kg"`. 999.5 kg (won't show in real usage but unit-testable) rounds up to `"1.0k kg"`.

### Follow-up debt called out by design (not in scope here)
- `app/(app)/history/[id].tsx:130-142` per-session "Total volume" counts warmups; the strip excludes them. User-visible inconsistency until that file is fixed in a separate run.
- No `(user_id, completed_at)` index on `sets`. Tolerated at current scale (< 2k rows); follow-up migration recommended once the dataset grows.
- `formatWeight` on `SessionSummaryRow` still uses 1-decimal-always; this run intentionally does not collapse `formatVolume` and `formatWeight` into one helper.
