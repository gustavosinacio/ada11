# Validation v1 — 2026-05-19_2144_weekly-volume-stat

Reviewing: `design-v1.md`

## Verification of Designer's claims

| Claim | Verified? | Evidence |
|---|---|---|
| `app/(app)/history/index.tsx` uses a `FlatList` and has a viable `ListHeaderComponent` slot | **yes** | `app/(app)/history/index.tsx:34-46` — `FlatList` is rendered in the "has-data" branch with `refreshing={isRefetching}` and `onRefresh={refetch}`. No `ListHeaderComponent` today; adding one is non-invasive. **However**, the `FlatList` only renders when `data && data.length > 0` — see Major below. |
| Volume kernel at `app/(app)/exercises/[id]/progress.tsx:29-68` skips warmup, uses `parseFloat(weight) * reps` | **yes** | Lines 41-49 confirm: `if (set.set_type === "warmup") continue;` then `const w = set.weight ? parseFloat(set.weight) : 0; const r = set.reps ?? 0; if (w > 0 && r > 0) { sessionVolume += w * r; }`. Design's "loose working sets" interpretation is exactly this. |
| `SetRow.weight` is `string \| null` and `reps` is `number \| null` in Supabase return shape | **yes** | `src/db/types.ts:111-112` — `reps: number \| null; weight: string \| null;`. |
| `set_type` enum values are `'warmup' \| 'working' \| 'dropset'` so `.neq("set_type", "warmup")` is safe | **yes** | `src/db/types.ts:28` `SetType = "warmup" \| "working" \| "dropset"`. `src/db/schema.ts:160-163` `CHECK (set_type IN ('warmup','working','dropset'))`. `supabase/migrations/0000_schema.sql:66` confirms at DB level. `.neq("set_type", "warmup")` is valid PostgREST against a `text` column. |
| `sessions!inner(...)` join syntax is the established pattern | **yes** | `src/api/progress.ts:13` uses `.select("*, sessions!inner(id, started_at, ended_at)").not("sessions.ended_at", "is", null)` — identical shape to what design proposes. |
| `date-fns` v4 is in `package.json` and currently has zero usages | **yes** | `package.json:31` — `"date-fns": "^4.1.0"`. `grep date-fns src/` returns no matches; this would be the first import. |
| `useWeightUnit()` returns the current unit and is a TanStack subscription | **yes** | `src/hooks/use-preferences.ts:15-18` — wraps `usePreferences()` which is a `useQuery` on `["preferences", "me"]`. Re-renders automatically on toggle. |
| `formatWeight(kg, unit)` signature | **yes** | `src/utils/units.ts:13-17` — `formatWeight(kg: number \| null \| undefined, unit: WeightUnit): string`. Returns `${value.toFixed(1)} ${unit}`. **But the design's "12.4k kg" shorthand is NOT what `formatWeight` does** — see Major below. |
| TanStack Query AsyncStorage persister is in place | **yes** | `src/lib/query-client.ts:19-22` creates `queryPersister`; `app/_layout.tsx:41-43` wraps the tree with `PersistQueryClientProvider` and `maxAge: 7 days`. Any new query key auto-persists. |
| RLS on `sets` and `sessions` is `auth.uid() = user_id` (no service role) | partial — assumed | Migration files cited but RLS policies not re-read this round; design claim that no new policy is needed is consistent with `src/api/progress.ts` working as-is for the same join. Confidence: medium. |
| One round trip (no N+1) | **yes** | Proposed query is one `.from("sets").select(...).is(...).not(...).neq(...).gte(...).order(...)`. PostgREST returns sets + embedded `sessions` rows in a single call. |
| `set_type !== 'warmup'` consistency between server filter and bucket math | **yes** | Server-side `.neq("set_type", "warmup")` plus discovery's note that the existing per-exercise chart uses the same predicate makes the two readouts numerically consistent. |
| `sets_exercise_completed_idx` is the only relevant index | **yes** | `supabase/migrations/0000_schema.sql:97` — `CREATE INDEX "sets_exercise_completed_idx" ON "sets" USING btree ("exercise_id","completed_at");`. There is **no** `(user_id, completed_at)` index. Range query without `exercise_id` predicate will not use this index — see Minor. |
| Pull-to-refresh would not break with `ListHeaderComponent` | **yes (mechanically)** | `FlatList`'s `ListHeaderComponent` is part of the scrollable surface; `refreshing` + `onRefresh` continue to work. **However**, this only refreshes the sessions query — see Major on stale cache. |
| Dark-mode token names match codebase | **yes** | `bg-white dark:bg-black`, `text-black dark:text-white`, `text-gray-500`, `border-gray-200 dark:border-gray-800` all appear at e.g. `app/(app)/history/index.tsx:14`, `app/(app)/history/[id].tsx:171,194,198,207,231`. Design's bar colors (`bg-blue-500 dark:bg-blue-400`, `bg-gray-300/700`, `bg-gray-200/800`) are not yet in the codebase but are valid Tailwind tokens. |

