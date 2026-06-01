# Design v2 — 2026-06-01_1301_favorite-exercises-e1rm

> **Standalone.** The Validator + Implementer read THIS file, not v1+diff. All SOUND v1 content is carried forward (corrected). The single design-correctness no-go (MAJ-1, the union/cap rule) is re-derived from scratch; the 5 minors are folded in. The Validator-verified-SOUND parts (Invariant F, the `favoriteSet` memo wiring, the header-right star outside `canEdit`, migration 0020 + composite PK + 3 RLS policies + FK CASCADE, the plain INSERT/DELETE API, the hook, the "What is NOT" clause) are kept intact.

## Diff vs v1 (every Validator issue → resolution pointer)

| Validator issue | Severity | Resolution in v2 | Where |
|---|---|---|---|
| MAJ-1: `autoTop = nonFavorites.slice(0,topN)` (top-N of NON-favorite pool) promotes a hidden non-favorite when a top-N exercise is favorited; contradicts §A case 2 | **MAJOR (the no-go)** | Re-derived to **top-N OVERALL ∪ favorites**, deduped by construction: `autoTopOverall = sorted.slice(0,topN)`; `extraFavorites = favorites NOT already in top-N`; `selected = [...autoTopOverall, ...extraFavorites]`. A favorite already in top-N → no change (count unchanged). A favorite outside top-N → +1 line. | §Combine-rule, §A cases 1/2/5 |
| MIN-1: misleading "deduped by id / no overlap possible" comment | minor | Comment rewritten for the union-with-overall-top-N: "extraFavorites EXCLUDES autoIds, so the concat is dedup-by-construction; favoriting a top-N exercise is a no-op (it's already in autoTopOverall)." | §Combine-rule pseudo-code |
| MIN-2: tight palette hue-spacing (yellow/orange next to amber; purple next to violet) | minor | Replaced the 4 added hues with deep-green `#15803d`, slate `#64748b`, rose `#e11d48`, brown `#92400e` — none adjacent to amber (`#f59e0b`) or violet (`#8b5cf6`). | §I/O `e1rm-strength-section.tsx` |
| MIN-3: e2e doesn't assert star-shows + Pencil-hidden on a CANONICAL exercise | minor | §D adds an explicit assertion on a canonical target: `getByLabel("Favorite <canonical>")` visible AND `getByLabel("Edit exercise")` absent (the `canEdit`-split guarantee). | Test plan §D step 3 |
| MIN-4: e2e seed names not all live-catalog-verified (only 2 of ≥6) | minor | §D names the exact 5 top + 1 outside-top-N WEIGHTED live-catalog exercises; Implementer/Tester still live-verifies each via `pickCanonicalExercise` (throws on miss). | Test plan §D |
| MIN-5: cap-boundary + promotion cases untested | minor | §A adds case 9 (exactly E1RM_MAX_LINES), case 10 (one over → lowest non-favorite dropped), and the promotion/no-promotion behavior is pinned by cases 1 (outside→+1) and 2 (inside→same). | Test plan §A |

---

## Goal (1 sentence)
Let the sole user mark exercises as favorite (star toggle on the exercise detail page `progress.tsx`, optimistic) and have favorited+plottable exercises pinned INTO the existing Phase-2a "Estimated 1RM per exercise" chart IN ADDITION to (union with) the auto-selected most-performed top-N — where the auto top-N is the **natural top-N OVERALL** (exactly as today) and favorites are unioned with it and deduped.

## Approach

This is a **mirror-then-diverge** feature on two known-good siblings (the prior-run lesson: mirror the sibling 1:1, name the single material divergence).

- **Data/API/hook/RLS** mirror the `exercise_notes` triad (`0010_exercise_notes.sql` / `src/api/exercise-notes.ts` / `src/hooks/use-exercise-note.ts`) with three simplifications justified below: composite PK instead of partial-UNIQUE (no soft-delete), no `body`/`updated_at`/trigger, plain INSERT/DELETE instead of the 23505 read-then-write loop.
- **Chart integration** mirrors the Phase-2a e1RM presenter (`presentTopExerciseE1rm`) and diverges in exactly ONE place: the `.slice(0, topN)` selection gate (`e1rm-strength.ts:138-148`) becomes a deterministic **union-then-cap** of `top-N-OVERALL ∪ favorites`, producing a single rank-dense `series[]`.

Two crux decisions drive everything else:

1. **The union/cap rule (THE central decision — re-derived for v2).** The auto-selection is the **top-N OVERALL** — the natural top-N of ALL eligible exercises, byte-for-byte what ships today (`sorted.slice(0, topN)`). Favorites are then UNIONED with that top-N and DEDUPED by id. Concretely:
   - A favorite **already in** the natural top-N → no change (it is already shown; series count unchanged). ← this is why §A case 2 passes.
   - A favorite **outside** the natural top-N → ADDED to the series (count grows by exactly the number of such favorites).
   The result is a single merged list with `rank` = array index → 0-based dense → the palette indexes by `rank` with no collision. The headline risk is **palette/color-collision**: `E1RM_PALETTE` has 8 hexes and `colorForRank(i) = PALETTE[i % 8]` (`e1rm-strength-section.tsx:29-41`), comment assumes N≤8. Resolved by **extending the palette to a dense 12-color array AND capping the total at the ceiling 12**, dropping the lowest-ranked NON-favorites first (favorites guaranteed visible — the user asked for them). See Decision #1/#2.

2. **The seam.** The union happens INSIDE `presentTopExerciseE1rm` (a new optional `favoriteExerciseIds?` arg), so the section + chart need ZERO selection-logic changes except the palette ceiling, preserving "exactly one place decides the plotted set." **Invariant F (byte-for-byte):** when `favoriteExerciseIds` is absent/empty, the presenter output is provably identical to today — the `extraFavorites` arm is empty and the cap stays at `topN` (5). This is even more obviously true now: `selected = [...sorted.slice(0,topN), ...[]] = sorted.slice(0,topN)`, the literal current expression. (The "new optional dependency reproduces old numbers when absent" pattern that paid off in the bodyweight-volume run.)

Standard mirror-then-diverge footers apply: a **"What is NOT in this algorithm"** clause forbids the dead patterns (separate-list ranks, favorites bypassing eligibility, dropping a favorite under the cap, AND — new for v2 — slicing from the NON-favorite pool), and the prose defers to the pinned contract (carry-in MIN-1 lesson — no second looser natural-language version that can drift).

## Mudanças por arquivo

