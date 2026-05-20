# Validation v2 — 2026-05-19_2144_weekly-volume-stat

Reviewing: `design-v2.md`

## Verification of Designer's claims (new in v2)

| Claim | Verified? | Evidence |
|---|---|---|
| `WeightUnit` is exported from a module reachable by `src/utils/units.ts` | **yes** | `src/db/types.ts:29` — `export type WeightUnit = "kg" \| "lbs";`. Already imported by `src/utils/units.ts:1` (`import type { WeightUnit } from "~/db/types"`). New `formatVolume(kg, unit: WeightUnit)` will reuse the same type without a new import. |
| Existing `formatWeight` signature pattern matches proposed `formatVolume` | **yes** | `src/utils/units.ts:13` — `formatWeight(kg: number \| null \| undefined, unit: WeightUnit): string`. v2's `formatVolume(kg: number \| null \| undefined, unit: WeightUnit): string` mirrors the nullable-kg + WeightUnit shape exactly. |
| `useFinishSession.onSuccess` and `useSoftDeleteSession.onSuccess` shape allows added invalidation | **yes** | `src/hooks/use-sessions.ts:53-63` (`useFinishSession.onSuccess` already calls 3 cache ops in arrow body) and `src/hooks/use-sessions.ts:89-98` (`useSoftDeleteSession.onSuccess` calls 2). Adding one more `qc.invalidateQueries(...)` line is mechanical and doesn't disturb other logic. |
| `qc` is the in-scope variable name in `use-sessions.ts` / `use-sets.ts` | **yes** | `src/hooks/use-sessions.ts:43,54,66,78,90` and `src/hooks/use-sets.ts:38,47,57` — all 8 mutation hooks use `const qc = useQueryClient();`. Convention is universal across the repo (`src/hooks/use-preferences.ts:21`, `src/hooks/use-exercises.ts:33`, etc.). v2's pseudo-code uses `qc` correctly. |
| `useLogSet`/`useUpdateSet`/`useDeleteSet` `onSuccess` shape allows added invalidation | **yes** | `src/hooks/use-sets.ts:41-42, 51-52, 60-61` — each `onSuccess` is a single-expression arrow returning `qc.invalidateQueries(...)`. Adding a second invalidation requires changing the arrow body from expression to block `{ ... }`; trivial. |
| `["stats"]` prefix is free (no existing query keys collide) | **yes** | `grep -r '"stats"' src` and `grep -r "queryKey:.*stats"` return zero hits in source. Only the design docs reference the key. Broad-prefix invalidation will not thrash any existing query. |
| `FlatList` `refreshing`/`onRefresh` props accept boolean + async callback | **yes** | `app/(app)/history/index.tsx:44-45`, `app/(app)/exercises/index.tsx:66-67`, `app/(app)/routines/index.tsx:66-67` all use the same `refreshing={boolean} onRefresh={fn}` shape. `Promise.all([refetch(), refetch()])` returns a Promise; TanStack's `refetch()` does NOT reject on error (it resolves with `{data, error}`), so the spinner will always dismiss when both finish. No hang risk. |
| `WeeklyVolumeRow[]` flows from `listWeeklyVolumeRows` to `useQuery` cleanly | **yes** | `useQuery<TData, TError>` infers `TData` from the `queryFn` return type. Existing precedent: `useExerciseProgress` (`src/hooks/use-progress.ts`) returns `SessionSets[]` via the same idiom. No-args `useWeeklyVolume(): UseQueryResult<WeeklyVolumeRow[], Error>` is consistent with this pattern. |
| RLS on `sets` and `sessions` is `auth.uid() = user_id` | **yes** | `supabase/migrations/0001_rls_and_seed.sql:25-44` — the `do $$` loop applies the same 4-policy template (select/insert/update/delete each checking `auth.uid() = user_id`) to all six user-owned tables including `sets` and `sessions`. v2's claim of "no new policy needed" is correct. |
| Only `(exercise_id, completed_at)` index on `sets`, no `(user_id, completed_at)` | **yes** | `supabase/migrations/0000_schema.sql:96-97` — `sets_session_idx (session_id)`, `sets_exercise_completed_idx (exercise_id, completed_at)`. The new range query (no `exercise_id` predicate) won't use the latter; v2's "tolerated at current scale" wording is accurate. |
| `date-fns` v4 in `package.json`, zero current usages | **yes** | `package.json:31` `"date-fns": "^4.1.0"`. `grep date-fns src/` and `grep date-fns app/` both return zero source matches; the only hits are docs and `package-lock.json`. v2 will be the first real importer. |
| Volume kernel `parseFloat(weight) * reps` with `Number.isFinite` guard matches existing | **partial** | `app/(app)/exercises/[id]/progress.tsx:42-49` uses `const w = set.weight ? parseFloat(set.weight) : 0; const r = set.reps ?? 0; if (w > 0 && r > 0)`. Existing kernel does NOT call `Number.isFinite`; design v2 §Mudanças says the strip uses the "existing kernel" but then adds "Number.isFinite" to it. Discrepancy is harmless (Number.isFinite is a superset of the `> 0` guard for parseFloat NaN, which `> 0` already rejects), but the wording in design is slightly inconsistent with what exists. Note for implementer, not a defect. |
| Loading-skeleton heights are proportionate to data-branch heights | **partial** | Data branch: `text-xs` (~12px) + `mt-1 text-2xl` (~28px) + `mt-4 h-24` (96px) + `mt-1` label row (~10px). Skeleton: `h-3` (12px) + `mt-2 h-7` (28px) + `mt-4 h-24` (96px). Skeleton OMITS a stand-in for the bottom date-label row, so there is a ~14 px height delta between loading-state and data-state, plus an `mt-1` vs `mt-2` mismatch (4px). Cosmetic — see MIN-1 below. |
| Pseudo-code `computeStripModel(data)` is unambiguously located | **partial** | The function is referenced in §UI spec pseudo-code (line 185 of design-v2) but the §Mudanças table only lists `src/components/weekly-volume-strip.tsx` as the new file. Implied to be a local helper inside that file; this is the reasonable default reading, but the design never spells it out. See MIN-2. |

