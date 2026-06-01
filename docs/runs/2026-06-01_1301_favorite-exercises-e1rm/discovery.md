# Discovery — 2026-06-01_1301_favorite-exercises-e1rm

## Feature prompt

Phase 2b — Favorite exercises (pin into the e1RM strength chart). Mark exercises as "favorite" via a star toggle on the exercise detail page; favorited exercises are pinned into the Phase-2a "Estimated 1RM per exercise" chart IN ADDITION to (union with) the auto-selected most-performed top-N. New per-user join table `user_exercise_favorites(user_id, exercise_id)`; RLS per-user; PK `(user_id, exercise_id)`; FK `exercise_id → exercises`. Migration REQUIRED (next = 0020). API + hook + optimistic toggle mirroring the `exercise_notes` precedent. Out of scope: separate favorites screen, favoriting from other surfaces, favorites affecting volume/muscle chart, reordering, Phase-2a deferred items. (Full text in `state.md:3-19`.)

## Scope summary

A per-user favorites join table + API/hook + a star toggle on the per-exercise screen, wired into the existing e1RM strength chart so favorited+plottable exercises join the top-N series via UNION. The data + API + hook layer is a close analog of the `exercise_notes` triad (simpler: presence/absence, no body, no soft-delete, no upsert). The chart integration touches exactly **2 files** (`src/utils/e1rm-strength.ts` + `src/components/e1rm-strength-section.tsx`) — proven exhaustive below.

## Affected files (verified)

### New (to create)
- `supabase/migrations/0020_user_exercise_favorites.sql` — NEW table + RLS (Implementer writes the FILE; **Conductor applies** per `state.md:17`).
- `src/api/exercise-favorites.ts` — NEW: `listMyFavoriteExerciseIds()` / `addFavorite(id)` / `removeFavorite(id)` (analog of `src/api/exercise-notes.ts`, simpler).
- `src/hooks/use-exercise-favorites.ts` — NEW: `useMyFavoriteExerciseIds()` reader + `useToggleFavorite()` (or add/remove) mutation, optimistic (analog of `src/hooks/use-exercise-note.ts`).
- `src/components/favorite-toggle.tsx` (or inline) — NEW self-wired star slot (analog of `src/components/exercise-note-slot.tsx`). Designer decides component-vs-inline.
- `tests/unit/exercise-favorites-api.test.ts` — NEW (analog of `tests/unit/exercise-notes-api.test.ts:1-313`).

### Modified
- `src/db/schema.ts:277-304` — add the `userExerciseFavorites` Drizzle table after `exerciseNotes` (composite PK; see §5).
- `src/db/types.ts:37-38,254-262` — add `UserExerciseFavorite`/`NewUserExerciseFavorite` Drizzle types + a `UserExerciseFavoriteRow` PostgREST row type (analog of `ExerciseNote`/`ExerciseNoteRow`).
- `app/(app)/exercises/[id]/progress.tsx:88-125,224-237` — **THE detail page** (see §2 correction). Mount the star in the header-right (alongside the Pencil at `:108-122`) or near the title at `:224`.
- `src/utils/e1rm-strength.ts:68-148` — thread `favoriteExerciseIds` into `presentTopExerciseE1rm`; union favorited+eligible into the selected set (see §3, §4).
- `src/components/e1rm-strength-section.tsx:43-85` — read favorites at the call site; pass into the presenter; widen the palette ceiling (see §3, §6).
- `tests/unit/e1rm-strength.test.ts:65-461` — extend with favorites-union cases (see §7).
- `tests/rls.test.ts:308-398` — add a `user_exercise_favorites` cross-user arm after the `routine_exercise_sets` arm (see §5, §7).
- `tests/e2e/favorite-exercises-e1rm.spec.ts` — NEW e2e (analog of `tests/e2e/e1rm-strength.spec.ts` + `exercise-note.spec.ts`).

## §1 — The `exercise_notes` precedent (the template, studied fully)

**Migration `supabase/migrations/0010_exercise_notes.sql` (read fully):**
- Table (`:27-36`): `id uuid PK default gen_random_uuid()`, `user_id uuid NOT NULL → auth.users(id) ON DELETE cascade`, `exercise_id uuid NOT NULL → public.exercises(id) ON DELETE restrict`, `body text NOT NULL` + CHECK ≤2000, `created_at/updated_at/deleted_at` timestamps triple.
- Composite read index (`:38-40`): `(user_id, exercise_id)`.
- Partial UNIQUE (`:42-47`): `(user_id, exercise_id) WHERE deleted_at IS NULL` — "one active row per pair; soft-deleted excluded so re-create after delete is unblocked."
- RLS (`:49-67`): `enable row level security` + **4 inlined policies** each gated `auth.uid() = user_id` — `_select` (using), `_insert` (with check), `_update` (using + with check), `_delete` (using).
- Trigger (`:69-73`): `touch_updated_at` (function exists since `0001:104-112`).
- FK ON DELETE choice (`:12-14` comment): "FK RESTRICT on exercise (matches `routine_exercises.exercise_id` + `sets.exercise_id`)."