## Issues found

### Blockers

(none)

### Majors

- **[MAJ-1]** Design §UI spec — "Header value: `formatWeight(currentWeekKg, unit)` with a `k` shorthand when ≥ 1000 (e.g. `12.4k kg`, `27.3k lbs`)". **`formatWeight` does not do `k`-shorthand.** `src/utils/units.ts:13-17` always returns `${value.toFixed(1)} ${unit}` — so for a 12,400 kg week it would render `12400.0 kg`, not `12.4k kg`. The design also says "Reuses the existing idiom from `app/(app)/exercises/[id]/progress.tsx:117`" — but that idiom is a custom `formatValue` callback inline in the ProgressChart props, *not* part of `formatWeight`. **Suggested fix**: in v2, either (a) define a new helper `formatVolume(kg, unit)` in `src/utils/units.ts` that applies the `k` shorthand explicitly and call it out as a new helper (not "reuses formatWeight"), or (b) drop the shorthand and call `formatWeight` as-is, accepting `12400.0 kg` (ugly but consistent). Recommend (a) and add it to "Mudanças por arquivo".

- **[MAJ-2]** Design §Riscos — Cache invalidation is missing. The new query key `["stats", "weekly-volume", weeks, sinceUtc.slice(0,10)]` is **not** invalidated by any existing mutation:
  - `useFinishSession` (`src/hooks/use-sessions.ts:53-63`) only invalidates `["sessions"]` and `["sessions", "active"]`.
  - `useLogSet`/`useUpdateSet`/`useDeleteSet` (`src/hooks/use-sets.ts:37-63`) only invalidate `["sets", sessionId]`.
  - `useSoftDeleteSession` (`src/hooks/use-sessions.ts:89-98`) — same, only sessions keys.

  Combined with the cache being persisted to AsyncStorage for 7 days (`app/_layout.tsx:43`) and `staleTime: 30_000` global default (`src/lib/query-client.ts:8`), the strip will display **stale numbers after the user finishes a workout, logs a set, edits a set, or deletes a session** — until the screen unmounts/remounts past staleTime. The History tab is the *primary* surface where the user expects to see updated totals after finishing a workout. Pull-to-refresh on the FlatList only re-fires `useSessions.refetch`, not the new stats query. **Suggested fix**: in v2, declare explicit invalidation contracts:
  1. Extend `useFinishSession.onSuccess` to also `qc.invalidateQueries({ queryKey: ["stats"] })`.
  2. Extend `useLogSet`/`useUpdateSet`/`useDeleteSet` to invalidate `["stats"]` as well (or scope to `["stats", "weekly-volume"]` if we add multiple stats later).
  3. Extend the History screen's `onRefresh` to also trigger `useWeeklyVolume`'s refetch (or use a wrapper that refetches both).

  This must be in design v2 — it's not implementation-detail; it's a cross-cutting change to 3 existing hook files.

- **[MAJ-3]** Design §Mudanças, §UI spec — strip placement vs. "no sessions yet" empty state. The design says the strip is mounted as `ListHeaderComponent` on the `FlatList`, and the "No sessions yet" branch is "untouched — strip only appears when there is at least one session." This is mechanically true (the FlatList is conditionally rendered), but it's a behavioral assertion in a confusing place. The harder edge: what if the user has finished sessions older than 8 weeks (so the *sessions list shows rows*) but zero working volume inside the 8-week window? Design §UI spec branch (1) says the strip "component returns null" when `data?.length === 0` — but the parent `FlatList` would then render with `ListHeaderComponent={<WeeklyVolumeStrip />}` and the strip returns `null`. **Need to confirm `ListHeaderComponent` accepting a component that returns `null` does not insert an empty 0-height container that still draws a border or padding.** Per the design, the outer `View` of the strip has `border-b border-gray-200 px-4 py-5`, so if the conditional rendering happens *inside* the component (after the outer View), the user gets a phantom 80px-tall empty padded box with a divider below the screen title. **Suggested fix**: the `null` return must happen at the **top** of `WeeklyVolumeStrip`, before any wrapping View. Spell this out in design v2 with explicit pseudo-code:
  ```tsx
  if (!isLoading && (isError || !data || data.length === 0 || maxKg === 0)) return null;
  ```