One responsibility per file. The kernel function changed is `presentTopExerciseE1rm`; its call sites are closed below (Discovery §3 Grep A: 1 production caller `e1rm-strength-section.tsx:50` + the unit test file — both in the table; Grep D confirms `app/(app)/progress/index.tsx` mounts the section with NO props and reads none of its internals, so it needs no edit).

| File | Type | Change (one responsibility) |
|---|---|---|
| `supabase/migrations/0020_user_exercise_favorites.sql` | new | The favorites join table + 3 RLS policies (SELECT/INSERT/DELETE). **Implementer writes the FILE; Conductor applies** (`state.md:17`). DDL in §"Migration DDL". |
| `src/db/schema.ts` | edited | Add the `userExerciseFavorites` Drizzle table after `exerciseNotes` (`:304`) + import `primaryKey` from `drizzle-orm/pg-core` (`:2-13`). Typing mirror only — SQL is source of truth. |
| `src/db/types.ts` | edited | Add `UserExerciseFavorite`/`NewUserExerciseFavorite` Drizzle types (after `ExerciseNote`, `:37-38`) + a `UserExerciseFavoriteRow` PostgREST row type (after `ExerciseNoteRow`, `:262`). |
| `src/api/exercise-favorites.ts` | new | `listMyFavoriteExerciseIds()` / `addFavorite(id)` / `removeFavorite(id)`. Auth-gated like notes. Plain INSERT/DELETE (no 23505 loop). Contract in §"I/O contracts". |
| `src/hooks/use-exercise-favorites.ts` | new | `useMyFavoriteExerciseIds()` (query, key `["exercise_favorites","me"]`) + `useToggleFavorite()` (optimistic add/remove via `onMutate`/`onError`/`onSettled`). |
| `app/(app)/exercises/[id]/progress.tsx` | edited | Mount the star toggle in the header-right slot, OUTSIDE the `canEdit` gate (so it shows for canonical exercises too). 1 import (`Star` + the 2 hooks) + the header-right JSX. Responsibility: the favorite affordance. |
| `src/utils/e1rm-strength.ts` | edited | Thread `favoriteExerciseIds?: ReadonlySet<string>` into `presentTopExerciseE1rm`; replace `.slice(0, topN)` (`:148`) with the **top-N-overall ∪ favorites** union-then-cap selection. Responsibility: the plotted-set decision (the data model). |
| `src/components/e1rm-strength-section.tsx` | edited | Read `useMyFavoriteExerciseIds()`, add to the `useMemo` deps (`:48-51`), pass `favoriteExerciseIds` to the presenter; extend `E1RM_PALETTE` to 12 hexes + update the comment. Responsibility: wire favorites into the chart + widen the palette ceiling. |
| `tests/unit/e1rm-strength.test.ts` | edited | Extend with the favorites-union cases (Test plan §A). |
| `tests/unit/exercise-favorites-api.test.ts` | new | API unit test mirroring `exercise-notes-api.test.ts` (auth-gate, list, add/remove). |
| `tests/rls.test.ts` | edited | Add a `user_exercise_favorites` cross-user arm after the `routine_exercise_sets` arm (`:398`, before the `console.log`). |
| `tests/e2e/favorite-exercises-e1rm.spec.ts` | new | e2e: favorite a non-top-N weighted exercise on the detail page → its chip/line appears in the chart; unfavorite → it leaves; canonical-target star-shows + Pencil-hidden assertion. |