## Issues found

### Blockers
(none)

### Majors
(none)

### Minors

- **[MIN-1]** Design §UI spec branch 1 — loading skeleton is missing a stand-in for the date-label row that exists in the data branch (the `<View className="mt-1 flex-row gap-1.5">{...labels}</View>` block), causing a ~14 px height delta when the component transitions from loading to data. Also `mt-2` between label and value-skeleton vs `mt-1` in the data branch is a 4px difference. Suggested fix: implementer adds a fourth `<View className="mt-1 h-3 w-full ..." />` block below the bar-area skeleton and changes `mt-2` to `mt-1`. Cosmetic; non-gating.

- **[MIN-2]** Design §UI spec pseudo-code line 185 — `computeStripModel(data)` is called but never explicitly declared as either (a) a local function inside `weekly-volume-strip.tsx` or (b) a separate export from `src/utils/dates.ts`. The §Mudanças table only lists three new files; by elimination it must be a local helper in the component file, but the design should say so. Suggested fix: add one line to the `src/components/weekly-volume-strip.tsx` row: "Contains a local `computeStripModel(data: WeeklyVolumeRow[]): StripModel` pure helper that does the bucketing." Non-blocking — implementer can infer.

- **[MIN-3]** Design §Contratos `formatVolume` — boundary behavior at v=999.5: the `>= 1000` branch is checked *before* `Math.round`, so 999.5 → "1000 kg" (4 digits, no shorthand), then 1000.0 → "1.0k kg". A 0.5-kg increase produces a wider display string. More importantly, **the shorthand boundary triggers asymmetrically across unit toggles**: 999 kg ("999 kg") becomes 999 × 2.20462 = 2203 lbs ("2.2k lbs") — same data, abbreviated in one unit and not the other. Suggested fix: either round-then-compare-to-1000 (so 999.5 → 1000 → "1.0k kg"), or accept the asymmetry as documented behavior. Either is fine; non-gating, but the contract should pick one. Mention in implementation notes.

- **[MIN-4]** Design §Contratos / History screen `onRefresh` — the existing `app/(app)/history/index.tsx:10` destructures `useSessions()` inline (`const { data, isLoading, isError, error, refetch, isRefetching } = useSessions();`). v2's pseudo-code switches to `const sessionsQ = useSessions();` and then reads `.refetch()`/`.isRefetching` off the object. Implementer will need to either (a) refactor the existing destructure to the object form, or (b) keep the destructure and capture `refetch`/`isRefetching` for both queries separately. Design does not call this out. Either approach works — flag for implementer.

- **[MIN-5]** Design imports — `app/(app)/history/index.tsx` currently does not import `useCallback`; v2's `onRefresh = useCallback(...)` requires adding it. Trivial but worth a note so the implementer doesn't miss an import. Non-gating.