### Minors

- **[MIN-1]** Design §Decisions row 6 — "8 bars at ~32 px wide each leaves comfortable gutters on a 360 px-wide viewport". Math: 8 bars × 32 px = 256 px + 7 gaps × 6 px (gap-1.5) = 42 px → 298 px. Plus container `px-4` = 32 px = 330 px. That's tight, not "comfortable", on a 360 px viewport. On older phones at 320 px (e.g. iPhone SE 1st gen, still nominally supported), it overflows. The design later notes "320 px is below our supported floor" — but `react-native-web` runs on browser widths down to whatever the user resizes to. The fallback (`flex-1` so bars shrink) is fine; just remove the misleading "comfortable gutters" rationale. Suggested fix: in v2, drop the 32 px claim; just state "`flex-1` per bar, container clips at device width". No behavior change.

- **[MIN-2]** Design §Query / DB contract — "Indexed scan on `sets.completed_at` is required for the `.gte()` to be efficient — **need to verify there is an index** on `sets.completed_at` (or `(user_id, completed_at)`)". I verified: **there is no such index.** The only `(*, completed_at)` index is `sets_exercise_completed_idx` on `(exercise_id, completed_at)` (`supabase/migrations/0000_schema.sql:97`), which the new query won't use because it has no `exercise_id` predicate. At single-user scale this is a non-issue (seq-scan of ≤ 2000 rows is microseconds). Design already flags this as "leave the index out of this run". OK to defer, but the assertion in the design that the index *might* exist is wrong; it doesn't. Suggested fix: change wording in v2 from "need to verify" to "verified: no `(user_id, completed_at)` index exists; tolerated at current scale; follow-up migration recommended".

- **[MIN-3]** Design §UI spec / §Open Q #2 — labels use `format(date, 'M/d')`. `date-fns` v4 `format` requires the user to import `format` from `date-fns` and treats the format string as a token string by default (case-sensitive: `'M/d'` = month/day-of-month, no padding). Designer is correct that `date-fns` treats `'M/d'` literally regardless of locale. Just confirm in v2 that the implementer should import `format` from `date-fns` and not `Intl.DateTimeFormat` or `toLocaleDateString`. No code-level issue; this is a directive for the Implementer.

- **[MIN-4]** Design §Query — `.gte("completed_at", sinceUtc)` is fine, but `sinceUtc` is derived from `lastNIsoWeeks(weeks)[0].start.toISOString()`, where `start` is a **local-time** Monday 00:00. JS `Date.toISOString()` converts to UTC, so `sinceUtc` is the UTC equivalent of local Monday 00:00 BRT (e.g. `2026-03-30T03:00:00.000Z` for BRT). Sets logged between local Sunday 21:00 and Monday 00:00 (3 hours earlier in UTC = `2026-03-30T00:00:00 – 2026-03-30T03:00:00Z`) belong to the previous local-week, but are after the UTC `sinceUtc` cutoff for the *next* run — so they get pulled into the bucket. That's actually fine. **The reverse edge** is the concern: a set logged at local Monday 00:30 (= UTC `+03:30Z` in BRT) is included because it's after `sinceUtc`. The bucket logic on the client will assign it to the local Monday-week correctly. **No correctness issue, but the `sinceUtc` boundary may pull a few sets from the prior local-week if the user is east of UTC** (BRT is west; this never bites in practice). Worth a one-line comment in the implementation: "We over-fetch slightly to cover TZ skew; client-side bucketing is the source of truth."

- **[MIN-5]** Design §Open Q #5 — Designer asks "should the validator confirm `unit` is in `useMemo` deps?" Yes, the implementer must include `unit` in the deps of any `useMemo` that produces displayable strings or applies `kgToLbs`. Since math stays in kg and conversion happens at the render boundary (`formatWeight(kg, unit)`), this only matters if the bucket computation includes display strings. Recommendation: bucket math (`maxKg`, per-bar `totalKg`) goes in one `useMemo([data])`; display labels are computed inline in JSX so they auto-react to `unit`. Just spell this out in v2.

- **[MIN-6]** Design §Open Q #3 — "Should the strip render when only the current week has data and all 7 prior weeks are zero?" Designer proposes yes (8 bars, 7 flat). I agree — it's correct and consistent. The strip should appear as soon as there's any non-zero week in the window. The "7 flat bars" look is informative ("you didn't train then, you trained this week") and matches the design's rest-week treatment. Resolved as proposed; no change needed.