**NOT touched (regression surface, Decision #7):** the volume/muscle chart, `presentWeeklyVolumeByMuscle`, `<MultiSeriesChart>`, `multi-series-chart.tsx`, `app/(app)/progress/index.tsx` (mounts `<E1rmStrengthSection/>` with no props), `app/(app)/exercises/[id]/index.tsx` (the EDIT form — NOT the detail page; Discovery §2 correction), and every other exercise surface (picker, library, history).

## Combine-rule decision (THE central design decision — re-derived for v2)

### The merged-list algorithm (top-N OVERALL ∪ favorites)

Today the presenter builds `byExercise` for **every eligible (weighted) exercise** in `rows`, then sorts by the comparator and `.slice(0, topN)` (`e1rm-strength.ts:138-148`). The change replaces ONLY the slice — the comparator and everything downstream are untouched:

```
// `sorted` = the FULLY-SORTED eligible list, comparator UNCHANGED:
//   sessions DESC → lastActiveMs DESC → name ASC → id ASC  (e1rm-strength.ts:139-147)
const sorted = Array.from(byExercise.values()).sort(comparator);

const favSet = favoriteExerciseIds ?? EMPTY_SET; // ReadonlySet<string>, default empty

// 1. Auto-selection = the top-N OVERALL — EXACTLY today's selection (the natural
//    top-N of ALL eligible exercises). This is the byte-for-byte current behavior.
const autoTopOverall = sorted.slice(0, topN);
const autoIds = new Set(autoTopOverall.map((a) => a.id));

// 2. Extra favorites = eligible favorites NOT already in the top-N, in comparator
//    order. A favorite already in the top-N is EXCLUDED here (it is already shown
//    via autoTopOverall) — so the concat below is dedup-by-construction. A favorite
//    OUTSIDE the top-N is added exactly once.
const extraFavorites = sorted.filter((a) => favSet.has(a.id) && !autoIds.has(a.id));

// 3. Union. Order: top-N-overall FIRST (comparator order — keeps existing lines in
//    their exact current rank/color positions), then the extra favorites (comparator
//    order). No duplicate possible: extraFavorites excludes autoIds. (MIN-1 fix:
//    this is NOT "dedup of an overlap" — it is "the overlap was never built." A
//    favorite already in autoTopOverall is a true no-op; the series count is
//    unchanged. We do NOT slice from a non-favorite pool — see "What is NOT".)
let selected = [...autoTopOverall, ...extraFavorites];

// 4. Cap at the readable ceiling. selected.length = topN + extraFavorites.length
//    (when there are favorites outside the top-N), so it exceeds E1RM_MAX_LINES (12)
//    ONLY when topN + extraFavorites.length > 12, i.e. extraFavorites.length > 7.
//    Drop the LOWEST-RANKED NON-FAVORITES first so favorites stay visible.
if (selected.length > E1RM_MAX_LINES) {
  // Keep all extra favorites; trim autoTopOverall from its tail (least-performed
  // auto picks drop first). favorites guaranteed visible.
  const keptAuto = autoTopOverall.slice(
    0,
    Math.max(0, E1RM_MAX_LINES - extraFavorites.length),
  );
  selected = [...keptAuto, ...extraFavorites];
  // Degenerate: if extraFavorites alone exceed the ceiling (extraFavorites.length
  //  > 12 → keptAuto becomes []), the favorites themselves are trimmed from the
  // tail (lowest-comparator favorites drop). They persist in the DB and reappear
  // when the user unfavorites others.
  if (extraFavorites.length > E1RM_MAX_LINES) {
    selected = extraFavorites.slice(0, E1RM_MAX_LINES);
  }
}

const ranked = selected; // feeds the existing `ranked.map((agg, rank) => …)` (:151) unchanged
```

Then the existing `ranked.map((agg, rank) => …)` (`:151`) assigns `rank` = array index over the FINAL combined list → ranks stay **0-based dense**, palette indexes correctly.

**Worked traces (each pinned by a §A unit case):**
- 6 eligible sorted `[A,B,C,D,E,F]`, topN=5, **favorite C (top-3, already in top-N):** `autoTopOverall=[A,B,C,D,E]`, `autoIds={A,B,C,D,E}`, `extraFavorites=[]` (C is filtered out — it's in `autoIds`), `selected=[A,B,C,D,E]` → **5 series, C once.** Count UNCHANGED. (§A case 2.)
- Same inputs, **favorite F (rank 6, outside top-N):** `extraFavorites=[F]`, `selected=[A,B,C,D,E,F]` → **6 series.** Count grows by exactly 1. (§A case 1.)
- 13 eligible sorted `[A..M]`, topN=5, **favorite all of E..M (9 favorites; A,B,C,D are the only non-favorites; E is in top-5, F..M are the 8 outside-top-5 favorites):** `autoTopOverall=[A,B,C,D,E]`, `extraFavorites=[F,G,H,I,J,K,L,M]` (8 items; E excluded as in top-N), raw `selected.length = 5+8 = 13 > 12` → `keptAuto = autoTopOverall.slice(0, 12-8) = [A,B,C,D]` (E dropped — it's the lowest-ranked NON-favorite of the auto set), `selected = [A,B,C,D, F,G,H,I,J,K,L,M]` → **12 series**, all 8 favorites kept, the lowest auto pick (E) dropped. (§A case 5 / 10.)

### The cap / palette resolution (headline risk — spelled out)

- **Ceiling:** `E1RM_MAX_LINES = 12` (new exported const in `e1rm-strength.ts`). `topN` stays `E1RM_TOP_N = 5` (the auto-selected top-N-overall cap is unchanged).
- **When does the cap fire NOW (re-verified against the top-N-overall selection):** `selected.length = topN + extraFavorites.length` whenever favorites sit outside the top-N (a favorite inside the top-N adds nothing). So `selected.length > 12` ⟺ `5 + extraFavorites.length > 12` ⟺ `extraFavorites.length > 7` — i.e. the user has **≥8 favorites that are all outside the natural top-5.** Below that, the cap branch never fires and `selected = [...autoTopOverall, ...extraFavorites]` un-trimmed.
- **Palette:** extend `E1RM_PALETTE` from 8 to **12 distinct hexes** in `e1rm-strength-section.tsx` so `colorForRank(i) = PALETTE[i % 12]` never wraps within the ceiling. (12 ≥ E1RM_MAX_LINES, so no two plotted lines ever share a color.) The first 8 hexes are byte-for-byte unchanged → existing top-5 lines keep their exact colors.
- **Cap drops NON-favorites first:** when `extraFavorites.length > 7`, the lowest-ranked auto (most-performed) entries are trimmed from `autoTopOverall`'s tail so favorites stay visible. Favorites are only trimmed in the degenerate case of >12 outside-top-N favorites (then the lowest-comparator favorites drop — persisted in the DB, reappear when the user unfavorites others).
- A favorited exercise with NO plottable e1RM data (bodyweight-only, all `weight=0`) never enters `byExercise` (eligibility gate `:109`), so it is naturally absent from `sorted` → absent from `favorites` → excluded from the chart series. **The favorite ROW still exists in the DB** (the toggle persists it), so the line appears the instant the user logs a weighted set. State preserved; chart line gated by Invariant D.

### Final-list ordering — decision + justification

**Chosen order: top-N-overall FIRST (comparator order), then the extra favorites (comparator order).** Ranks are 0-based dense over the concatenation (`ranked.map((agg, rank) => …)`).

Why this order (not "favorites pinned first"):
1. **Zero color regression for the common case.** The existing top-5 lines keep ranks 0..4 → `colorForRank(0..4)` is byte-for-byte their current colors. A user who favorites a 6th exercise sees the new line take rank 5 (a NEW color) without recoloring any of the 5 lines they already recognize. Pinning favorites first would shift every auto line's rank/color on the first favorite — a gratuitous visual churn.
2. **The comparator already encodes "most relevant first."** The top-N-overall are by definition the most-performed; putting them first matches the chart's existing reading order and the legend order.
3. **Determinism.** Both partitions are derived from the SAME comparator-sorted `sorted` array, so the final list is a stable function of the inputs regardless of `favSet` iteration order (pinned by §A case 7).

Rejected ordering: **favorites pinned first** — descartada porque it recolors every existing auto line the moment the user adds one favorite (rank shift 0→1, 1→2, …), which is exactly the "favoriting a shown exercise changes unrelated lines" surprise the v1 no-go was about, in color form. Top-N-overall-first keeps the established lines stable.

### Invariant F — byte-for-byte when no favorites (the regression guarantee — KEPT, now even more obvious)

When `favoriteExerciseIds` is `undefined` or empty: `favSet` is empty → `extraFavorites = sorted.filter(favSet.has && …) = []` → `selected = [...sorted.slice(0, topN), ...[]] = sorted.slice(0, topN)` — **the literal current expression** at `:148`. The cap branch never fires (`selected.length ≤ topN = 5 < 12`). Ranks, names, values, LOCF, weeks: identical. **Provably unchanged** — pinned by unit test (§A case 8). (This is strictly more obvious than v1, where the empty path was `[...[], ...nonFavorites.slice(0,topN)]` and depended on `nonFavorites === sorted`; here it is the direct `sorted.slice(0, topN)`.)

## Contratos de I/O

### `src/utils/e1rm-strength.ts` — the changed kernel

```ts
/** Default cap on AUTO-selected lines (the top-N OVERALL most-performed). Unchanged. */
export const E1RM_TOP_N = 5;

/**
 * Readable ceiling on TOTAL plotted lines (top-N-overall ∪ favorites). Matched by
 * E1RM_PALETTE length (≥ this) so colorForRank never wraps within the ceiling.
 * Exceeded only when (topN + favorites-outside-topN) > this. When exceeded, the
 * LOWEST-RANKED NON-FAVORITES drop first (favorites are guaranteed visible).
 */
export const E1RM_MAX_LINES = 12;

export function presentTopExerciseE1rm(args: {
  rows: WeeklyVolumeRow[];
  exercises: ExerciseRow[];
  topN?: number;                             // default E1RM_TOP_N — unchanged
  favoriteExerciseIds?: ReadonlySet<string>; // NEW. Absent/empty → Invariant F.
  now?: Date;                                // injectable for tests — unchanged
}): E1rmStrengthModel;
```

`E1rmSeries` and `E1rmStrengthModel` types are UNCHANGED. `rank` semantics unchanged (0-based dense over the FINAL list). The destructure becomes `const { rows, exercises, topN = E1RM_TOP_N, favoriteExerciseIds, now = new Date() } = args;`. A module-level `const EMPTY_SET: ReadonlySet<string> = new Set();` provides the absent-default (no per-call allocation).

### `src/api/exercise-favorites.ts` — new

```ts
import { supabase } from "~/lib/supabase";

/** Returns the current user's favorite exercise_ids. `[]` when unauthenticated. */
export async function listMyFavoriteExerciseIds(): Promise<string[]>;
//   auth-gate → [] when no user (mirror exercise-notes.ts:14-16)
//   SELECT exercise_id FROM user_exercise_favorites WHERE user_id = uid
//   → (data ?? []).map(r => r.exercise_id as string)

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

No 23505 retry LOOP (notes needs it because a note is update-or-insert of a mutable body against a *partial* unique; a favorite is presence/absence against a *non-partial* composite PK — INSERT + idempotent-swallow is correct and sufficient). No `.upsert()` (legal here against the non-partial PK, but a plain INSERT with a 23505-swallow is simpler and matches the codebase's INSERT+SQLSTATE-discriminator style at `measurements.ts:121-159`).

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

**Load-bearing wiring (Discovery §6; Validator-confirmed SOUND):** the e1RM section reads `useMyFavoriteExerciseIds()` and adds its memoized Set to the `useMemo` deps, so the optimistic `setQueryData` re-renders the chart instantly (the new line appears/disappears) AND the star flips instantly — same cache, two readers.

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
```

**`favoriteSet` memo — Validator-confirmed SOUND (validation-v1.md §2):** `useMemo(() => new Set(favoriteIds ?? []), [favoriteIds])` is gated by the react-query `data` identity (TanStack structural sharing keeps `favoriteIds` referentially stable until the cache changes); on toggle `setQueryData` produces a NEW array → `favoriteSet` recomputes → model memo recomputes → chart re-renders. No infinite render. Kept verbatim.

**Palette extension (MIN-2 fix — re-spaced hues).** Extend `E1RM_PALETTE` to 12 hexes and rewrite the comment. The first 8 are byte-for-byte the existing array (`:29-38`); the 4 appended hues are chosen FAR from amber (`#f59e0b`, rank 3) and violet (`#8b5cf6`, rank 4) per MIN-2:

```ts
// Palette indexed by rank (Decision #4). The first 8 are the Phase-2a hexes
// (unchanged → existing top-5 lines keep their colors). The 4 appended hues are
// spaced away from amber (#f59e0b) and violet (#8b5cf6) for adjacent-rank contrast.
// length (12) >= E1RM_MAX_LINES so `% length` never wraps within the ceiling.
const E1RM_PALETTE = [
  "#ef4444", // red-500     (rank 0) — unchanged
  "#3b82f6", // blue-500    (rank 1) — unchanged
  "#10b981", // emerald-500 (rank 2) — unchanged
  "#f59e0b", // amber-500   (rank 3) — unchanged
  "#8b5cf6", // violet-500  (rank 4) — unchanged
  "#ec4899", // pink-500    (rank 5) — unchanged
  "#06b6d4", // cyan-500    (rank 6) — unchanged
  "#84cc16", // lime-500    (rank 7) — unchanged
  "#15803d", // green-700   (rank 8) — NEW: deep green, distinct from emerald/lime
  "#64748b", // slate-500   (rank 9) — NEW: neutral slate, no nearby hue
  "#e11d48", // rose-600    (rank 10) — NEW: rose, distinct from red/pink
  "#92400e", // amber-800   (rank 11) — NEW: brown, distinct from amber-500
] as const;
```

Rationale for the 4 hues (MIN-2): deep-green `#15803d` is darker/cooler than emerald-500 (`#10b981`) and lime-500 (`#84cc16`); slate `#64748b` is a desaturated neutral with no adjacent hue; rose `#e11d48` is distinct from red-500 (`#ef4444`, lighter) and pink-500 (`#ec4899`, more magenta); brown `#92400e` is a dark desaturated amber, clearly separated from amber-500 (`#f59e0b`). None sits adjacent to amber or violet, addressing the v1 yellow/orange/purple complaint. All 12 are distinct hex strings → "no two plotted lines share a color within the ceiling" remains literally true.

All other section logic (seriesKeys, visible-set seeding `:60-70`, check-all/uncheck-all, chartSeries map, empty-state `:88`) is UNCHANGED — it auto-derives from `model.series` (Discovery §3 rows 7-11). The `seriesKeysSig` re-seed (`:66-70`) already turns a freshly-favorited line ON by default.

### `app/(app)/exercises/[id]/progress.tsx` — star toggle (header-right, outside `canEdit`)

Mount point decision: **header-right slot, alongside the Pencil**, but the star is built OUTSIDE the `canEdit` predicate. The existing `headerRight` (`:108-122`) is `canEdit ? () => <Pencil/> : undefined`. Change it to ALWAYS render the star, and render the Pencil only when `canEdit`:

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

Import `Star` from `lucide-react-native` (`:2`, alongside `ChevronLeft`, `Pencil`). Import the two hooks. **Header-right star outside `canEdit` — Validator-confirmed SOUND (validation-v1.md §3):** all referenced identifiers (`id`, `exercise.data?.name`, `colorScheme`, `router`, `canEdit`) are in scope at `progress.tsx:88-125`; `screenHeader` is a plain `const` (`:88`) that rebuilds each render so the optimistic star flip applies (validation-v1.md verified). **A11y label is UNIQUE per Discovery #9** — `"Favorite <Name>"` / `"Unfavorite <Name>"` does NOT collide with the legend chip's `"Toggle <Name>"` (`e1rm-strength-section.tsx:143`). Optimistic via `useToggleFavorite()` (the star fills instantly).

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

**Canonical exercises are favoritable (confirmed, Discovery §5; Validator-acceptable).** The FK targets `exercises.id` regardless of owner. The widened `exercises_select` policy (`0011:28-30`) lets any authed user read canonical rows; the favorites row's `user_id` is always the favoriting user, so the favorites RLS (`auth.uid() = user_id`) is satisfied. No special-casing needed.

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

Requires importing `primaryKey` into the `drizzle-orm/pg-core` import block (`:2-13`) — verified NOT currently imported. (`timestamp` and `uuid` ARE already imported, `:11-12`.) `authUsers` reference: use the same `authUsers` symbol `exerciseNotes` already references for its `user_id` FK (`schema.ts:277-304`).

## "What is NOT in this algorithm" (forbidding clause — carry-in discipline, updated for v2)

The union-then-cap selection MUST NOT:
- **Slice from a NON-favorite pool** (the v1 MAJ-1 bug — `nonFavorites.slice(0, topN)`). The auto-selection is `sorted.slice(0, topN)` — the top-N **OVERALL**, identical to today. Favoriting a top-N exercise must NOT promote a previously-hidden non-favorite into a freed slot; it is a no-op (the favorite is already in `autoTopOverall`, excluded from `extraFavorites`).
- **Build favorites as a SEPARATE list with its own 0-based ranks** — that collides palette indices with the top-N. There is ONE list, ranked dense 0..M-1 (Discovery §3 row #4).
- **Let a favorite bypass eligibility (Invariant D)** — a favorited bodyweight-only/no-set exercise never enters `byExercise` and is NOT injected; it is excluded by being absent from `sorted`, not by a special favorites branch.
- **Drop a favorite under the cap before dropping an auto (non-favorite) entry** — the cap trims `autoTopOverall` from the tail first; favorites are only trimmed in the degenerate >12-outside-top-N-favorites case.
- **Mutate the comparator** — favorites do NOT re-sort by recency or anything else; they keep the existing `sessions DESC → lastActiveMs → name → id` comparator (`:139-147`). The ONLY change is the slice → union-then-cap.
- **Reorder existing top-N lines / pin favorites first** — the final order is top-N-overall first (comparator order) then extra favorites (comparator order), so ranks 0..topN-1 (and thus colors) of the established lines are unchanged when a favorite is added (see "Final-list ordering").
- **Use `effectiveWeightKg`, `+=`, zero-fill, or any volume-presenter pattern** — Invariants D, E1, LOCF are unchanged.

## Riscos

- **Data integrity — RLS (Confidence HIGH / Risk MEDIUM).** New table + 3 policies all gated `auth.uid() = user_id`. The INSERT `with check` is the load-bearing one: B must NOT be able to insert a row with `user_id = A`. Mirrors the `exercise_notes` arm exactly. Pinned by the new RLS test arm (§C). The composite PK + non-null FKs prevent orphan/duplicate rows by construction.
- **Data integrity — FK ON DELETE CASCADE divergence (Confidence HIGH / Risk LOW).** Diverges from the notes RESTRICT. Justified: a favorite is a disposable pointer, not authored content. The app soft-deletes exercises (never hard-DELETE, `exercises.ts:99-105`), so CASCADE never fires in practice today; it is the cleaner intent for a future hard-delete. `user_id → CASCADE` matches every per-user table. Validator-confirmed acceptable (validation-v1.md §4).
- **UX regression — the e1RM chart with no favorites (Confidence HIGH / Risk LOW).** This is THE regression surface. Invariant F makes the empty-favorites path the literal `sorted.slice(0, topN)` expression — byte-for-byte identical to today (proof above; unit-pinned §A case 8). The Phase-2a NEGATIVE e2e (bodyweight-only user → `model.series.length === 0` → section returns null, `e1rm-strength.spec.ts:272-318`) still holds: no favorite can resurrect a non-eligible exercise (eligibility gate `:109` is upstream of the union). Validator confirmed Invariant F holds.
- **UX regression — favoriting a top-N exercise must NOT shift other lines (Confidence HIGH / Risk LOW — the v1 no-go, now fixed).** Under the corrected top-N-overall semantics, favoriting an already-shown exercise is a no-op (count unchanged, no line pops in). Favoriting an outside-top-N exercise adds exactly that one line at the next rank, leaving ranks/colors 0..topN-1 of the existing lines unchanged. Pinned by §A cases 1, 2, and the ordering decision. This is the direct fix for MAJ-1.
- **UX regression — palette change affects EXISTING lines' colors (Confidence HIGH / Risk LOW).** Extending `E1RM_PALETTE` from 8 to 12 appends 4 hexes; the first 8 are byte-for-byte unchanged, so existing top-5 lines keep their exact colors (`colorForRank(0..4)` unchanged). No visual regression for the no-favorites case.
- **UX regression — header-right layout (Confidence MEDIUM / Risk LOW).** Adding a star next to the Pencil widens the header-right cluster. Wrapped in a `flex-row items-center` View; both are 20px icons with `px-2`/`px-3` padding. On a canonical exercise (no Pencil) only the star shows. Visual check + the explicit canonical-target assertion are in §D (MIN-3 fix).
- **Platform divergence — web e2e a11y (Confidence HIGH / Risk LOW).** rn-web 0.21 drops `accessibilityState` → `aria-checked` (Discovery §note, `e1rm-strength.spec.ts:241-243`). The star uses `accessibilityRole="button"` + a UNIQUE `accessibilityLabel` (`"Favorite <Name>"`/`"Unfavorite <Name>"`), located via `getByLabel` — robust on web. The chip legend keeps `"Toggle <Name>"` — NO collision (Discovery #9). The star's filled/outline state is driven by the `Star` `fill` prop (SVG), asserted via screenshot, not by a class — so no opacity-class dependency.
- **Performance (Confidence HIGH / Risk LOW).** The presenter already aggregates ALL eligible exercises (`:98-131`); the union changes only which aggregated entries survive the slice — no extra scan (the `.filter`/`.slice`/`Set` ops are over the small ranked list). `favoriteSet` is a `useMemo` over a tiny array (sole user). One extra small query (`["exercise_favorites","me"]`) on the Progress page.
- **Locator collision (Confidence HIGH / Risk LOW).** Pre-audited (Discovery #9): specs surfacing exercise names use `getByLabel("Toggle <Name>")` or `.first()` (`e1rm-strength.spec.ts:193,244,310`, `exercise-note.spec.ts:250,283,389`, `exercise-progress-ia.spec.ts:250,297`). The star's `"Favorite/Unfavorite <Name>"` label is disjoint from all of them. The new e2e asserts chart presence via `getByLabel("Toggle <Name>")` (the chip), not bare text.
- **Cache staleness on pull-to-refresh (Confidence MEDIUM / Risk LOW).** The Progress page pull-to-refresh fans out `["stats"]`+`["exercises"]` but NOT `["exercise_favorites"]`. The optimistic toggle + `onSettled` invalidate keeps the list fresh; adding favorites to the refresh fan-out is LOW priority and OUT OF SCOPE (see below). A stale favorites list only matters across devices for a sole user — negligible.

## Alternativas descartadas

1. **Union in the SECTION (after the model) instead of the presenter** — descartada porque it would split the "decides the plotted set" logic across two files, break "exactly one place decides," require re-ranking in JSX, and is not pure-function unit-testable. Presenter seam keeps blast radius to the slice line.
2. **`autoTop = nonFavorites.slice(0, topN)` (top-N of the NON-favorite pool — the v1 algorithm)** — descartada porque it grows the series N→N+1 whenever a top-N exercise is favorited (it frees a slot that a previously-hidden non-favorite fills), a surprising side-effect that contradicts Discovery's Unknown-#1 default AND the §A case-2 intent. Replaced by top-N-OVERALL ∪ favorites (this is the MAJ-1 fix).
3. **Favorites pinned FIRST in the final list** — descartada porque it recolors every existing auto line the moment the user adds one favorite (rank shift 0→1, 1→2, …) — gratuitous visual churn on lines the user already recognizes. Top-N-overall-first keeps established lines stable (see "Final-list ordering").
4. **Wrapping 8-color palette (`% 8`) left as-is** — descartada porque a union >8 silently collides two lines on one color (THE headline integration bug). Extending to 12 + capping at 12 makes color uniqueness provable.
5. **Unbounded palette (programmatic HSL color generation, no ceiling)** — descartada porque adjacent-line contrast degrades past ~10 lines on a 200px chart (unreadable), and a generated palette is harder to unit-pin than a fixed array. A fixed readable ceiling is the deterministic choice.
6. **Cap = top-5 ALWAYS + up to K favorites with a smaller ceiling (e.g. 8)** — descartada porque 8 would start dropping favorites at 3 outside-top-N favorites (5+3>8), too tight for "add a few favorites." 12 keeps the full top-5 AND up to 7 simultaneous outside-top-N favorites; the drop-non-favorites-first rule still guarantees favorites win when over budget.
7. **Soft-delete (`deleted_at`) on favorites + partial-UNIQUE (mirror notes 1:1)** — descartada porque a favorite has no content to preserve; unfavorite = hard DELETE is correct. Composite PK is simpler and gives the index for free.
8. **23505 read-then-write retry loop (mirror notes' `upsertMyExerciseNote`)** — descartada porque that loop exists ONLY for the partial-UNIQUE 42P10 trap on a mutable body. A favorite is presence/absence against a non-partial PK; idempotent INSERT (swallow 23505) + plain DELETE is correct and far simpler.
9. **`.upsert(..., { onConflict: "user_id,exercise_id", ignoreDuplicates: true })`** — descartada (LOW preference, not wrong) porque a plain INSERT with a 23505-swallow is more explicit about the idempotent intent and matches the codebase's existing INSERT+SQLSTATE discriminator style (`measurements.ts:121-159`); upsert would also work since the PK is non-partial.
10. **Inline `<FavoriteToggle>` near the title (`progress.tsx:224-230`) / next to `<ExerciseNoteSlot>`** — descartada porque the header-right is the established per-exercise affordance (the Pencil lives there), it is always visible without scrolling, and the only reason Discovery flagged it (the `canEdit` gate) is solved by building the star OUTSIDE that predicate. Header-right is the stronger choice.
11. **FK `exercise_id` ON DELETE RESTRICT (mirror notes)** — descartada porque RESTRICT protects authored content from deletion; a favorite is a disposable pointer and should vanish with the exercise, not block its deletion. (Moot today — app soft-deletes — but CASCADE is the correct intent.)
12. **Per-exercise favorite cache key `["exercise_favorite", id]`** — descartada porque the chart needs the WHOLE set of ids; a per-exercise key would force N reads and would not re-render the chart on toggle. A single list key serves both readers and re-renders the chart.
13. **Add favorites to `useProgressPageRefresh` fan-out** — descartada (parked, out of scope) porque the optimistic toggle + `onSettled` invalidate already keeps the list fresh; cross-device staleness is negligible for a sole user. Low-value, parked.
14. **Separate `<FavoriteToggle>` component file (mirror `exercise-note-slot.tsx`)** — descartada porque the note slot is a component only because it owns draft/resync/commit-on-blur machinery; a favorite star is a one-tap header button with no internal state. Inline in `progress.tsx`'s header is simpler (the Pencil is also inline there). No new component file.

## Out of scope

- Separate favorites screen / favorites list view (`state.md:15`).
- Favoriting from any surface other than `progress.tsx` (picker, library list, history).
- Favorites affecting the volume or per-muscle charts (`state.md:15`) — only the e1RM chart.
- Reordering / sorting favorites — hence no `position` column.
- Adding `["exercise_favorites"]` to the Progress pull-to-refresh fan-out (Alt 13 — parked, LOW value).
- The exercise-note slot's draft/resync/commit-on-blur machinery — favorites is a one-tap toggle.
- Phase-2a deferred items (leverage factors, secondary-muscle attribution, dose-metric) (`state.md:15`).
- A `<FavoriteToggle>` component file (Alt 14 — inline in the header).
- Programmatic/unbounded palette beyond 12 lines (Alt 5 — a future "favorites galore" power-user need; not this run).

## Test plan

### §A — Unit (`tests/unit/e1rm-strength.test.ts`, extend; uses `mkRow`/`mkExercise`, injected `NOW`)

**Seed for cases 1–7:** ≥6 distinct WEIGHTED exercises with differing distinct-session counts so a known exercise sits OUTSIDE the top-5 (call the sorted order `[A,B,C,D,E,F]`, where A has the most distinct sessions). New cases (aligned to the **top-N-overall ∪ favorites** semantics):

1. **Favorite OUTSIDE top-N is ADDED** — favorite F (rank 6 by sessions). `model.series` count is `topN + 1 = 6`; F is present and appears LAST (after the top-5, per the ordering decision); the original top-5 (A..E) are all still present with ranks 0..4 unchanged. (Pins "favorite outside top-N → +1 line.")
2. **Favorite already INSIDE top-N → SAME count, id once** — favorite C (a top-3). `model.series` count is exactly `topN = 5` (UNCHANGED — no promotion of a hidden non-favorite); C's id appears exactly once; the series is byte-identical to the no-favorites output. (Pins the MAJ-1 fix: favoriting a shown exercise is a no-op.)
3. **Bodyweight-only favorite excluded** — a favorited exercise whose only sets are `weight=0` is NOT in `model.series` (Invariant D survives the union — mirror existing case #7 at `:221-250`). The favorite id is passed but it never entered `byExercise`.
4. **No-set favorite excluded** — a favorited exercise id with NO rows at all is absent from `model.series` (never enters `byExercise`).
5. **Cap drops lowest NON-favorite, not a favorite (over-ceiling)** — re-derived for the OVERALL-topN semantics: seed 13 weighted exercises `[A..M]` (A most sessions). Favorite the 8 lowest-ranked outside-top-5 exercises (F..M) PLUS E (which is in the top-5). `autoTopOverall=[A,B,C,D,E]`, `extraFavorites=[F,G,H,I,J,K,L,M]` (8 items; E excluded as it's in top-N), raw length 13 > 12 → `keptAuto = autoTopOverall.slice(0, 12-8) = [A,B,C,D]`. Assert: count is exactly 12; all 8 favorites (F..M) present; E (the lowest-ranked NON-favorite auto pick) is DROPPED; A,B,C,D present.
6. **Dense ranks** — `model.series.map(s => s.rank)` is `[0,1,2,…,M-1]` over the combined list (no gaps, no duplicate index → palette indices distinct), for both the case-1 (6-series) and case-5 (12-series) seeds.
7. **Determinism** — same inputs with `favoriteExerciseIds` built from a different insertion order (e.g. `new Set(["f","c"])` vs `new Set(["c","f"])`) produce identical series order (the final list is derived from the comparator-sorted `sorted`, independent of set iteration order — mirror existing determinism case #13 at `:425-460`).
8. **Empty favorites = current output (Invariant F)** — `presentTopExerciseE1rm({rows, exercises})` (no favorites arg) and `presentTopExerciseE1rm({rows, exercises, favoriteExerciseIds: new Set()})` produce DEEP-EQUAL output, and that output equals the pre-change `sorted.slice(0, topN)` selection. **The byte-for-byte regression guarantee, pinned.**
9. **Exactly AT the ceiling (cap boundary, no trim)** — seed 12 weighted exercises `[A..L]`. Favorite the 7 lowest outside-top-5 (F..L). `autoTopOverall=[A,B,C,D,E]`, `extraFavorites=[F..L]` (7 items), `selected.length = 5+7 = 12 = E1RM_MAX_LINES` → cap branch (`> 12`) does NOT fire. Assert: count is exactly 12; ALL of A..L present; ranks `[0..11]`; no line dropped.
10. **One OVER the ceiling (cap trims exactly one non-favorite)** — seed 13 weighted exercises `[A..M]`. Favorite the 8 lowest outside-top-5 (F..M). `selected.length = 5+8 = 13 > 12` → `keptAuto = autoTopOverall.slice(0, 12-8) = [A,B,C,D]` → count 12; E (the single lowest auto pick) dropped; F..M all present. (This and case 5 share the seed shape; keep both as distinct named assertions: case 9 = at-boundary no-trim, case 10 = one-over single-trim.)
11. **Degenerate: favorites > ceiling (favorites themselves trimmed)** — seed 14 weighted exercises `[A..N]`, all of B..N favorited (13 favorites, all outside top-5 except B..E which overlap; simpler: favorite 13 outside-top-5 exercises by seeding 5 high-session non-favorites A..E + 13 low-session favorites, total 18). `extraFavorites.length = 13 > 12` → `selected = extraFavorites.slice(0, 12)`; assert count is exactly 12, ALL kept lines are favorites, zero auto picks survive, and the 13th-lowest-comparator favorite is the one dropped.

### §B — API unit (`tests/unit/exercise-favorites-api.test.ts`, new)

Mirror `exercise-notes-api.test.ts` (the `vi.mock("~/lib/supabase")` + `pendingChains` harness). Simpler:
- `listMyFavoriteExerciseIds`: unauth → `[]`; authed → maps rows to ids; null `data` → `[]`.
- `addFavorite`: issues `.insert({user_id, exercise_id})`; a `23505` error is SWALLOWED (resolves, no throw — idempotent); a non-23505 error re-throws; unauth → throws "Not authenticated".
- `removeFavorite`: issues `.delete().eq(user_id).eq(exercise_id)`; error re-throws; unauth → throws "Not authenticated".

### §C — RLS arm (`tests/rls.test.ts`, append after `:398`, before the `console.log`)

Mirror the `exercise_notes` arm (`:133-192`). A favorites A's exercise (`aEx.id`, already created at `:58-63`):
- A inserts `{ user_id: a.user.id, exercise_id: aEx.id }` → succeeds.
- B SELECT on that pair (`.eq("user_id", a.user.id).eq("exercise_id", aEx.id)`) → 0 rows. B DELETE on that pair → 0 rows. (No UPDATE — table has no mutable column.)
- B spoof-INSERT `{ user_id: a.user.id, exercise_id: aEx.id }` → rejected by the INSERT `with check` (error OR 0 rows, like the notes spoof at `:182-192`).
- Update the final `console.log` (`:400-402`) to mention the `user_exercise_favorites` arm.
- Cleanup is covered by `deleteUser` cascade (FK `user_id` ON DELETE CASCADE) in the outer `finally` (`:403-406`).

### §D — e2e (`tests/e2e/favorite-exercises-e1rm.spec.ts`, new)

Mirror `e1rm-strength.spec.ts` harness (admin service-role seed, `signInViaUi`, `pickCanonicalExercise` with LIVE-catalog names; `gotoProgress` waits `networkidle` `:153`). To prove the union pins a NON-top-N line (Discovery #8) AND the canonical-vs-Pencil gate split (MIN-3):

**Seed (MIN-4 — exact live-catalog WEIGHTED names enumerated; Implementer/Tester MUST still live-verify each via `pickCanonicalExercise`, which throws on a missing name `canonical-exercise.ts:52-54`, so a stale name fails fast, not false-green):**
- **5 top (high distinct-session) weighted exercises**, each logged across ≥2 distinct sessions so they fill the auto top-5:
  1. "Bench Press" (carry-in verified weighted)
  2. "Squat (Barbell)" (carry-in verified weighted)
  3. "Deadlift (Barbell)"
  4. "Overhead Press (Barbell)"
  5. "Barbell Row"
- **1 TARGET weighted exercise OUTSIDE the top-5** — logged in only 1 session (lowest distinct-session count) so it falls outside the auto top-5:
  6. "Lat Pulldown (Cable)" — the favorite TARGET (a CANONICAL exercise, so it also exercises the canonical-favorite + Pencil-hidden path).
  - **All 6 must be CANONICAL (`user_id IS NULL`) live-catalog rows.** If any of names 3–6 is NOT in the live catalog at seed time, `pickCanonicalExercise` throws — the Implementer/Tester substitutes another live-catalog WEIGHTED name (do NOT use "Pull-up": not in the live catalog; do NOT favorite a bodyweight-only exercise like "Chin-up": it can't plot → vacuous).

**Steps:**
1. Seed the 6 exercises above (5 multi-session + 1 single-session TARGET, all weighted). Sign in via UI, `gotoProgress`.
2. **Settle anchor + negative-before assertion:** assert the e1RM section header is visible FIRST (positive settle anchor — the carry-in MAJ-1 settle-gate lesson), THEN assert the TARGET's chip `getByLabel("Toggle Lat Pulldown (Cable)")` has `toHaveCount(0)` (it's outside the top-5).
3. **Canonical gate split (MIN-3):** navigate to `/exercises/${targetId}/progress` (the detail-page pattern, `exercise-note.spec.ts:166`). Assert `getByLabel("Favorite Lat Pulldown (Cable)")` IS visible (the star renders on a canonical exercise) AND `getByLabel("Edit exercise")` (the Pencil's a11y label) has `toHaveCount(0)` / is NOT visible (the Pencil is hidden for a non-editable canonical exercise → proves the star is OUTSIDE the `canEdit` gate). [Note for the Implementer: the Pencil's current a11y label must be confirmed against `progress.tsx:108-122`; if it is not `"Edit exercise"`, assert on whatever unique label/role the Pencil exposes — the load-bearing assertion is "star present, Pencil absent" on the canonical target.]
4. Click the star (`getByLabel("Favorite Lat Pulldown (Cable)")`), wait for the optimistic state (the label flips to `"Unfavorite Lat Pulldown (Cable)"`), navigate back to `/progress`.
5. **Settle anchor + positive assertion:** section header visible, THEN assert `getByLabel("Toggle Lat Pulldown (Cable)")` IS now present (the favorited line joined the chart). Screenshot.
6. Navigate back to the detail page, unfavorite (`getByLabel("Unfavorite Lat Pulldown (Cable)")`), return to `/progress`; section header visible, THEN assert `getByLabel("Toggle Lat Pulldown (Cable)")` `toHaveCount(0)` (it wasn't also top-5, so it leaves).
- **Settle-gate (carry-in MAJ-1 from the Phase-2a run):** EVERY "NOT present" assertion (`toHaveCount(0)` / `.not.toBeVisible()`) MUST follow a positive settle anchor (the section header visible) so it is not a cold false-green before the chart mounts. Steps 2, 5, 6 each lead with the header-visible anchor.

## Resposta a issues do Validator (validation-v1.md)

- **[MAJ-1] (the no-go) — union semantics: top-N-of-non-favorites was wrong.** RESOLVED. The auto-selection is now the **top-N OVERALL** (`autoTopOverall = sorted.slice(0, topN)` — exactly today's selection), unioned with favorites and deduped by construction (`extraFavorites` excludes ids already in `autoTopOverall`). Consequence: a favorite already in the natural top-N is a no-op (count unchanged — §A case 2 now passes); a favorite outside the top-N adds exactly one line (§A case 1). Final order = top-N-overall first (comparator order), then extra favorites (comparator order), ranks 0-based dense — justified in "Final-list ordering" (keeps existing lines' ranks/colors stable). Cap re-verified: `selected.length` exceeds `E1RM_MAX_LINES`=12 only when `topN + extraFavorites > 12`, i.e. ≥8 outside-top-N favorites; trim drops lowest non-favorites first. Invariant F kept and now the literal `sorted.slice(0, topN)` (more obviously identical). The "What is NOT" clause adds an explicit prohibition on slicing from a non-favorite pool.
- **[MIN-1] misleading dedup comment.** RESOLVED. The pseudo-code comment now states "extraFavorites EXCLUDES autoIds, so the concat is dedup-by-construction; a favorite already in the top-N is a no-op (it's in autoTopOverall) — we do NOT slice from a non-favorite pool." No "no overlap possible" wording tied to the wrong algorithm.
- **[MIN-2] tight palette hue-spacing.** RESOLVED. The 4 appended hues are now deep-green `#15803d`, slate `#64748b`, rose `#e11d48`, brown `#92400e` — none adjacent to amber (`#f59e0b`) or violet (`#8b5cf6`), with per-hue contrast rationale. (Replaced the v1 yellow/orange/purple choices.)
- **[MIN-3] missing canonical-vs-Pencil e2e assertion.** RESOLVED. §D step 3 asserts, on the CANONICAL target "Lat Pulldown (Cable)", that the star (`getByLabel("Favorite …")`) is visible AND the Pencil (`getByLabel("Edit exercise")` / its unique label) is absent — proving the star is outside the `canEdit` gate.
- **[MIN-4] unspecified e2e seed names.** RESOLVED. §D names the exact 5 top weighted exercises (Bench Press, Squat (Barbell), Deadlift (Barbell), Overhead Press (Barbell), Barbell Row) + the 1 outside-top-N TARGET (Lat Pulldown (Cable)), all CANONICAL, with an explicit instruction to live-verify each via `pickCanonicalExercise` and substitute a live-catalog weighted name if any is missing (fails fast, not false-green).
- **[MIN-5] untested cap-boundary + promotion cases.** RESOLVED. §A pins promotion/no-promotion via case 1 (outside→+1) and case 2 (inside→same count), and adds case 9 (exactly AT E1RM_MAX_LINES, no trim), case 10 (one OVER → single lowest non-favorite dropped), and case 11 (favorites > ceiling → favorites themselves trimmed).
