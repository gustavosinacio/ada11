# Design v1 — 2026-06-01_1301_favorite-exercises-e1rm

## Goal (1 sentence)
Let the sole user mark exercises as favorite (star toggle on the exercise detail page, optimistic) and have favorited+plottable exercises pinned INTO the existing Phase-2a "Estimated 1RM per exercise" chart IN ADDITION to (union with) the auto-selected most-performed top-N.

## Approach

This is a **mirror-then-diverge** feature on two known-good siblings (per the prior-run lesson: mirror the sibling 1:1, name the single material divergence). The data/API/hook/RLS layer mirrors the `exercise_notes` triad (`0010_exercise_notes.sql` / `src/api/exercise-notes.ts` / `src/hooks/use-exercise-note.ts`) with three simplifications justified below: composite PK instead of partial-UNIQUE (no soft-delete), no `body`/`updated_at`/trigger, plain INSERT/DELETE instead of the 23505 read-then-write loop. The chart integration mirrors the Phase-2a e1RM presenter (`presentTopExerciseE1rm`) and diverges in exactly ONE place: the `.slice(0, topN)` selection gate (`e1rm-strength.ts:148`) becomes a deterministic **union-then-cap** over `favorites ∪ top-N`, producing a single rank-dense `series[]`.

Two crux decisions drive everything else:

1. **The union/cap rule (THE central decision).** A single merged, densely-ranked list, built so `rank` (= array index) stays 0-based dense — the palette indexes by `rank`. Order: top-N most-performed first (existing comparator), then favorited-not-in-topN (same comparator), deduped by id. The headline risk is the **palette/color-collision** problem: `E1RM_PALETTE` has 8 hexes and `colorForRank(i) = PALETTE[i % 8]` (`e1rm-strength-section.tsx:29-41`), with the source comment explicitly assuming N≤8. I resolve it by **extending the palette to a dense 12-color array AND capping the total at the new ceiling of 12**, dropping the lowest-ranked NON-favorites first so favorites are guaranteed visible (the user asked for them). See Decision #1/#2 for the exact, deterministic, unit-testable rule.

2. **The seam.** The union happens INSIDE `presentTopExerciseE1rm` (a new optional `favoriteExerciseIds?` arg), so the section + chart need ZERO selection-logic changes except the palette ceiling, and "exactly one place decides the plotted set" is preserved. **Invariant F (byte-for-byte):** when `favoriteExerciseIds` is absent/empty, the presenter output is provably identical to today — the union arm is a no-op and the cap stays at `topN` (5). This is the "new optional dependency reproduces old numbers when absent" pattern that paid off in the bodyweight-volume run.