- **[MIN-7]** Design §Open Q #1 — Cache key proposal `["stats", "weekly-volume", weeks, sinceUtc.slice(0,10)]`. The `user_id` is **not** in the key. `useSessions` (`src/hooks/use-sessions.ts:20-25`) and `useExerciseProgress` (`src/hooks/use-progress.ts:5-11`) also omit `user_id` from their keys — they rely on RLS scoping the data and on user-switch invalidating the whole cache. Convention is consistent; the proposed key matches the existing pattern. OK as-is. No change needed beyond confirming in v2.

- **[MIN-8]** Design §Riscos — "Mitigation: bucketing is recomputed on every render from `parseISO(row.completed_at)`". JS `new Date(isoString)` (and `date-fns`'s `parseISO`) parse to a UTC-equivalent `Date` object, whose `.getDay()`/`.getDate()`/etc methods return **local** values. So the TZ behavior the designer wants is what JS gives you for free. Worth confirming this is what the implementer relies on (and **not** `getUTCDate()` etc.).

- **[MIN-9]** Design §Component props — `WeeklyVolumeStrip` accepts optional `weeks` prop defaulting to 8 but is only ever called with no args from `history/index.tsx`. The optional prop adds an API surface that no caller uses. Recommend either (a) drop the prop and hardcode 8 inside, or (b) keep it and pass `weeks={8}` explicitly from the History screen for grep-ability. Either is fine; pick one in v2 for clarity.

- **[MIN-10]** Design §Out of scope — design correctly defers the inconsistency at `app/(app)/history/[id].tsx:130-142` (counts warmups in single-session "Total"). However, since this run is *specifically* about volume on the History surface, leaving the per-session total inconsistent means **the strip's "This week" total will not match the sum of the per-session totals displayed when the user taps into individual sessions in the same week.** That's a user-visible inconsistency. Flag for a follow-up run, but the design should explicitly call out in §Riscos that "users will see strip-week-total != sum-of-per-session-totals for any week with warmup sets" so the implementer doesn't field a "bug" report. Suggested fix: add a one-line risk callout; no code change.

- **[MIN-11]** Design §UI spec — bar height formula `Math.max(4, Math.round((totalKg / maxKg) * 96))` — when `totalKg = 0` and `maxKg > 0`, the formula gives `Math.max(4, 0) = 4`. Correct. When `maxKg = 0` (every bucket zero), the design separately handles it as `height = 4`. Also correct. Good. Just confirm in v2 that the loading skeleton (`h-24 w-full rounded-sm bg-gray-100`) renders before `data` resolves, *not* a zero-bar empty grid (the latter could read as "you've done nothing in 8 weeks" which is misleading).

## Decision

**no-go**

Reasoning:
- 2 majors (cache invalidation MAJ-2 + `formatWeight` shorthand mismatch MAJ-1) + 1 borderline major (`ListHeaderComponent` null-render placement MAJ-3) push past the "≤1 major" threshold. Per the validator decision rule (≥2 majors → no-go), Designer must revise.

Specific changes the Designer must make in v2:

1. **MAJ-1 (formatting)**: Either add a new `formatVolume(kg, unit)` helper to `src/utils/units.ts` (and declare it in §Mudanças por arquivo) with the `k`-shorthand logic explicit, OR drop the shorthand and accept `formatWeight`'s `"12400.0 kg"` output. State which.

2. **MAJ-2 (cache invalidation)**: Add a §Mudanças entry for `src/hooks/use-sessions.ts` and `src/hooks/use-sets.ts` — each mutation that changes set/session state must also `qc.invalidateQueries({ queryKey: ["stats"] })`. Decide a stable prefix (e.g. `["stats"]`) and document the contract: "any mutation that affects sets or sessions must invalidate `['stats']`". Also state how pull-to-refresh on the History list will refresh both queries (one shared refetch handler, or both `useSessions` and `useWeeklyVolume` refetch in parallel).

3. **MAJ-3 (null-render placement)**: Add explicit pseudo-code in §UI spec showing that the `null` early-return happens **before any wrapper `View`** in `WeeklyVolumeStrip`, so that an empty `ListHeaderComponent` does not draw padding/border chrome.

Minors (MIN-1 through MIN-11) can be folded into v2 as polish but are not gating. The Implementer can also address them downstream.