- **[MIN-6]** Design §Mudanças `weekly-volume-strip.tsx` row — describes the kernel as `parseFloat(weight)`, `Number.isFinite`, `* reps`, guarded `> 0`. The actual existing kernel at `app/(app)/exercises/[id]/progress.tsx:42-49` uses `set.weight ? parseFloat(set.weight) : 0` (nullable-string short-circuit), no `Number.isFinite`. The guards are equivalent in effect (a `> 0` test on `parseFloat`'s result rejects NaN), but the design's wording slightly over-describes the existing kernel. Cosmetic; the implementer should follow whichever is more defensive (the design's version is fine).

## Issues raised in previous validation

| ID (from v1) | Addressed? | Notes |
|---|---|---|
| MAJ-1 (`formatWeight` shorthand mismatch) | **yes** | New `formatVolume(kg, unit)` declared in §Mudanças (`src/utils/units.ts` edited row) with explicit branching in §Contratos; §Alternativas item 7 justifies it as a separate helper rather than overloading `formatWeight`. Verified `WeightUnit` is exported from `src/db/types.ts:29` and reusable. |
| MAJ-2 (cache invalidation missing) | **yes** | §Mudanças adds `qc.invalidateQueries({ queryKey: ["stats"] })` to all 5 affected mutations across `use-sessions.ts` and `use-sets.ts`; §Contratos shows the exact `onSuccess` shapes; History `onRefresh` widened to `Promise.all`. Invalidation contract documented for future mutations. `["stats"]` prefix verified to not collide with any existing query key (grep clean). |
| MAJ-3 (null-return placement) | **yes** | §UI spec pseudo-code (lines 177-244) explicitly shows the three branches: (1) loading → wrapper + skeleton, (2) error/empty/all-zero → bare `return null` BEFORE any wrapper View, (3) data → wrapper + bars. The order of guards is unambiguous. |
| MIN-1 (bar-width "comfortable gutters") | **yes** | §UI spec "Bar sizing" now says `flex-1` per bar, container clips at device width. The 32 px claim is gone. |
| MIN-2 (`completed_at` index wording) | **yes** | §Riscos now reads "verified: no `(user_id, completed_at)` index exists ... tolerated at current scale; follow-up migration recommended". Cross-checked against `supabase/migrations/0000_schema.sql:96-97`. |
| MIN-3 (date-fns format directive) | **yes** | §Mudanças `src/utils/dates.ts` row explicitly directs the implementer to import `format` from `date-fns`, use literal `'M/d'`, and not `toLocaleDateString` / `Intl.DateTimeFormat`. |
| MIN-4 (sinceUtc TZ over-fetch) | **yes** | §Riscos documents the over-fetch as bounded and harmless because client-side bucketing is source of truth. |
| MIN-5 (useMemo deps + unit) | **yes** | §UI spec "Memoization rule" section says bucket math is `useMemo(..., [data])` with no `unit` in deps; display strings inline in JSX. |
| MIN-6 (render when ≥1 non-zero week) | **yes** | §UI spec branch 2 (`if (model.maxKg === 0) return null;`) is equivalent to "render only when at least one non-zero week exists". |
| MIN-7 (cache key omits user_id) | **yes** | §Mudanças `src/hooks/use-stats.ts` row spells out `["stats", "weekly-volume", sinceUtc.slice(0,10)]`; explicit note that user_id is omitted by convention. |
| MIN-8 (parseISO + local-time getters) | **yes** | §Mudanças `src/utils/dates.ts` row directs implementer to use `parseISO` and local-time getters; explicitly forbids `getUTCDay()`/`getUTCDate()`. |
| MIN-9 (drop weeks? prop) | **yes** | `WeeklyVolumeStrip()` and `useWeeklyVolume()` both take no args; 8 is hardcoded inside. §Contratos confirms. |
| MIN-10 (strip vs per-session total) | **yes** | §Riscos has an explicit line documenting the inconsistency; §Out of scope reiterates the per-session-total fix is a separate follow-up run. |
| MIN-11 (loading renders skeleton, not zero-bars) | **yes** | §UI spec branch 1 renders three skeleton placeholder blocks — explicitly not a zero-bar grid. (Note minor height-delta to data branch — see MIN-1 above.) |

## Decision

**go**

Reasoning:
- 0 blockers, 0 majors, 6 minors.
- All 3 v1 majors and all 11 v1 minors are resolved in v2 with verifiable contract changes (verified against `src/utils/units.ts`, `src/hooks/use-sessions.ts`, `src/hooks/use-sets.ts`, `app/(app)/history/index.tsx`, `supabase/migrations/0000_schema.sql`, `supabase/migrations/0001_rls_and_seed.sql`).
- The 6 v2 minors are all cosmetic / wording / boundary-edge issues that the Implementer can absorb without going back to the Designer. None of them change the architecture or contracts.
- New `["stats"]` query-key prefix verified to not collide with any existing key (grep over `src/` returned zero hits).
- `Promise.all([refetch(), refetch()])` is safe — TanStack `refetch()` does not reject; spinner dismisses correctly when both complete.
- RLS verified against `0001_rls_and_seed.sql:25-44`: `auth.uid() = user_id` applied to both `sets` and `sessions` via the same loop.

Known minor debt to track during implementation:
1. Skeleton missing date-label-row stand-in → 14 px layout jiggle (MIN-1).
2. `formatVolume` boundary at 999.5 produces "1000 kg" (no shorthand); decide rounding-vs-comparison order (MIN-3).
3. `computeStripModel` should be a local helper inside `weekly-volume-strip.tsx` (MIN-2).
4. History destructure may need refactoring to object form (MIN-4); add `useCallback` import (MIN-5).