**API `src/api/exercise-notes.ts` (the 23505-retry insight):**
- `getMyExerciseNote` (`:11-27`): auth-gate → null when unauth; SELECT `.eq(user_id).eq(exercise_id).is(deleted_at,null).maybeSingle()`.
- `upsertMyExerciseNote` (`:52-102`): read-then-write loop, NOT `.upsert()`. **Why (`:33-51`):** PostgREST `onConflict` cannot forward the `WHERE deleted_at IS NULL` predicate of a *partial* UNIQUE index, so `.upsert(...,{onConflict})` fails deterministically with `42P10`. The note table works around it via explicit INSERT + SQLSTATE-`23505` discriminator + 1-retry loop.
- **Does a favorites toggle need the 23505 loop? FACT-based answer: NO, and the 42P10 trap likely does not apply.** The 23505 retry exists because a note is an *update-or-insert of a mutable body* against a *partial* unique. A favorite is presence/absence — the toggle is **plain INSERT (favorite) + plain DELETE (unfavorite)**, no body to merge, no read-then-write. If the table uses a **non-partial** composite PK `(user_id, exercise_id)` (no `deleted_at` → no `WHERE` predicate), then even an idempotent `.upsert(..., {onConflict:"user_id,exercise_id"})` is legal (a non-partial PK forwards to `ON CONFLICT` fine). Simplest correct shape: `addFavorite` = `.insert(...)` tolerating 23505 as "already favorited" (idempotent no-op), `removeFavorite` = `.delete().eq().eq()`. No retry loop, no soft-delete, no CHECK needed. (See Unknown #4.)

**Hook `src/hooks/use-exercise-note.ts`:**
- Cache key (`:8-11`): `["exercise_note", exerciseId, "me"]` — per-exercise detail key.
- Reader (`:17-23`): `useQuery`, `enabled: !!exerciseId`.
- Writer (`:31-37`): `onSuccess: qc.setQueryData(KEYS.detail, row)` — seeds cache directly (no invalidate; the note slot is the only reader). **For favorites the cache shape differs (see §6): the e1RM chart needs a LIST of favorite ids, not a per-exercise row — so the favorites key should be a single list `["exercise_favorites","me"]`, and the toggle must optimistically update THAT list so the chart re-renders.**

**Slot `src/components/exercise-note-slot.tsx`:** self-wired (takes `exerciseId`, owns its own read+write hooks `:56-57`); renders `null` while `isLoading` (`:102`). A favorite star slot can be far simpler: read the list, derive `isFavorite = ids.has(exerciseId)`, render a filled/outline star Pressable that calls the toggle. **No draft/resync/commit-on-blur machinery** (that exists in the note slot only because the note has free-text body + focus ownership).

**What favorites SIMPLIFY vs notes:** no `body`/CHECK; no `deleted_at`/soft-delete; no partial-UNIQUE (use composite PK); no `id` surrogate (natural composite key); no `updated_at`/`touch_updated_at` trigger (a favorite has no mutable fields); no read-then-write upsert loop; no resync `useEffect`.

## §2 — The exercise detail page (PROMPT CORRECTION — load-bearing)

**The prompt conflates two screens.** `state.md:11` says the toggle lives on `app/(app)/exercises/[id]/index.tsx` and your invocation says "it uses `useAllExercise(id)`... header-right slot... Pencil pattern." Those facts describe **different files**:

- `app/(app)/exercises/[id]/index.tsx` = **`EditExerciseScreen`** (verified by reading it). It is the **edit FORM** (react-hook-form + zod, `:43-294`), uses **`useExercise(id)`** (`:46`, the *filtered* hook — excludes soft-deleted), renders its own `<Stack.Screen>` (`:200`), and has a read-only branch for canonical rows for non-admins (`:141-192`). It has **no header-right slot** and **no Pencil**. Title = "Edit exercise".
- `app/(app)/exercises/[id]/progress.tsx` = **`ExerciseProgressScreen`** (verified). This is the actual **detail/progress page**: uses **`useAllExercise(id)`** (`:60`, the include-deleted hook — matches your invocation), has the **header-right Pencil pattern** (`:108-122`: `headerRight: canEdit ? () => <Pressable …><Pencil/></Pressable> : undefined`), a `headerLeft` custom-back (`:93-107`), title = exercise name (`:90`), and already hosts `<ExerciseNoteSlot>` (`:235-237`, `-mx-6` full-bleed above the chart). The exercise-note e2e drives THIS screen via `/exercises/${id}/progress` (`exercise-note.spec.ts:166,412,469`).

**FACT (HIGH confidence):** the star toggle belongs on **`progress.tsx`** — it has the `useAllExercise(id)` data, the header-right slot, the Pencil precedent, and the existing per-exercise personal-attribute slot. The exercises stack `_layout.tsx:4` is `headerShown:false`, so each screen owns its own `<Stack.Screen>` header.

**Two viable mount points on `progress.tsx` (Designer decides — Unknown #3):**
- (a) **Header-right**, alongside the Pencil (`:108-122` already builds `headerRight`). CRITICAL: `canEdit` (`:85-87`) gates the Pencil; a favorite star must show **for canonical exercises too** (you can favorite a built-in exercise you can't edit), so the star must NOT be inside the `canEdit` predicate.
- (b) **Inline near the title** (`:224-230`), a `<FavoriteToggle exerciseId={id}/>` next to the name `<Text>`. Mirrors where `<ExerciseNoteSlot>` sits (`:235-237`).
- Pencil-pattern reference (verbatim shape to mirror): `progress.tsx:108-122`. Lucide icons imported from `lucide-react-native` (`:2`: `Pencil`); a `Star` icon is available the same way.

**Read-only vs editable:** `progress.tsx` is read-only re: exercise fields (the Pencil routes to the edit form). Favoriting is a user-private action independent of edit rights, so the star is interactive on every exercise (canonical or owned, deleted or not).

## §3 — e1RM chart selection: EXHAUSTIVE close-the-set (the integration surface)

**Close-the-set proof (the load-bearing carry-in discipline).** Greps to enumerate EVERY place the plotted set is decided:
- Grep A — `presentTopExerciseE1rm` symbol: 1 definition (`e1rm-strength.ts:68`), 1 production caller (`e1rm-strength-section.tsx:50`), N test calls (`tests/unit/e1rm-strength.test.ts`).
- Grep B — `E1RM_TOP_N` / `E1RM_PALETTE` / `colorForRank`: cap lives at `e1rm-strength.ts:55,71,74`; palette + color-by-rank lives ONLY at `e1rm-strength-section.tsx:29-41,80,152`.
- Grep C — model-type consumers (`E1rmSeries`/`E1rmStrengthModel`/`.series`/`seriesKeys`/`.rank`): all inside the same two files.
- Grep D — any other file importing `e1rm-strength`: only `app/(app)/progress/index.tsx`, which mounts `<E1rmStrengthSection/>` (`:75`) with **no props** and reads none of its internals.

**Verdict (HIGH confidence): the e1RM selection logic is centralized in EXACTLY 2 production files. There is no N+1th site.** (Same centralization win the Phase-2a Discovery achieved with `epley1RM`.)

**EVERY place the plotted set is decided (the integration map):**

| # | Location | What it decides | Favorites impact |
|---|---|---|---|
| 1 | `e1rm-strength.ts:106-109` | **Eligibility filter** (Invariant D: `w>0 && r>0` logged weight; bodyweight skipped) | UNCHANGED — a favorited bodyweight-only exercise still has no eligible cell → must NOT plot (never enters `byExercise`). |
| 2 | `e1rm-strength.ts:113-123` | `byExercise` map built ONLY for eligible (weighted) exercises | A favorited exercise appears here only if it has ≥1 weighted set. |
| 3 | `e1rm-strength.ts:138-148` | **Distinct-session ranking** (sessions DESC → recency → name ASC → id ASC) `.slice(0, topN)` | **THE injection point.** Today `.slice(0,topN)` is the ONLY gate. Favorites must be unioned with the top-N slice (union rule = Unknown #1/#2). |
| 4 | `e1rm-strength.ts:151,180` | `ranked.map((agg, rank) => …)` assigns **`rank` = array index** | If favorites are merged, `rank` must stay 0-based DENSE over the FINAL combined list (drives palette index downstream). |
| 5 | `e1rm-strength.ts:150-181` | **LOCF** value-fill per series | UNCHANGED — applies per emitted series regardless of how it was selected. |
| 6 | `e1rm-strength-section.tsx:29-41` | **Palette-by-rank** (`E1RM_PALETTE` 8 hexes; `colorForRank(i)=PALETTE[i%len]`) | **Length assumption (`:28`): "N=5 ≤ 8 so `% length` never wraps."** A union can exceed 8 → wrap → COLOR COLLISION. Headline integration risk (Unknown #2). |
| 7 | `e1rm-strength-section.tsx:55-58` | `seriesKeys = model.series.map(s=>s.id)` | Auto-derives from `model.series` — works for any count, no change if union is in the presenter. |
| 8 | `e1rm-strength-section.tsx:60-70` | **Visible-set seeding** (`useState(()=>new Set(seriesKeys))`) + re-seed on signature change (`:66-70`) | Auto-on for any new series id (a newly-favorited line starts visible). The `seriesKeysSig` (`:59`) changes when the line joins → re-seeds "all on" (`:69`). Already handles "freshly appearing line not hidden" (`:64-65`). |
| 9 | `e1rm-strength-section.tsx:72-85` | `chartSeries` map (label=name, color=colorForRank(rank), visible) | Works for any count; depends on #4's rank density + #6's palette. |
| 10 | `e1rm-strength-section.tsx:88` | **Empty-state gate** `model.series.length===0 → return null` | If union AND top-N both empty (bodyweight-only user) → still null. The Phase-2a NEGATIVE e2e (`e1rm-strength.spec.ts:272-318`) depends on this. |
| 11 | `e1rm-strength-section.tsx:92,100-103` | **Check-all/uncheck-all** seeds from `seriesKeys` | Auto-covers the union. No change. |
| 12 | `multi-series-chart.tsx:53-61,81,88-89` | **Y-domain** = max across visible series (min pinned 0); x-axis from `xLabels.length` | UNCHANGED — recomputes over visible series. A favorited line with higher e1RM auto-expands the y-domain. |

**Downstream things that assume "exactly top-N series" — the bug-risk list:**
- **Palette length (#6)** — the ONLY hard assumption. `E1RM_PALETTE` has 8 hexes; `:28` says N=5≤8 so wrap is "defensive only." A union of top-5 + favorites can exceed 8 → `colorForRank` wraps → two lines share a color. **THE headline integration risk.**
- **Rank density (#4)** — `rank` is the array index of the FINAL list; building the union as a single sorted list → `.map((agg,rank)=>…)` keeps ranks dense. The risk is building favorites as a SEPARATE list with its own ranks (would collide palette indices with top-N).
- Visible-set seeding (#8), check-all (#11), y-domain (#12), empty-state (#10), seriesKeys (#7) — all auto-derive from `model.series` and need **no change** if the union happens inside the presenter.

**Recommended seam (HIGH confidence): do the union INSIDE `presentTopExerciseE1rm`**, producing a single rank-dense `series[]`. Then the section + chart need ZERO selection-logic changes except the palette ceiling (#6). Smallest blast radius; keeps "exactly one place decides the plotted set."

## §4 — Favorites → e1RM data join

`presentTopExerciseE1rm` inputs today (`e1rm-strength.ts:68-74`): `{ rows: WeeklyVolumeRow[]; exercises: ExerciseRow[]; topN?: number; now?: Date }`. The per-week best-e1RM agg (`byExercise`, `:98-131`) is built for **every eligible exercise in `rows`**, not just the top-N — the `.slice(0,topN)` (`:148`) is applied AFTER aggregation. **A favorited exercise's e1RM series is therefore ALREADY computed in `byExercise`** as long as the user has ≥1 weighted set for it; it's just dropped by the slice. So the join is cheap: thread `favoriteExerciseIds: Set<string>` and select `topN ∪ {favorited ∩ eligible}` instead of a bare slice.

- **Thread-in shape (Designer):** add `favoriteExerciseIds?: ReadonlySet<string>` (or `string[]`) to the args. The union rule operates on `ranked` (the fully-sorted eligible list) before/instead of `.slice`.
- **Call-site availability:** the section (`e1rm-strength-section.tsx:43-51`) already reads `rows` (`useLifetimeWeeklyVolume`, `:44`) + `exercises` (`useAllExercises`, `:45`). It must ALSO read favorites via the NEW `useMyFavoriteExerciseIds()` hook and add it to the `useMemo` deps (`:48-51`) so the model recomputes when favorites change.
- **A favorited exercise with NO weighted sets can't plot** — it never enters `byExercise` (filtered at `:109`, the Invariant-D gate). So "favorited bodyweight-only / no-e1RM" is handled FOR FREE by the existing eligibility filter; the union of `favorited ∩ eligible` naturally excludes it. The favorite still persists in the DB (the chart just shows no line). Matches `state.md:13`.
- **The `exercises` list resolves the name** (`libById`, `:95,103-104`). `useAllExercises` (`exercises.ts:36-44`) returns canonical + user-owned + soft-deleted rows, so a favorited canonical exercise's name resolves. Dangling/missing ids are skipped (`:104`).

## §5 — Migration + RLS

- **Next free migration: `0020` (FACT, verified).** Latest is `0019_session_exercise_order.sql`; matches `state.md:10`. (NOTE: bash `ls` of `supabase/migrations/` returns empty inside the sandbox; verified with `dangerouslyDisableSandbox` — 21 entries, last = 0019.)
- **RLS pattern to mirror (the `auth.uid()=user_id` shape):** `0010_exercise_notes.sql:49-67` — `enable row level security` + 4 inlined policies (`_select` using, `_insert` with check, `_update` using+with check, `_delete` using). **Favorites needs only 3 policies** — SELECT/INSERT/DELETE (no UPDATE; a favorite has no mutable column). `state.md:10` explicitly scopes RLS to SELECT/INSERT/DELETE.
- **Table shape (recommended, Designer confirms):**
  ```sql
  create table public.user_exercise_favorites (
    user_id uuid not null references auth.users(id) on delete cascade,
    exercise_id uuid not null references public.exercises(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, exercise_id)
  );
  ```
  The composite PK gives the UNIQUE + the read index for free (no separate partial-UNIQUE; no `id` surrogate; no `deleted_at`).
- **FK `exercise_id` ON DELETE — DIVERGENCE from notes, justified:** `exercise_notes` uses `ON DELETE RESTRICT` (`0010:30`, comment `:12-14` "matches `routine_exercises`/`sets`"). RESTRICT exists there because a note is *content the user authored*. A **favorite is a disposable pointer**: if an exercise row is ever hard-deleted, the favorite should vanish, not block. **Recommend `ON DELETE CASCADE` for `exercise_id`** (Unknown #5). NOTE: the app **soft-deletes** exercises (`exercises.ts:99-105` sets `deleted_at`, never hard-DELETE), so neither RESTRICT nor CASCADE fires in practice today — but CASCADE is the cleaner intent for a pointer table. `user_id` → `ON DELETE cascade` (matches every per-user table).
- **Canonical exercises (`user_id IS NULL`) CAN be favorited — confirmed (HIGH).** The FK is to `exercises.id` regardless of the exercise's owner. RLS reading a canonical exercise: the widened `exercises_select` policy (`0011:28-30`: `user_id is null or auth.uid() = user_id`) lets any authed user SELECT canonical rows; `tests/rls.test.ts:212-233` proves BOTH User A and User B can read a canonical row. So favoriting "Bench Press" (canonical) inserts `(their_uid, bench_canonical_id)` — the favorites RLS gates on `auth.uid()=user_id` (their own row), the FK target is readable. **No RLS issue.** The favorites table's own RLS does NOT need to special-case canonical — the row's `user_id` is always the favoriting user.
- **Drizzle schema (`src/db/schema.ts`):** add `userExerciseFavorites` after `exerciseNotes` (`:304`). Composite PK via `(t)=>({ pk: primaryKey({columns:[t.userId,t.exerciseId]}) })` — `primaryKey` is NOT currently imported (`:2-13`); add it. SQL remains source-of-truth (codebase convention, e.g. `:108-117,296-303`).

## §6 — Hooks / cache + invalidation

- **The e1RM section's query dependencies (`e1rm-strength-section.tsx:44-45`):** `useLifetimeWeeklyVolume()` (key `["stats","weekly-volume","lifetime"]`, `use-stats.ts:25`) + `useAllExercises()` (key `["exercises","all"]`, `use-exercises.ts:43-44,23`). The model is memoized on `[rows, exercises]` (`:48-51`).
- **NEW favorites key — recommend a single LIST key `["exercise_favorites","me"]`** (NOT the per-exercise `["exercise_note", id, "me"]` shape). The chart needs the *whole set* of favorite ids; the toggle on the detail page also derives `isFavorite` from the same list. One list key serves both readers and makes invalidation trivial. (Unknown #6.)
- **What must invalidate it:** the favorite/unfavorite mutation's `onSuccess`/`onMutate` must update `["exercise_favorites","me"]` (optimistic `setQueryData` to add/remove the id, or `invalidateQueries`). Because the section's `useMemo` (`:48-51`) re-runs when its query data changes, and the favorites hook is read AT the section call site, **the chart re-renders when the favorites list changes** — provided the favorites query is added to the section AND its data is in the `useMemo` deps. **This is the load-bearing wiring: the favorites query must be a dependency of the model.**
- **Optimistic toggle (mirror `use-exercise-note.ts:31-37`'s `setQueryData` idiom):** on toggle, optimistically add/remove the id in the cached list so the star flips instantly AND the chart line appears/disappears instantly; reconcile on settle. TanStack `onMutate`/`onError` rollback, or `setQueryData` on success (Designer picks; `state.md:11` requires optimistic).
- **Cross-tab/refetch:** the Progress page's pull-to-refresh fans out `["stats"]`+`["exercises"]` (`progress/index.tsx` doc `:35`). If favorites should refresh on pull-to-refresh too, the `useProgressPageRefresh` fan-out would need `["exercise_favorites"]` added — Designer decides (LOW priority; the optimistic toggle already keeps it fresh).

## §7 — Tests

- **Unit conventions (FACT):** vitest, `*.test.ts` under `tests/unit/`, NO React-Native-Testing-Library. `npm run unit` = `vitest run` (`package.json:17`). Presenter tests inject `now` for determinism (`e1rm-strength.test.ts:20-21`); time is NOT faked.
- **`e1rm-strength.test.ts` structure (to extend for the union):** 13 cases (`:65-461`) using `mkRow`/`mkExercise` factories (`:23-63`). New cases for the union:
  - A favorited exercise OUTSIDE the top-N (e.g. rank 6 by sessions) IS pinned into the series when `favoriteExerciseIds` includes it.
  - A favorited exercise INSIDE the top-N is not duplicated (union, not concat).
  - A favorited bodyweight-only exercise (weight=0) is NOT plotted even when favorited (Invariant D survives the union — mirror case #7/#10 `:221-250,347-383`).
  - A favorited exercise with NO sets at all is NOT plotted (never enters `byExercise`).
  - Rank density: the combined list has dense 0-based ranks (palette indices don't collide).
  - Determinism: union order is stable regardless of favorites-set iteration order (mirror case #13 `:425-460`).
- **API unit test:** new `tests/unit/exercise-favorites-api.test.ts` mirroring `exercise-notes-api.test.ts:1-313` (the `vi.mock("~/lib/supabase")` chain + `pendingChains` harness). Simpler: auth-gate, list returns ids, addFavorite INSERT (+ idempotent 23505 swallow if chosen), removeFavorite DELETE.
- **RLS test arm (the precedent you referenced):** `tests/rls.test.ts` — a standalone **node/tsx script, NOT vitest** (no npm script; run manually with env vars per `:5-13`). Per-table arms: exercises (`:57-86`), measurement_entries (`:88-131`), **exercise_notes (`:133-192`** — the closest template: A inserts a note on A's exercise → B SELECT/UPDATE/DELETE return 0 rows → B spoof-insert rejected), canonical (`:194-306`), routine_exercise_sets (`:308-398`). **Add a `user_exercise_favorites` arm** after `:398`: A favorites A's exercise (or a canonical) → B cannot SELECT/INSERT/DELETE that favorite row → B spoof-insert with `user_id=A` rejected by the INSERT `with check`. `state.md:17` requires this arm. `canonical-exercise-gating.spec.ts:19-22` shows re-asserting an RLS arm from the e2e suite too.
- **e2e harness (FACT):** `tests/e2e/e1rm-strength.spec.ts` is the 1:1 template — admin service-role seed, sign-in via UI (`:140-149`), `gotoProgress` (`:151-154`), assert on the section header + `getByLabel("Toggle <Name>")` chip. NEW e2e should: seed a weighted exercise outside the top-N, favorite it via the detail-page star, assert its line/chip appears; unfavorite → disappears. The detail-page navigation pattern is `/exercises/${id}/progress` (`exercise-note.spec.ts:166`).
- **`pickCanonicalExercise` uses the LIVE canonical catalog (`_helpers/canonical-exercise.ts:34-60`):** queries `exercises WHERE user_id IS NULL AND deleted_at IS NULL`. **Live-catalog-verified known-good names (carry-in):** "Bench Press" / "Squat (Barbell)" (weighted), "Chin-up" (bodyweight). **"Pull-up" is NOT in the live canonical catalog** (carry-in, `state.md:19`) — do NOT seed with it even though `0001:70` seeds it (that's the per-user TRIGGER seed, dropped in `0011:44-59`; the live catalog is the `user_id IS NULL` set from `0011`/`0014`, which the helper queries).

## Relevant conventions (verified by reading code)
- **Per-user table RLS:** 4-policy `auth.uid()=user_id` block, inlined (`0010:49-67`); favorites needs only 3 (no UPDATE).
- **Partial-UNIQUE vs composite-PK:** notes/measurements/routine_exercises use partial UNIQUE because they soft-delete (`schema.ts:108-117,271-274,296-303`). Favorites has no soft-delete → use a plain **composite PK** (simpler, gives the index for free).
- **SQL is source-of-truth for constraints Drizzle can't express** (`schema.ts:108-117,227-231,296-303`); the Drizzle table is a typing mirror.
- **Cache-key prefix invalidation** (`use-exercises.ts:14-25`): `["exercises"]` is a strict prefix → one invalidate covers all variants. Favorites should pick a clean prefix `["exercise_favorites"]`.
- **Lucide icons** from `lucide-react-native` (`progress.tsx:2`); header-right Pressable pattern at `progress.tsx:108-122`.
- **NativeWind chip styling** for legend toggles: `e1rm-strength-section.tsx:145-149` (on/off `opacity-40`); the e2e asserts on the `opacity-40` class (`e1rm-strength.spec.ts:243-250`) because rn-web 0.21 drops `aria-checked`.
- **Row-type duality** (`db/types.ts:70-72`): Drizzle InferSelectModel (camelCase) + a hand-written PostgREST `*Row` type (snake_case) consumed by screens/hooks; `ExerciseNoteRow` (`:254-262`) is the favorites template.

## Constraints
- **Data:** NEW table `user_exercise_favorites`, RLS per-user (SELECT/INSERT/DELETE), composite PK `(user_id, exercise_id)`, FK `user_id→auth.users` cascade, FK `exercise_id→exercises` (recommend CASCADE; notes used RESTRICT — divergence justified §5). Canonical-exercise favoriting works (FK + widened SELECT). Migration 0020, **applied by Conductor** (`state.md:17`).
- **UI:** star toggle on `progress.tsx` (NOT `index.tsx` — §2); must show for canonical exercises too (outside `canEdit`); optimistic.
- **Platform:** e2e is web (Playwright rn-web 0.21 — assert on classnames, not aria; `e1rm-strength.spec.ts:241-243`).
- **Auth:** sole user; the favorites read is auth-gated like notes (`exercise-notes.ts:14-16`).
- **Performance:** favorites list is tiny; the e1RM presenter already aggregates ALL eligible exercises (`:98-131`), so unioning favorites adds no extra scan — it only changes which aggregated entries survive the slice.

## Existing precedents
- **`exercise_notes` triad** = the table+API+hook+slot template (§1): `0010_exercise_notes.sql`, `src/api/exercise-notes.ts`, `src/hooks/use-exercise-note.ts`, `src/components/exercise-note-slot.tsx`, `tests/unit/exercise-notes-api.test.ts`.
- **Phase-2a e1RM triad** = the integration target (§3): `src/utils/e1rm-strength.ts`, `src/components/e1rm-strength-section.tsx`, `tests/unit/e1rm-strength.test.ts`, `tests/e2e/e1rm-strength.spec.ts`.
- **Header-right button (Pencil)**: `app/(app)/exercises/[id]/progress.tsx:108-122`.
- **Canonical-exercise read + RLS**: `0011_canonical_exercises.sql:28-30`; `tests/rls.test.ts:194-306`.
- **Multi-arm RLS script**: `tests/rls.test.ts` (exercises/measurements/notes/canonical/routine_exercise_sets arms).
- **`pickCanonicalExercise` live-catalog helper**: `tests/e2e/_helpers/canonical-exercise.ts`.

## Unknowns (require Designer judgment or human decision)

1. **Union/cap/ordering rule for favorites ∪ top-N.**
   (a) How do favorited+eligible exercises combine with the auto top-N? (b) Why it matters: determines max line count → palette wrap → color collision, and series ordering (rank → color). (c) **Recommended default:** union = top-N (by distinct sessions) ∪ {favorited ∩ eligible}, deduped by id; order = top-N first (rank order), then favorited-not-in-topN (same comparator: sessions DESC → recency → name → id); ranks reassigned dense 0..M-1 over the final list. Cap: see Unknown #2.

2. **Palette / readable ceiling when the union exceeds 8 (the headline risk).**
   (a) `E1RM_PALETTE` has 8 hexes; `colorForRank` wraps via `%len` (`e1rm-strength-section.tsx:29-41`). A union can exceed 8 → two lines same color. (b) Why: silent color collision = the integration bug. (c) **Recommended default:** keep top-N=5 as the auto cap, then add favorited exercises up to a TOTAL ceiling of 8 (the palette length) so no color repeats; favorites beyond 8 are persisted but not auto-plotted. Simpler alt: cap union at 8, preferring favorites over marginal top-N entries when over budget. **Designer must pick a deterministic rule and the unit tests must pin it.**

3. **Favorite toggle mount point on `progress.tsx`.**
   (a) Header-right (alongside Pencil, but OUTSIDE the `canEdit` gate) vs inline near the title/`<ExerciseNoteSlot>`. (b) Why: header-right is the established affordance (Pencil), but `canEdit` (`progress.tsx:85-87`) gates that slot and a star must show for canonical (non-editable) exercises. (c) **Recommended default:** inline `<FavoriteToggle>` next to the title `Text` (`progress.tsx:224-230`), mirroring where the note slot sits — avoids entangling with the `canEdit` header logic. Header-right is acceptable if the star is added outside the `canEdit` predicate.

4. **Toggle API shape (INSERT/DELETE vs upsert; idempotency).**
   (a) Plain INSERT+DELETE, or idempotent INSERT (swallow 23505) / `ON CONFLICT DO NOTHING` / `.upsert(ignoreDuplicates)`. (b) Why: a double-tap or stale optimistic state could re-insert. With a non-partial composite PK, `.upsert` is legal (no 42P10 trap, unlike notes). (c) **Recommended default:** `addFavorite` = `.insert(...)` treating SQLSTATE 23505 as success (already favorited, idempotent); `removeFavorite` = `.delete().eq(user_id).eq(exercise_id)`. No retry loop, no soft-delete.

5. **FK `exercise_id` ON DELETE: CASCADE vs RESTRICT.**
   (a) Notes used RESTRICT (`0010:30`). (b) Why: a favorite is a disposable pointer; RESTRICT would block a future hard-delete. App soft-deletes today so neither fires in practice. (c) **Recommended default:** CASCADE (pointer state, not authored content). Designer/Conductor confirm.

6. **Favorites cache key + refresh fan-out.**
   (a) Single list key `["exercise_favorites","me"]` (recommended) vs per-exercise. (b) Why: the chart needs the whole set; the toggle needs `has(id)`. A list key serves both and re-renders the chart on change. (c) **Recommended default:** `["exercise_favorites","me"]` list of ids; optimistic `setQueryData` on toggle; add to the section's `useMemo` deps; optionally add to `useProgressPageRefresh` fan-out (LOW priority).

7. **Where the union happens: presenter vs section.**
   (a) Inside `presentTopExerciseE1rm` (single rank-dense list) vs in the section after the model. (b) Why: doing it in the presenter keeps "one place decides the plotted set," needs only the palette-ceiling change in the section, and is unit-testable. (c) **Recommended default:** in the presenter — thread `favoriteExerciseIds?: ReadonlySet<string>` and change `.slice(0,topN)` to the union-then-cap selection.

8. **e2e seeding to force a non-top-N favorite.**
   (a) To prove "favorite pins a line that wouldn't otherwise show," the seed must create ≥6 weighted exercises (so a favorited 6th is outside top-5) OR favorite a low-session weighted exercise. (b) Why: otherwise the favorited exercise would already be in the auto top-N and the test is vacuous. (c) **Recommended default:** seed top-5 high-session weighted exercises + 1 low-session weighted exercise, favorite the low-session one, assert its chip/line appears only after favoriting. Use live-catalog names (Bench Press / Squat (Barbell) / etc.; avoid "Pull-up").

9. **Locator-collision pre-audit (carry-in lesson).**
   (a) The new e2e and the existing `e1rm-strength.spec.ts` both surface exercise names. (b) Why: a favorited exercise's name now appears as a legend chip (`getByLabel("Toggle <Name>")`) AND the star toggle; bare `getByText(name).first()` can collide. (c) **Recommended default:** use `getByLabel("Toggle <Name>")` (the unique chip a11y label — `e1rm-strength.spec.ts:193`) for chart assertions and give the star a UNIQUE a11y label (e.g. `Favorite <Name>` / `Unfavorite <Name>`) so it does not collide with the legend chip. Audited specs surfacing names that use `.first()`/`getByLabel`: `e1rm-strength.spec.ts:193,244,310`, `exercise-note.spec.ts:250,283,389`, `exercise-progress-ia.spec.ts:250,297`.

## Out-of-scope flags
- Separate favorites screen / favorites list view (`state.md:15`).
- Favoriting from any surface OTHER than `progress.tsx` (the picker, library list, history — NOT in scope).
- Favorites affecting the volume or per-muscle charts (`state.md:15`) — only the e1RM chart.
- Reordering / sorting favorites (`state.md:15`) — hence no `position`/ordering column.
- The exercise-note slot's draft/resync/commit-on-blur machinery — favorites is a one-tap toggle.
- Phase-2a deferred items (leverage factors, secondary-muscle, dose-metric) (`state.md:15`).
- Soft-delete / `deleted_at` on favorites (unfavorite = hard DELETE; presence/absence).
- A separate per-exercise favorite cache key (`["exercise_favorite", id]`) — a single list key is simpler and required for the chart re-render.
```