Standard mirror-then-diverge footers apply: a **"What is NOT in this algorithm"** clause (Decision #2) forbids the dead patterns (separate-list ranks, favorites bypassing eligibility, dropping a favorite under the cap), and the prose defers to the pinned contract (carry-in MIN-1 lesson — no second looser natural-language version that can drift).

## Mudanças por arquivo

One responsibility per file. The kernel function changed is `presentTopExerciseE1rm`; its call sites are closed below (Discovery §3 Grep A: 1 production caller + the unit test file — both in the table).

| File | Type | Change (one responsibility) |
|---|---|---|
| `supabase/migrations/0020_user_exercise_favorites.sql` | new | The favorites join table + 3 RLS policies (SELECT/INSERT/DELETE). **Implementer writes the FILE; Conductor applies** (`state.md:17`). DDL in §"Migration DDL". |
| `src/db/schema.ts` | edited | Add the `userExerciseFavorites` Drizzle table after `exerciseNotes` (`:304`) + import `primaryKey` from `drizzle-orm/pg-core` (`:2-13`). Typing mirror only — SQL is source of truth. |
| `src/db/types.ts` | edited | Add `UserExerciseFavorite`/`NewUserExerciseFavorite` Drizzle types (after `ExerciseNote`, `:37-38`) + a `UserExerciseFavoriteRow` PostgREST row type (after `ExerciseNoteRow`, `:262`). |
| `src/api/exercise-favorites.ts` | new | `listMyFavoriteExerciseIds()` / `addFavorite(id)` / `removeFavorite(id)`. Auth-gated like notes. Plain INSERT/DELETE (no 23505 loop). Contract in §"I/O contracts". |
| `src/hooks/use-exercise-favorites.ts` | new | `useMyFavoriteExerciseIds()` (query, key `["exercise_favorites","me"]`) + `useToggleFavorite()` (optimistic add/remove via `onMutate`/`onError`/`onSettled`). |
| `app/(app)/exercises/[id]/progress.tsx` | edited | Mount the star toggle in the header-right slot, OUTSIDE the `canEdit` gate (so it shows for canonical exercises too). 1 import (`Star`/`StarOff` + the hook) + the header-right JSX. Responsibility: the favorite affordance. |
| `src/utils/e1rm-strength.ts` | edited | Thread `favoriteExerciseIds?: ReadonlySet<string>` into `presentTopExerciseE1rm`; replace `.slice(0, topN)` (`:148`) with the union-then-cap selection. Responsibility: the plotted-set decision (the data model). |
| `src/components/e1rm-strength-section.tsx` | edited | Read `useMyFavoriteExerciseIds()`, add to the `useMemo` deps (`:48-51`), pass `favoriteExerciseIds` to the presenter; extend `E1RM_PALETTE` to 12 hexes + update the comment. Responsibility: wire favorites into the chart + widen the palette ceiling. |
| `tests/unit/e1rm-strength.test.ts` | edited | Extend with the favorites-union cases (Test plan §A). |
| `tests/unit/exercise-favorites-api.test.ts` | new | API unit test mirroring `exercise-notes-api.test.ts` (auth-gate, list, add/remove). |
| `tests/rls.test.ts` | edited | Add a `user_exercise_favorites` cross-user arm after the `routine_exercise_sets` arm (`:398`, before the `console.log`). |
| `tests/e2e/favorite-exercises-e1rm.spec.ts` | new | e2e: favorite a non-top-N weighted exercise on the detail page → its chip/line appears in the chart; unfavorite → it leaves. |

**NOT touched (regression surface, Decision #7):** the volume/muscle chart, `presentWeeklyVolumeByMuscle`, `<MultiSeriesChart>`, `multi-series-chart.tsx`, `app/(app)/progress/index.tsx` (mounts `<E1rmStrengthSection/>` with no props), `app/(app)/exercises/[id]/index.tsx` (the EDIT form — NOT the detail page; Discovery §2 correction), and every other exercise surface (picker, library, history).

## Combine-rule decision (THE central design decision — explicit)

### The merged-list algorithm (operates on `ranked`, the fully-sorted eligible list)

Today the presenter builds `byExercise` for **every eligible (weighted) exercise** in `rows`, then sorts by the comparator and `.slice(0, topN)` (`e1rm-strength.ts:138-148`). The change replaces ONLY the slice:

```
let sorted = Array.from(byExercise.values()).sort(comparator); // unchanged comparator
// comparator = sessions DESC → lastActiveMs DESC → name ASC → id ASC (e1rm-strength.ts:139-147)

const favSet = favoriteExerciseIds ?? EMPTY_SET; // ReadonlySet<string>, default empty

// Partition the FULLY-SORTED list (preserves comparator order within each part):
const favorites    = sorted.filter((a) =>  favSet.has(a.id));      // eligible favorites, in comparator order
const nonFavorites = sorted.filter((a) => !favSet.has(a.id));      // the rest, in comparator order

// Auto-selected most-performed: the top-N non-favorites (existing behavior preserved
// for the non-favorite pool).
const autoTop = nonFavorites.slice(0, topN);

// Union = favorites ∪ autoTop, deduped by id (a favorite already in autoTop is NOT
// duplicated — it's in `favorites`, so exclude it from autoTop by construction since
// autoTop is drawn from nonFavorites only → no overlap possible).
// Order: favorites FIRST (comparator order), then autoTop (comparator order).
let selected = [...favorites, ...autoTop];

// Cap at the readable ceiling. Favorites are guaranteed visible; drop the
// LOWEST-RANKED NON-FAVORITES first (autoTop is already comparator-sorted, so
// trimming from the tail drops the least-performed).
if (selected.length > E1RM_MAX_LINES) {
  const keptAuto = autoTop.slice(0, Math.max(0, E1RM_MAX_LINES - favorites.length));
  selected = [...favorites, ...keptAuto];
  // If favorites alone exceed E1RM_MAX_LINES, favorites are themselves trimmed
  // from the tail (lowest-comparator favorites drop) — see ceiling note below.
  if (favorites.length > E1RM_MAX_LINES) selected = favorites.slice(0, E1RM_MAX_LINES);
}

const ranked = selected; // feeds the existing `ranked.map((agg, rank) => …)` (:151) unchanged
```

Then the existing `ranked.map((agg, rank) => …)` (`:151`) assigns `rank` = array index over the FINAL combined list → ranks stay **0-based dense**, palette indexes correctly.

### The cap / palette resolution (headline risk — spelled out)

- **Ceiling:** `E1RM_MAX_LINES = 12` (new exported const in `e1rm-strength.ts`). `topN` stays `E1RM_TOP_N = 5` (the auto-selected non-favorite cap is unchanged).
- **Palette:** extend `E1RM_PALETTE` from 8 to **12 distinct hexes** in `e1rm-strength-section.tsx` so `colorForRank(i) = PALETTE[i % 12]` never wraps within the ceiling. (12 ≥ E1RM_MAX_LINES, so no two plotted lines ever share a color.)
- **Why 12, not "extend to N":** an unbounded palette would force either programmatic color generation (low contrast at high counts — readability degrades past ~10 lines on a 200px-tall chart) or a wrapping palette (color collision). A fixed readable ceiling with a matched palette is deterministic and unit-testable. 12 = 5 auto + headroom for up to 7 favorites simultaneously plotted, which comfortably covers the sole-user intent ("add a few exercises by favoriting them").
- **Cap drops NON-favorites first:** when `favorites.length + topN > 12`, the lowest-ranked auto (most-performed) entries are trimmed so favorites stay visible. Favorites are only trimmed in the degenerate case of >12 favorites (then the lowest-comparator favorites drop — they are persisted in the DB and reappear when the user unfavorites others).
- A favorited exercise with NO plottable e1RM data (bodyweight-only, all `weight=0`) never enters `byExercise` (eligibility gate `:109`), so it is naturally absent from `sorted` → absent from `favorites` → excluded from the chart series. **The favorite ROW still exists in the DB** (the toggle persists it), so the line appears the instant the user logs a weighted set. State preserved; chart line gated by Invariant D.

### Invariant F — byte-for-byte when no favorites (the regression guarantee)

When `favoriteExerciseIds` is `undefined` or empty: `favSet` is empty → `favorites = []` → `selected = [...[], ...nonFavorites.slice(0, topN)]` = `nonFavorites.slice(0, topN)`. Since `nonFavorites === sorted` (no exercise is a favorite), this is exactly `sorted.slice(0, topN)` — the current `.slice(0, topN)` output. The cap branch never fires (`selected.length ≤ topN = 5 < 12`). Ranks, names, values, LOCF, weeks: identical. **Provably unchanged** — pinned by unit test (Test plan §A, case "empty favorites = current output").

## Contratos de I/O

### `src/utils/e1rm-strength.ts` — the changed kernel

```ts
/** Default cap on plotted lines (auto-selected most-performed). Unchanged. */
export const E1RM_TOP_N = 5;

/**
 * Readable ceiling on TOTAL plotted lines (auto top-N ∪ favorites). Matched by
 * E1RM_PALETTE length (≥ this) so colorForRank never wraps within the ceiling.
 * When favorites + top-N exceed this, the LOWEST-RANKED NON-FAVORITES drop
 * first (favorites are guaranteed visible).
 */
export const E1RM_MAX_LINES = 12;

export function presentTopExerciseE1rm(args: {
  rows: WeeklyVolumeRow[];
  exercises: ExerciseRow[];
  topN?: number;                         // default E1RM_TOP_N — unchanged
  favoriteExerciseIds?: ReadonlySet<string>; // NEW. Absent/empty → Invariant F.
  now?: Date;                            // injectable for tests — unchanged
}): E1rmStrengthModel;
```

`E1rmSeries` and `E1rmStrengthModel` types are UNCHANGED. `rank` semantics unchanged (0-based dense over the FINAL list). The destructure becomes `const { rows, exercises, topN = E1RM_TOP_N, favoriteExerciseIds, now = new Date() } = args;`.

### `src/api/exercise-favorites.ts` — new

```ts
import { supabase } from "~/lib/supabase";

/** Returns the current user's favorite exercise_ids. `[]` when unauthenticated. */
export async function listMyFavoriteExerciseIds(): Promise<string[]>;
//   auth-gate → [] when no user (mirror exercise-notes.ts:14-16)
//   SELECT exercise_id FROM user_exercise_favorites WHERE user_id = uid
//   → data.map(r => r.exercise_id as string)

/** Idempotent favorite. Swallows SQLSTATE 23505 (already favorited) as success. */
export async function addFavorite(exerciseId: string): Promise<void>;
//   auth-gate → throw "Not authenticated" when no user
//   .insert({ user_id: uid, exercise_id: exerciseId })
//   if (error && error.code !== "23505") throw error;  // 23505 = PK dup = already favorited

/** Removes the favorite. No-op if absent (DELETE affects 0 rows, no error). */
export async function removeFavorite(exerciseId: string): Promise<void>;
//   auth-gate → throw "Not authenticated" when no user
//   .delete().eq("user_id", uid).eq("exercise_id", exerciseId)
//   if (error) throw error;
```

No 23505 retry LOOP (notes needs it because a note is update-or-insert of a mutable body against a *partial* unique; a favorite is presence/absence against a *non-partial* composite PK — INSERT + idempotent-swallow is correct and sufficient). No `.upsert()` (legal here, but a plain INSERT is simpler and the idempotent swallow covers the double-tap race).

### `src/hooks/use-exercise-favorites.ts` — new

```ts
const KEYS = { list: ["exercise_favorites", "me"] as const };

/** Reader: the whole set of favorite ids (the chart needs the set; the star
 *  derives isFavorite = data.includes(id)). Returns string[]. */
export function useMyFavoriteExerciseIds(): UseQueryResult<string[]>;
//   useQuery({ queryKey: KEYS.list, queryFn: listMyFavoriteExerciseIds })

/** Optimistic toggle. `favorited` = the NEXT desired state (true → add). */
export function useToggleFavorite(): UseMutationResult<
  void, unknown, { exerciseId: string; favorited: boolean }, { prev?: string[] }
>;
//   mutationFn: ({ exerciseId, favorited }) =>
//     favorited ? addFavorite(exerciseId) : removeFavorite(exerciseId)
//   onMutate: async ({ exerciseId, favorited }) => {
//     await qc.cancelQueries({ queryKey: KEYS.list });
//     const prev = qc.getQueryData<string[]>(KEYS.list);
//     qc.setQueryData<string[]>(KEYS.list, (old = []) =>
//       favorited ? Array.from(new Set([...old, exerciseId]))
//                 : old.filter((x) => x !== exerciseId));
//     return { prev };
//   },
//   onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(KEYS.list, ctx.prev); },
//   onSettled: () => qc.invalidateQueries({ queryKey: KEYS.list }),
```

**Load-bearing wiring (Discovery §6):** the e1RM section reads `useMyFavoriteExerciseIds()` and adds its `data` to the `useMemo` deps, so the optimistic `setQueryData` re-renders the chart instantly (the new line appears/disappears) AND the star flips instantly — same cache, two readers.

### `src/components/e1rm-strength-section.tsx` — wiring + palette

```ts
// 1. read favorites:
const { data: favoriteIds } = useMyFavoriteExerciseIds();
// 2. memoize the set + thread into the presenter + add to deps:
const favoriteSet = useMemo(() => new Set(favoriteIds ?? []), [favoriteIds]);
const model = useMemo(() => {
  if (!rows || !exercises) return null;
  return presentTopExerciseE1rm({ rows, exercises, favoriteExerciseIds: favoriteSet });
}, [rows, exercises, favoriteSet]);   // favoriteSet IS a dep → chart re-renders on toggle
// 3. extend E1RM_PALETTE to 12 hexes (add 4 distinct readable hexes after lime-500)
//    and update the comment (no longer "N=5 ≤ 8"; now "≥ E1RM_MAX_LINES so no wrap").
```

The four added palette hexes (deterministic, high-contrast against the existing 8): `#f97316` (orange-500), `#14b8a6` (teal-500), `#a855f7` (purple-500), `#eab308` (yellow-500). All other section logic (seriesKeys, visible-set seeding, check-all, chartSeries map, empty-state) is UNCHANGED — it auto-derives from `model.series` (Discovery §3 rows 7-11).

### `app/(app)/exercises/[id]/progress.tsx` — star toggle (header-right, outside `canEdit`)

Mount point decision: **header-right slot, alongside the Pencil**, but the star is built OUTSIDE the `canEdit` predicate (the Pencil gate). The existing `headerRight` (`:108-122`) is `canEdit ? () => <Pencil/> : undefined`. Change it to ALWAYS render the star, and render the Pencil only when `canEdit`:

```tsx
const { data: favoriteIds } = useMyFavoriteExerciseIds();
const toggleFavorite = useToggleFavorite();
const isFavorite = !!id && (favoriteIds ?? []).includes(id);

// headerRight (always present — favorite is a user-private action independent of
// edit rights; canonical exercises ARE favoritable):
headerRight: () => (
  <View className="flex-row items-center">
    <Pressable
      onPress={() =>
        toggleFavorite.mutate({ exerciseId: id, favorited: !isFavorite })
      }
      accessibilityRole="button"
      accessibilityLabel={
        isFavorite ? `Unfavorite ${exercise.data?.name ?? "exercise"}`
                   : `Favorite ${exercise.data?.name ?? "exercise"}`
      }
      className="px-2 py-1"
    >
      <Star
        color={isFavorite ? "#f59e0b" : (colorScheme === "dark" ? "#fff" : "#000")}
        fill={isFavorite ? "#f59e0b" : "transparent"}
        size={20}
      />
    </Pressable>
    {canEdit ? (
      <Pressable onPress={() => router.push(`/(app)/exercises/${id}`)} /* …Pencil unchanged… */>
        <Pencil … />
      </Pressable>
    ) : null}
  </View>
),
```

Import `Star` from `lucide-react-native` (`:2`, alongside `ChevronLeft`, `Pencil`). Import the two hooks. **A11y label is UNIQUE per Discovery #9** — `"Favorite <Name>"` / `"Unfavorite <Name>"` does NOT collide with the legend chip's `"Toggle <Name>"` (`e1rm-strength-section.tsx:143`). Optimistic via `useToggleFavorite()` (the star fills instantly).

### DB columns / queries (favorites table)

`user_exercise_favorites`: `user_id uuid NOT NULL`, `exercise_id uuid NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`, composite PK `(user_id, exercise_id)`. No `id` surrogate, no `deleted_at`, no `updated_at`, no CHECK, no trigger, no partial-unique. RLS: 3 policies, all gated `auth.uid() = user_id`.

### `UserExerciseFavoriteRow` (PostgREST row type, `src/db/types.ts`)

```ts
export type UserExerciseFavoriteRow = {
  user_id: string;
  exercise_id: string;
  created_at: string;
};
```

## Migration DDL (0020 — Implementer writes, Conductor applies)

```sql
-- =============================================================================
-- 0020_user_exercise_favorites.sql
-- Hand-written. Per-(user, exercise) favorite pointers. A favorite is
-- presence/absence — no body, no soft-delete, no mutable column. Used to pin
-- favorited exercises into the e1RM strength chart (union with the auto top-N).
--
-- Diverges from 0010_exercise_notes.sql:
--   - composite PK (user_id, exercise_id) instead of a uuid surrogate +
--     partial UNIQUE (no soft-delete → no WHERE deleted_at IS NULL predicate);
--   - FK exercise_id ON DELETE CASCADE (a favorite is a disposable pointer, not
--     authored content — if an exercise is ever hard-deleted the favorite
--     vanishes, it does not block. Notes used RESTRICT because a note IS
--     content. App soft-deletes exercises today (exercises.ts:99-105), so
--     neither fires in practice — CASCADE is the cleaner intent here);
--   - 3 RLS policies (SELECT/INSERT/DELETE) — no UPDATE (no mutable column);
--   - no touch_updated_at trigger (nothing to touch).
-- =============================================================================

create table public.user_exercise_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);
-- The composite PK gives the UNIQUE constraint AND the (user_id, exercise_id)
-- read index for free — no separate index needed (every read filters on user_id,
-- and the toggle filters on the full pair).

alter table public.user_exercise_favorites enable row level security;

drop policy if exists user_exercise_favorites_select on public.user_exercise_favorites;
create policy user_exercise_favorites_select on public.user_exercise_favorites
  for select using (auth.uid() = user_id);

drop policy if exists user_exercise_favorites_insert on public.user_exercise_favorites;
create policy user_exercise_favorites_insert on public.user_exercise_favorites
  for insert with check (auth.uid() = user_id);

drop policy if exists user_exercise_favorites_delete on public.user_exercise_favorites;
create policy user_exercise_favorites_delete on public.user_exercise_favorites
  for delete using (auth.uid() = user_id);
```

**Canonical exercises are favoritable (confirmed, Discovery §5).** The FK targets `exercises.id` regardless of owner. The widened `exercises_select` policy (`0011:28-30`) lets any authed user read canonical rows; the favorites row's `user_id` is always the favoriting user, so the favorites RLS (`auth.uid() = user_id`) is satisfied. No special-casing needed.

## Drizzle schema mirror (`src/db/schema.ts`, after `:304`)

```ts
export const userExerciseFavorites = pgTable(
  "user_exercise_favorites",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.exerciseId] }),
    // RLS (3 policies) lives in supabase/migrations/0020_user_exercise_favorites.sql.
    // SQL is source of truth.
  }),
);
```

Requires importing `primaryKey` into the `drizzle-orm/pg-core` import block (`:2-13`) — verified NOT currently imported. (`timestamp` and `uuid` ARE already imported, `:11-12`.)

## "What is NOT in this algorithm" (forbidding clause — carry-in discipline)

The union-then-cap selection MUST NOT:
- **Build favorites as a SEPARATE list with its own 0-based ranks** — that collides palette indices with the top-N. There is ONE list, ranked dense 0..M-1 (Discovery §3 row #4).
- **Let a favorite bypass eligibility (Invariant D)** — a favorited bodyweight-only/no-set exercise never enters `byExercise` and is NOT injected; it is excluded by being absent from `sorted`, not by a special favorites branch.
- **Drop a favorite under the cap before dropping an auto (non-favorite) entry** — the cap trims `autoTop` from the tail first; favorites are only trimmed in the degenerate >12-favorites case.
- **Mutate the comparator** — favorites do NOT re-sort by recency or anything else; they keep the existing `sessions DESC → lastActiveMs → name → id` comparator (`:139-147`). The ONLY change is the slice → union-then-cap.
- **Use `effectiveWeightKg`, `+=`, zero-fill, or any volume-presenter pattern** — Invariants D, E1, LOCF (`:13-25`) are unchanged.

## Riscos

- **Data integrity — RLS (Confidence HIGH / Risk MEDIUM).** New table + 3 policies all gated `auth.uid() = user_id`. The INSERT `with check` is the load-bearing one: B must NOT be able to insert a row with `user_id = A`. Mirrors the `exercise_notes` arm exactly. Pinned by the new RLS test arm (Test plan §C). The composite PK + non-null FKs prevent orphan/duplicate rows by construction.
- **Data integrity — FK ON DELETE CASCADE divergence (Confidence HIGH / Risk LOW).** Diverges from the notes RESTRICT. Justified: a favorite is a disposable pointer, not authored content. The app soft-deletes exercises (never hard-DELETE, `exercises.ts:99-105`), so CASCADE never fires in practice today; it is the cleaner intent for a future hard-delete. `user_id → CASCADE` matches every per-user table.
- **UX regression — the e1RM chart with no favorites (Confidence HIGH / Risk MEDIUM→LOW).** This is THE regression. Invariant F makes the empty-favorites path byte-for-byte identical to today (proof above; unit-pinned). The Phase-2a NEGATIVE e2e (bodyweight-only user → `model.series.length === 0` → section returns null, `e1rm-strength.spec.ts:272-318`) still holds: no favorite can resurrect a non-eligible exercise. Risk drops to LOW once the byte-for-byte unit test is green.
- **UX regression — palette change affects EXISTING lines' colors (Confidence HIGH / Risk LOW).** Extending `E1RM_PALETTE` from 8 to 12 appends 4 hexes; the first 8 are byte-for-byte unchanged, so existing top-5 lines keep their exact colors (`colorForRank(0..4)` unchanged). No visual regression for the no-favorites case.
- **UX regression — header-right layout (Confidence MEDIUM / Risk LOW).** Adding a star next to the Pencil widens the header-right cluster. Wrapped in a `flex-row items-center` View; both are 20px icons with `px-2`/`px-3` padding. On a canonical exercise (no Pencil) only the star shows. Visual check is in the e2e screenshot.
- **Platform divergence — web e2e a11y (Confidence HIGH / Risk LOW).** rn-web 0.21 drops `accessibilityState` → `aria-checked` (Discovery §note, `e1rm-strength.spec.ts:241-243`). The star uses `accessibilityRole="button"` + a UNIQUE `accessibilityLabel` (`"Favorite <Name>"`/`"Unfavorite <Name>"`), located via `getByLabel` — robust on web. The chip legend keeps `"Toggle <Name>"` — NO collision (Discovery #9). The star's filled/outline state is driven by the `Star` `fill` prop (SVG), asserted via screenshot, not by a class — so no opacity-class dependency.
- **Performance (Confidence HIGH / Risk LOW).** The presenter already aggregates ALL eligible exercises (`:98-131`); the union changes only which aggregated entries survive the slice — no extra scan. `favoriteSet` is a `useMemo` over a tiny array (sole user). One extra small query (`["exercise_favorites","me"]`) on the Progress page.
- **Locator collision (Confidence HIGH / Risk LOW).** Pre-audited (Discovery #9): specs surfacing exercise names use `getByLabel("Toggle <Name>")` or `.first()` (`e1rm-strength.spec.ts:193,244,310`, `exercise-note.spec.ts:250,283,389`, `exercise-progress-ia.spec.ts:250,297`). The star's `"Favorite/Unfavorite <Name>"` label is disjoint from all of them. The new e2e asserts chart presence via `getByLabel("Toggle <Name>")` (the chip), not bare text.
- **Cache staleness on pull-to-refresh (Confidence MEDIUM / Risk LOW).** The Progress page pull-to-refresh fans out `["stats"]`+`["exercises"]` but NOT `["exercise_favorites"]`. The optimistic toggle + `onSettled` invalidate keeps the list fresh; adding favorites to the refresh fan-out is LOW priority and OUT OF SCOPE (see below). A stale favorites list only matters across devices for a sole user — negligible.

## Alternativas descartadas

1. **Union in the SECTION (after the model) instead of the presenter** — descartada porque it would split the "decides the plotted set" logic across two files, break "exactly one place decides," require re-ranking in JSX, and is not pure-function unit-testable. Presenter seam keeps blast radius to the slice line.
2. **Wrapping 8-color palette (`% 8`) left as-is** — descartada porque a union >8 silently collides two lines on one color (THE headline integration bug). Extending to 12 + capping at 12 makes color uniqueness provable.
3. **Unbounded palette (programmatic HSL color generation, no ceiling)** — descartada porque adjacent-line contrast degrades past ~10 lines on a 200px chart (unreadable), and a generated palette is harder to unit-pin than a fixed array. A fixed readable ceiling is the deterministic choice.
4. **Cap = top-5 ALWAYS + up to K favorites with a smaller ceiling (e.g. 8)** — descartada porque 8 forces favorites to start dropping at 4 favorites (5+4>8), too tight for "add a few favorites." 12 keeps the full top-5 AND up to 7 simultaneous favorites; the drop-non-favorites-first rule still guarantees favorites win when over budget.
5. **Soft-delete (`deleted_at`) on favorites + partial-UNIQUE (mirror notes 1:1)** — descartada porque a favorite has no content to preserve; unfavorite = hard DELETE is correct. Composite PK is simpler and gives the index for free.
6. **23505 read-then-write retry loop (mirror notes' `upsertMyExerciseNote`)** — descartada porque that loop exists ONLY for the partial-UNIQUE 42P10 trap on a mutable body. A favorite is presence/absence against a non-partial PK; idempotent INSERT (swallow 23505) + plain DELETE is correct and far simpler.
7. **`.upsert(..., { onConflict: "user_id,exercise_id", ignoreDuplicates: true })`** — descartada (LOW preference, not wrong) porque a plain INSERT with a 23505-swallow is more explicit about the idempotent intent and matches the codebase's existing INSERT+SQLSTATE discriminator style (`measurements.ts:121-159`); upsert would also work since the PK is non-partial.
8. **Inline `<FavoriteToggle>` near the title (`progress.tsx:224-230`) / next to `<ExerciseNoteSlot>`** — descartada porque the header-right is the established per-exercise affordance (the Pencil lives there), it is always visible without scrolling, and the only reason Discovery flagged it (the `canEdit` gate) is solved by building the star OUTSIDE that predicate. Header-right is the stronger choice.
9. **FK `exercise_id` ON DELETE RESTRICT (mirror notes)** — descartada porque RESTRICT protects authored content from deletion; a favorite is a disposable pointer and should vanish with the exercise, not block its deletion. (Moot today — app soft-deletes — but CASCADE is the correct intent.)
10. **Per-exercise favorite cache key `["exercise_favorite", id]`** — descartada porque the chart needs the WHOLE set of ids; a per-exercise key would force N reads and would not re-render the chart on toggle. A single list key serves both readers and re-renders the chart.
11. **Add favorites to `useProgressPageRefresh` fan-out** — descartada (parked, out of scope) porque the optimistic toggle + `onSettled` invalidate already keeps the list fresh; cross-device staleness is negligible for a sole user. Low-value, parked.
12. **Separate `<FavoriteToggle>` component file (mirror `exercise-note-slot.tsx`)** — descartada porque the note slot is a component only because it owns draft/resync/commit-on-blur machinery; a favorite star is a one-tap header button with no internal state. Inline in `progress.tsx`'s header is simpler (the Pencil is also inline there). No new component file.

## Out of scope

- Separate favorites screen / favorites list view (`state.md:15`).
- Favoriting from any surface other than `progress.tsx` (picker, library list, history).
- Favorites affecting the volume or per-muscle charts (`state.md:15`) — only the e1RM chart.
- Reordering / sorting favorites — hence no `position` column.
- Adding `["exercise_favorites"]` to the Progress pull-to-refresh fan-out (Alt 11 — parked, LOW value).
- The exercise-note slot's draft/resync/commit-on-blur machinery — favorites is a one-tap toggle.
- Phase-2a deferred items (leverage factors, secondary-muscle attribution, dose-metric) (`state.md:15`).
- A `<FavoriteToggle>` component file (Alt 12 — inline in the header).
- Programmatic/unbounded palette beyond 12 lines (Alt 3 — a future "favorites galore" power-user need; not this run).

## Test plan

### §A — Unit (`tests/unit/e1rm-strength.test.ts`, extend; uses `mkRow`/`mkExercise`, injected `NOW`)

Seed ≥6 distinct WEIGHTED exercises with differing distinct-session counts so a known exercise sits OUTSIDE the top-5. New cases:
1. **Favorite OUTSIDE top-N is pinned** — a weighted exercise at rank 6 by sessions IS in `model.series` when `favoriteExerciseIds` includes it (and appears FIRST per the order rule).
2. **Favorite already INSIDE top-N is not duplicated** — favoriting a top-3 exercise yields the SAME series count (union, not concat); its id appears exactly once.
3. **Bodyweight-only favorite excluded** — a favorited exercise whose only sets are `weight=0` is NOT in `model.series` (Invariant D survives the union — mirror existing case #7/#10 at `:221-250,347-383`).
4. **No-set favorite excluded** — a favorited exercise with NO rows at all never enters `byExercise` → absent from series.
5. **Cap drops lowest NON-favorite, not a favorite** — with `E1RM_MAX_LINES=12`: seed 12 weighted exercises + favorite 2 that are low-ranked (rank 11, 12 by sessions). Assert both favorites present AND the count is 12 AND the two lowest-ranked NON-favorites (would-be auto-picks) are the ones dropped (favorites win).
6. **Dense ranks** — `model.series.map(s => s.rank)` is `[0,1,2,…,M-1]` over the combined list (no gaps, no duplicate index → palette indices distinct).
7. **Determinism** — same inputs with `favoriteExerciseIds` built from a different insertion order (e.g. `new Set(["b","a"])` vs `new Set(["a","b"])`) produce identical series order (mirror existing determinism case #13 at `:425-460`).
8. **Empty favorites = current output (Invariant F)** — `presentTopExerciseE1rm({rows, exercises})` (no favorites arg) and `presentTopExerciseE1rm({rows, exercises, favoriteExerciseIds: new Set()})` produce DEEP-EQUAL output, and that output equals the pre-change top-N selection. **This is the byte-for-byte regression guarantee, pinned.**

### §B — API unit (`tests/unit/exercise-favorites-api.test.ts`, new)

Mirror `exercise-notes-api.test.ts` (the `vi.mock("~/lib/supabase")` + `pendingChains` harness). Simpler:
- `listMyFavoriteExerciseIds`: unauth → `[]`; authed → maps rows to ids.
- `addFavorite`: issues `.insert({user_id, exercise_id})`; a `23505` error is SWALLOWED (resolves, no throw — idempotent); a non-23505 error re-throws.
- `removeFavorite`: issues `.delete().eq(user_id).eq(exercise_id)`; error re-throws.

### §C — RLS arm (`tests/rls.test.ts`, append after `:398`, before the `console.log`)

Mirror the `exercise_notes` arm (`:133-192`). A favorites A's exercise (`aEx.id`, already created at `:58-63`):
- A inserts `{ user_id: a.user.id, exercise_id: aEx.id }` → succeeds.
- B SELECT on that pair → 0 rows. B DELETE on that pair → 0 rows. (No UPDATE — table has no mutable column.)
- B spoof-INSERT `{ user_id: a.user.id, exercise_id: aEx.id }` → rejected by the INSERT `with check` (error OR 0 rows, like the notes spoof at `:182-192`).
- Update the final `console.log` to mention the `user_exercise_favorites` arm.
- Cleanup is covered by `deleteUser` cascade (FK `user_id` ON DELETE CASCADE) in the outer `finally` (`:404-405`).

### §D — e2e (`tests/e2e/favorite-exercises-e1rm.spec.ts`, new)

Mirror `e1rm-strength.spec.ts` harness (admin service-role seed, `signInViaUi`, `pickCanonicalExercise` with LIVE-catalog names). To prove the union pins a NON-top-N line (Discovery #8):
- Seed 5 high-distinct-session weighted exercises (e.g. "Bench Press", "Squat (Barbell)", + 3 more live-catalog weighted names, each across ≥2 sessions) so they fill the auto top-5.
- Seed 1 LOW-session weighted exercise (1 session, weighted) so it falls OUTSIDE the top-5 — call it the TARGET.
- Sign in, `gotoProgress`, assert the section renders and the TARGET's chip `getByLabel("Toggle <Target>")` is NOT present (it's outside top-5).
- Navigate to `/exercises/${targetId}/progress` (the detail-page pattern, `exercise-note.spec.ts:166`), click the star (`getByLabel("Favorite <Target>")`), wait for the optimistic state, navigate back to `/progress`.
- Assert `getByLabel("Toggle <Target>")` IS now present (the favorited line joined the chart). Screenshot.
- Unfavorite (`getByLabel("Unfavorite <Target>")` on the detail page) → return to `/progress` → assert `getByLabel("Toggle <Target>")` is GONE (it wasn't also top-5).
- **Live-catalog gotcha (carry-in):** use only catalog-verified WEIGHTED names ("Bench Press", "Squat (Barbell)", etc.); do NOT use "Pull-up" (not in the live catalog) and do NOT favorite a bodyweight-only exercise (it can't plot — vacuous).
- **Settle-gate (carry-in MAJ-1 from the Phase-2a run):** every "NOT present" assertion (`getByLabel(...).not.toBeVisible()` / `await expect(...).toHaveCount(0)`) must follow a positive settle anchor first (the section header visible) so it is not a cold false-green before the chart mounts.

## Response to Validator issues
N/A — this is round 1 (Design↔Validate round 1).
