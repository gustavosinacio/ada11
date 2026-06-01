---
run-id: 2026-06-01_0941_session-finish-exercise-order
security_relevant: no
supersedes: fix-plan.md (v1)
revision: v2 (pre-approval — owner added the History edit-mode reorder requirement)
---

# Fix plan v2 — 2026-06-01_0941_session-finish-exercise-order

> Standalone. The Implementer and Regression Tester read THIS file, not v1 + a diff.
> v2 = v1 (persisted `session_exercise_order` column + snapshot-at-Finish) PLUS a
> History edit-mode up/down reorder control that PERSISTS the new order to the
> same column. Each change below is tagged **[v1-carryover]** or **[v2-new]**.

## Scope

**Includes (blocker + major from `diagnosis.md`, plus the owner's added requirement):**

- BLOCKER **[v1-carryover]** — History detail (`app/(app)/history/[id].tsx:91-117`) reorders exercises vs the live screen. Fixed by making History read a **persisted, session-scoped exercise order** instead of deriving order from the tie-broken set query.
- BLOCKER **[v1-carryover]** — `listSetsForSession` (`src/api/sets.ts:43-56`) `set_number`-only sort with no secondary key is the proximate tie-break. We do **not** change this query's sort (`set_number` stays the PRIMARY within-exercise key — hard constraint, see Risks). We layer a persisted exercise order **above** it.
- MAJOR **[v1-carryover]** — non-persistence of the authoritative live order (`workout/[sessionId].tsx:124-131, 281-290`: `exerciseOrderOverride` / `adHocExerciseIds`, client-only). Fixed by **snapshotting the live `orderedExercises` sequence to the DB at Finish**.
- MAJOR **[v1-carryover]** — interleaved seed insertion (`routine-exercise-sets.ts:233-243, 288-351`) is why a `created_at`/`id` tie-break can NOT recover routine order. **Addressed by avoidance**: the snapshot captures the routine-position order the live screen already shows; the seed's insertion order becomes irrelevant to display. No change to `seedSetsForSession`.
- OWNER-ADDED REQUIREMENT **[v2-new]** — expose the up/down reorder chevrons on the History detail **EDIT** page and **persist** the reordering to `session_exercise_order`. This also gives a **legacy session** (column currently `NULL`) a real order the first time the user reorders it — the manual recovery path for old sessions.

**Explicitly does NOT include** (see "Out of scope" for the full list): drag-and-drop reorder; reorder controls in the read-only (non-edit) History view; persisting live mid-session reorder (still snapshot-only at Finish on the live screen); changing within-exercise set order; changing `listSetsForSession`'s sort; the stale comments in `volume-target.ts` (minor); any verdict-screen change; a remove-exercise control in History (not present today — see note in §5).

## Approach

Two layers, one column.

1. **Persistence layer [v1-carryover].** Add a nullable **`session_exercise_order uuid[]`** column to `sessions` (migration `0016`). It stores an ordered array of `exercise_id`s — the session-level exercise display order. At Finish, snapshot the live screen's already-resolved `orderedExercises.map(e => e.id)` into it. History reads it to order its exercise blocks; legacy/`NULL` → deterministic first-occurrence fallback. `set_number` remains the primary within-exercise sort, untouched.

   Why direction (c) "persist", sub-variant "snapshot at Finish", and not (a) "deterministic secondary `.order` key" or (b) "History orders by routine `position`": the diagnosis establishes as fact (`diagnosis.md:58-67`) that three of the live order's four inputs (set-first-occurrence ordering, ad-hoc additions, manual reorder) are **never persisted**. (a) and (b) both reconstruct order from data that **cannot discriminate the order the user actually saw** for ad-hoc / manually-reordered sessions — the exact failure class flagged in the prior Fix Designer feedback (a mechanism whose source can't represent the must-match case). (a) converts "unstable" to "stably wrong"; (b) fixes only routine sessions and re-ties for ad-hoc. Only (c) satisfies the repro's "Expected" (History == live order) for all three session shapes (routine / ad-hoc / manual reorder). The snapshot is taken at Finish because that is the single moment the live screen has all four inputs already resolved into `orderedExercises` (`workout/[sessionId].tsx:215-279`).

   Why `uuid[]` on `sessions`, not a junction table or a column on `sets`: the order is a **session-level** fact (one ordered list per session), so it lives on the `sessions` row. One nullable column is the minimal footprint, zero new RLS surface (inherits `sessions`' per-user policies), one write at Finish, one write per History reorder, one read in History. A junction table adds a whole table + RLS policies + a join read; a `sets.exercise_order int` column denormalizes the value across every set of an exercise (update anomalies, forces the write to touch every set row, forces the seed to populate it). See Alternativas.

2. **Reorder layer [v2-new].** History detail already renders an **editable `<ExerciseBlock>`** (not `<ReadOnlyExerciseBlock>`) when `isEditing` is true (`history/[id].tsx:325-369`). `<ExerciseBlock>` already accepts `onMoveUp`/`onMoveDown`/`isFirst`/`isLast` and renders the chevrons whenever either handler is passed (`src/components/exercise-block.tsx:24-25, 163, 204-227`) — the SAME control the live screen uses (`workout/[sessionId].tsx:466-467, 478-479`). So we do NOT build a new control: we pass `onMoveUp`/`onMoveDown`/`isFirst`/`isLast` to the History edit-mode `<ExerciseBlock>` only. The read-only block has no such props (and we add none), so the non-edit view stays chevron-free by construction.

   To make the chevrons mutate order, History needs a **local editable order array** (`localOrder: string[] | null`) seeded from the persisted `session_exercise_order` (or the deterministic fallback when `NULL`). A chevron tap swaps two ids in `localOrder` AND persists the full new array via a new `useUpdateSessionExerciseOrder` mutation (optimistic). Persisting **per tap** (rationale in §"Persist-timing decision"). The first persist of a legacy session writes its full current displayed order into the column — that is how a legacy session "gets fixed" (§"Legacy-session recovery flow").

## Mudanças por arquivo

| File | Type | Tag | Change |
|---|---|---|---|
| `supabase/migrations/0016_session_exercise_order.sql` | new | v1-carryover | Add nullable `session_exercise_order uuid[]` to `public.sessions`. No backfill (legacy → `NULL` → fallback). No new RLS (inherits `sessions` policies). DDL below. **OWNER applies via `db:push` — the Implementer writes the file but does NOT run it against the live DB.** |
| `src/db/schema.ts` | edited | v1-carryover | Add `sessionExerciseOrder: uuid("session_exercise_order").array()` (nullable) to the `sessions` pgTable (`:120-140`). Keeps Drizzle in sync with the migration. |
| `src/db/types.ts` | edited | v1-carryover | Add `session_exercise_order: string[] \| null;` to `SessionRow` (`:196-208`). The PostgREST row shape History reads. |
| `src/api/sessions.ts` | edited | v1-carryover + v2-new | (v1) Extend `finishSession(id, exerciseOrder?)` to write `session_exercise_order` in the SAME `update({ ended_at, session_exercise_order })`. (v2) Add `updateSessionExerciseOrder(id, order)` — a standalone `update({ session_exercise_order: order })`. Contracts below. |
| `src/hooks/use-sessions.ts` | edited | v1-carryover + v2-new | (v1) Change `useFinishSession` input `string` → `{ id; exerciseOrder? }` forwarding to `finishSession`; keep existing cache writes/invalidations. (v2) Add `useUpdateSessionExerciseOrder()` — optimistic `onMutate` rewrite of the `["sessions", id]` detail cache, `onError` rollback, `onSettled` invalidate (mirrors `useReorderRoutineExercises`, `use-routine-exercises.ts:50-80`). Contracts below. |
| `app/(app)/workout/[sessionId].tsx` | edited | v1-carryover | In `finishAfterMutation` (`:336-344`) pass `exerciseOrder: orderedExercises.map(e => e.id)` to `finish.mutateAsync({ id: sessionId, exerciseOrder })`. Computed AFTER `bulkCheckAll`/`bulkDiscardUnchecked` settle and after `removedExerciseIds` is applied (the closure's `orderedExercises` already excludes removed). One responsibility: capture the displayed order at Finish. |
| `app/(app)/history/[id].tsx` | edited | v1-carryover + v2-new | (v1) Make `orderedExercises` honor the persisted order with deterministic fallback. (v2) Add `localOrder` state + a `moveExercise(exerciseId, direction)` handler; pass `onMoveUp`/`onMoveDown`/`isFirst`/`isLast` to the edit-mode `<ExerciseBlock>` (`:327`) only; wire the persist hook. State machine below. |

One-responsibility note on the two combined files: `src/api/sessions.ts` and `src/hooks/use-sessions.ts` each get a v1 change AND a v2 change. This is justified — both changes are the SAME responsibility ("the session-update surface for the new column"): the finish path writes it at Finish, the new fn/hook writes it on reorder. Splitting across files would scatter one column's write paths. `history/[id].tsx` likewise: the read (v1) and the reorder-write (v2) both serve "History honors the persisted order", and the reorder write is meaningless without the read.

### Migration DDL (`0016_session_exercise_order.sql`)

```sql
-- =============================================================================
-- 0016_session_exercise_order.sql
-- Hand-written. Persist the per-session EXERCISE display order:
--   1) snapshotted from the live workout screen when the user taps Finish, and
--   2) editable from the History detail EDIT page via up/down chevrons.
-- Fixes History reordering exercises vs the order shown during the live workout,
-- and lets a user re-sequence (and recover the order of) older sessions.
--
-- Storage: an ordered uuid[] of exercise_id on the sessions row. Nullable;
-- legacy/in-progress sessions stay NULL and the read-side falls back to a
-- deterministic first-occurrence order. No new RLS — inherits the existing
-- sessions policies (already gated on auth.uid() = user_id), which cover
-- both the SELECT (read in History) and the UPDATE (write on reorder/Finish).
-- =============================================================================

alter table public.sessions
  add column session_exercise_order uuid[];

-- Intentionally NO backfill: historical finished sessions never recorded the
-- order the user saw, so we cannot recover it automatically. They keep NULL and
-- render via the deterministic read-side fallback. A user can manually re-order
-- such a session in History EDIT mode, which writes the column for the first
-- time (the legacy-recovery path). See fix-plan "Legacy-session recovery flow".
```

No `NOT NULL`, no default, no index. RLS unchanged. Applied by the **OWNER via `npm run db:push`** (= `npx supabase db push`), per the state.md "Follow-up clarifications" decision — the Implementer must NOT run `db:push`/`apply_migration` against the live project.

**TODO: Implementer to verify** — confirm PostgREST returns a `uuid[]` column as a JS `string[]` via `supabase-js` and that both `.update({ session_exercise_order: [...] })` (Finish + reorder) round-trip the array. If the array round-trip is awkward, fall back to a `jsonb` column (`string[]` JSON) and document the deviation in `implementation.md`. Drizzle's `.array()` on a `uuid` column is the expected mapping; verify against drizzle-orm 0.38 (`package.json:72`) before relying on the generated SQL. (Note: the Implementer is NOT generating SQL via `db:generate` here — the migration is hand-written and owner-applied — so the Drizzle mapping only needs to typecheck, not to produce the DDL.)

## Contratos de I/O

### `src/api/sessions.ts` [v1-carryover + v2-new]

```ts
// [v1] second param added, optional → back-compatible with any other caller.
export async function finishSession(
  id: string,
  exerciseOrder?: string[],
): Promise<SessionRow>;
//   writes update({ ended_at: <now>, session_exercise_order: exerciseOrder })
//   when exerciseOrder is provided; when omitted, writes only { ended_at }
//   (do NOT write `session_exercise_order: undefined` — omit the key so a
//    zero-exercise Finish leaves the column NULL rather than clobbering it).

// [v2] new standalone write path for reorder OUTSIDE the Finish flow.
export async function updateSessionExerciseOrder(
  id: string,
  order: string[],
): Promise<SessionRow>;
//   update({ session_exercise_order: order }).eq("id", id).select().single()
//   Mirrors updateSessionName/updateSessionTimes exactly (sessions.ts:87-113).
```

### `src/hooks/use-sessions.ts` [v1-carryover + v2-new]

```ts
// [v1] mutation input changes string → object. CALLER CHANGE REQUIRED in
// workout/[sessionId].tsx (finish.mutateAsync(sessionId) →
// finish.mutateAsync({ id: sessionId, exerciseOrder })). Grep for every
// `useFinishSession`/`finish.mutateAsync(` before merge; Implementer confirms
// workout/[sessionId].tsx is the only caller. Cache writes UNCHANGED:
// setQueryData(KEYS.active, null); invalidate ALL; setQueryData(detail, row);
// invalidate stats/progress — the returned row already carries the new column.
export function useFinishSession(): UseMutationResult<
  SessionRow, Error, { id: string; exerciseOrder?: string[] }
>;

// [v2] optimistic detail-cache rewrite. KEYS.detail(id) = ["sessions", id]
// holds a SINGLE SessionRow (NOT an array — unlike the routine-exercises
// precedent which caches a list; adapt the optimistic write accordingly).
export function useUpdateSessionExerciseOrder(): UseMutationResult<
  SessionRow, Error, { id: string; order: string[] }
>;
//   onMutate({ id, order }):
//     await qc.cancelQueries({ queryKey: KEYS.detail(id) });
//     const previous = qc.getQueryData<SessionRow>(KEYS.detail(id));
//     qc.setQueryData<SessionRow>(KEYS.detail(id), (old) =>
//       old ? { ...old, session_exercise_order: order } : old);
//     return { previous };
//   onError(_e,_v,ctx): if (ctx?.previous) qc.setQueryData(KEYS.detail(id), ctx.previous);
//   onSettled(_d,_e,{ id }): qc.invalidateQueries({ queryKey: KEYS.detail(id) });
//   (Do NOT invalidate KEYS.all/stats/progress — exercise order is not an input
//    to the list row, volume, or any stat. Narrow invalidation = no needless
//    refetch on each chevron tap. Matches useUpdateSetMeta's narrow-invalidate
//    rationale, use-sets.ts:83-103.)
```

### `app/(app)/history/[id].tsx` — local-order state machine [v2-new]

```
state: localOrder: string[] | null   // null = "follow the derived/persisted order"

SEED (the single source of truth for what the chevrons mutate):
  derivedOrder = orderedExercises.map(e => e.id)   // already persisted-aware (v1 read)
  effectiveOrder = localOrder ?? derivedOrder

RENDER:
  iterate effectiveOrder → look up ExerciseRow → render <ExerciseBlock> in that order
  (orderedExercises already returns rows; reuse byId map keyed off it)

CHEVRON TAP  moveExercise(exId, dir):
  base = localOrder ?? derivedOrder         // seed-on-first-move from the displayed order
  idx = base.indexOf(exId); target = dir==="up" ? idx-1 : idx+1
  if (target < 0 || target >= base.length) return
  next = swap(base, idx, target)
  setLocalOrder(next)                       // instant local reorder
  updateOrder.mutate({ id, order: next })   // persist (optimistic; per-tap)

isFirst / isLast: computed from the rendered index in effectiveOrder (idx===0 / idx===len-1)
  → exactly mirrors the live screen (workout/[sessionId].tsx:466-467).

RESET: none needed. localOrder is component state; navigating away unmounts the
  screen (matches isEditing's documented lifecycle, history/[id].tsx:69-72). On
  re-mount, derivedOrder reflects the just-persisted column, so localOrder=null
  re-seeds correctly. No "Done" reset required because we persist per-tap.
```

### v1 read change to `orderedExercises` (`history/[id].tsx:91-117`)

After building the discovered-exercise list (set-first-occurrence + `addedExerciseIds`), **stable-sort it by index in `session.data?.session_exercise_order ?? []`**: exercises present in the array sort by their array index (ascending); exercises absent from the array (legacy `NULL`, or an exercise added in History edit after the snapshot) keep their current first-occurrence relative order and append AFTER the ordered ones. `session` is already in scope (`:47, :76, :84`). This is the persisted-aware `derivedOrder` the state machine seeds from.

### DB columns / queries
- New column `public.sessions.session_exercise_order uuid[]` (nullable). Written by `finishSession` (Finish) and `updateSessionExerciseOrder` (reorder). Read via existing `getSession`/`useSession` `select("*")`. No change to `listSetsForSession` or any set query.

### UI props / state
- **[v2-new]** History edit-mode `<ExerciseBlock>` (`:327`) now receives `onMoveUp`, `onMoveDown`, `isFirst`, `isLast` (props already exist on the component — no component change). Read-only block receives none (no chevron, by construction).
- **[v2-new]** History local state `localOrder: string[] | null`.
- Live screen `orderedExercises` and `exerciseOrderOverride` UNCHANGED (we only *read* `orderedExercises` at Finish; we do not persist the override field itself).

## Persist-timing decision

**Decision: persist on EACH chevron tap** (optimistic), not on a debounce and not on "Done"/exit-edit.

Rationale:
- **Simplest correct model + matches "saved immediately".** Each tap is a complete, valid new order. Writing it straight away means there is no "unsaved edit" state to reconcile, no flush-on-exit edge case (e.g. the user backgrounds the app or force-quits before tapping Done), and no risk of losing the reorder if the screen unmounts. The owner's intent ("so I can reorder older sessions" + "PERSIST the reordering") reads as "it's saved when I move it", consistent with how `useUpdateSessionName`/`useUpdateSessionTimes` already auto-commit on this screen (no explicit save button for those either).
- **Write frequency is acceptable.** A reorder is a low-frequency, deliberate human action (a handful of taps to sequence a short exercise list), not a high-rate stream. Each tap is one small `UPDATE sessions SET session_exercise_order = $1 WHERE id = $2` on a single PK row — cheap. The optimistic `onMutate` makes the UI flip instantly regardless of round-trip latency (same pattern proven for the live-screen reorder and `useReorderRoutineExercises`). Even rapid up/up/up taps produce a few independent single-row writes; the last-write-wins on the column and the optimistic cache keeps them coherent. This is materially cheaper than the routine reorder, which costs `2N` sequential PATCHes (`use-routine-exercises.ts:56-57`); here it is ONE PATCH per tap because the whole order lives in one array column.
- **Debounce rejected:** adds a timer + flush-on-unmount complexity for no real benefit at this write volume, and reintroduces the "lost on force-quit" window. **On-Done rejected:** requires a dirty-flag + flush in the "Done" handler (`:200-215`) AND a flush on `router.back`/unmount (the screen can be left without tapping Done), i.e. strictly more edge cases than per-tap for no gain.

Concurrency note: each tap reads `localOrder ?? derivedOrder` as its base, so taps are sequenced through local state; the persisted writes are idempotent full-array overwrites. No read-modify-write race on the server (each write sends the complete intended array, not a delta).

## Legacy-session recovery flow

A "legacy" session is any finished session whose `session_exercise_order` is `NULL` (every session that existed before the migration; none get backfilled).

- **Read (no reorder):** History shows the legacy session via the deterministic first-occurrence fallback (`orderedExercises` v1 change). This is the SAME order it shows today — legacy sessions do **not** start reshuffling; they simply can't match a live order that was never persisted.
- **First reorder (the recovery):** when the user enters edit mode and taps a chevron on a legacy session, `moveExercise` seeds its base from `derivedOrder` = the **full current displayed (fallback) order**, applies the swap, and persists the **entire array** via `updateSessionExerciseOrder`. So the very first reorder writes the complete current order (with the user's move applied) into the column. The column is `NULL` → a real `uuid[]` in one write.
- **After that:** the session is a normally-persisted session. Subsequent reads order by the column; subsequent reorders mutate/persist it. Confirmed: this is exactly how a legacy session "gets fixed" — the manual recovery path the owner asked for. No special-casing in the code beyond `localOrder ?? derivedOrder` seeding, which already handles `NULL` because `derivedOrder` is the fallback order when the column is `NULL`.

## Interaction with edit-mode add / remove

History edit mode today can **add** exercises (`addedExerciseIds`, `history/[id].tsx:67, 106-114, 414-419`). It does **NOT** currently have a remove control — the edit-mode `<ExerciseBlock>` (`:327-369`) passes no `onRemove`, and `useRemoveExerciseFromSession` is imported only by the live screen, not by History. (The state.md prompt referenced remove-in-History; verified against code — it is not wired here. We do not add it.)

- **Added exercises are reorderable.** An added exercise appears in `orderedExercises` (appended via `addedExerciseIds`), therefore in `derivedOrder`, therefore in `effectiveOrder` and the rendered list — so its chevrons work like any other. Caveat: an added exercise with **no sets logged yet** is in the in-memory list but is NOT yet in the persisted set rows. If the user reorders before logging a set, `updateSessionExerciseOrder` persists that exercise's id into `session_exercise_order` even though it has zero sets. On reload, `orderedExercises` discovers exercises from set rows + `addedExerciseIds` (which resets on unmount); an id in the column with no surviving sets is simply **ignored at read** (the read maps column ids → discovered exercises and drops unmatched ids). So a persisted id for a never-logged added exercise is harmless dead weight, not a render bug. Acceptable; flagged for the Regression Tester.
- **Removal (future).** If a remove control is ever added to History, a removed exercise should drop out of the persisted array on the next reorder persist (since `derivedOrder` would no longer contain it). The read-side already tolerates stale ids (ignored when unmatched), so even without an explicit prune, a removed exercise won't render. No action this run — remove is out of scope and not present.

We deliberately do NOT re-snapshot on every add. Adding an exercise updates the in-memory list; it only lands in the column if the user then reorders (or it was already there from Finish). This keeps the write surface to the explicit reorder action.

## Riscos

- **Regressões em fluxos adjacentes:**
  - `listSetsForSession` consumers (`history/[id]`, `workout/[sessionId]`, `workout/verdict/[sessionId]` — `diagnosis.md:100`) are **untouched** — we do not change the set query. Live screen order unchanged. Verdict order-independent, unaffected.
  - **`<ExerciseBlock>` is shared** between the live screen and History edit mode. We pass `onMoveUp`/`onMoveDown`/`isFirst`/`isLast` to it from History now too — but these props already exist and already drive the chevrons on the live screen, so there is no component change and no live-screen behavior change. Verify the History edit-mode block still renders set-editing controls identically (we only ADD reorder props; we don't remove any existing prop).
  - History `addedExerciseIds` interaction: an added-but-unlogged exercise can get its id persisted into the column on reorder; harmless (ignored at read when unmatched). Flagged above + for the Regression Tester.
  - `seedSetsForSession` idempotency (`routine-exercise-sets.ts:261-275`, natural key `(exercise_id, set_number)`) **untouched** — no column added to `sets`.
- **Data integrity:**
  - **Migration on the shared live Supabase project** (`ykrbgpctbfvndxjnpzrg`) — the principal risk. **Additive and reversible**: one nullable `ADD COLUMN`, no backfill, no data rewrite, no constraint that can fail against existing rows. Rollback = `DROP COLUMN`. Postgres adds a nullable column without a table rewrite (metadata-only, brief `ACCESS EXCLUSIVE`). **Applied by the OWNER via `npm run db:push`**, not by the Implementer/agent.
  - RLS: **no new surface.** The column lives on `sessions`, already protected by per-user policies (`auth.uid() = user_id`) for both SELECT and UPDATE — so the new reorder UPDATE path is already access-controlled. The Regression Tester should confirm a user cannot read OR write another user's `session_exercise_order`, but no new policy is introduced. (Carries `diagnosis.md:113-115` `security_relevant: no` forward — re-assessed below.)
  - The column stores `exercise_id`s that may later be soft-deleted or never logged; the read maps array entries to discovered exercises and ignores unmatched ids. No FK on the array, so a stale/deleted id can't break the read.
  - **No read-modify-write race on reorder:** each persist sends the full intended array (overwrite), not a delta; last-write-wins is coherent because local state sequences the taps.
- **Platform-specific:** none expected. Bug + fix are backend-query/data-derived (`diagnosis.md:43-45`); the column round-trips identically on web and native via `supabase-js`. The chevron control is the same `<ExerciseBlock>` UI that already ships on both platforms on the live screen. The one platform-adjacent unknown is `uuid[]` ↔ `string[]` serialization (Implementer TODO above), which is platform-independent (same JS client).
- **Performance:** negligible. Finish write folded into the existing single `finishSession` UPDATE (no extra round-trip). Reorder write = one single-row PK `UPDATE` per chevron tap, optimistic UI hides latency. Reads: array already fetched by `select("*")` on `getSession` — no new query. History sort is O(n log n) over a handful of exercises. No index needed.

## Alternativas descartadas

1. **(a) Add a deterministic secondary `.order` key (`created_at`/`id`) to `listSetsForSession`** — descartada: only makes the tie *stable*, not *correct*; the interleaved seed (`routine-exercise-sets.ts:242`) means insertion order ≠ routine order (routine sessions render "stably wrong"), and manual reorder is never captured (`diagnosis.md:75, 81`). Also risks the documented within-exercise set-order regression if mis-specified. Fails the repro's "Expected".
2. **(b) Make History order by routine `position` (consult `useRoutineExercises`)** — descartada: ad-hoc sessions (`routine_id = null`) have no position source and fall back to the broken tie; manual reorder ignored (`diagnosis.md:76, 82`). Fixes only the primary trigger, leaves two of three shapes broken, couples History to routine data. Partial.
3. **(c-alt) Junction table `session_exercise_order(session_id, exercise_id, position)`** — descartada: heavier than warranted — a new table needs RLS policies, a `touch_updated_at` trigger, a partial-unique index, a new API module, and a join read in History — to store one ordered list that is conceptually one field on the session. The `uuid[]` column captures the same fact with one additive column and zero new RLS surface.
4. **(c-alt) `exercise_order int` column on `sets`** — descartada: no per-(session,exercise) row; the value would be denormalized across every set of an exercise (N copies → update anomalies), the write would touch every set row, and it would force the seed insert payload + idempotency re-keying to populate it (`diagnosis.md:105`). The order is session-level, not set-level.
5. **(persist live override each reorder, mid-session)** — descartada: higher write-frequency and out of the bug's scope; the at-Finish snapshot captures the same final order in one write. (The "while I'm here" temptation — rejected.)
6. **(v2 persist-timing: on-Done / debounce)** — descartada: see "Persist-timing decision". On-Done needs a dirty-flag + dual flush (Done handler AND unmount/back) and risks losing the reorder if the screen is left without tapping Done; debounce adds a timer + flush-on-unmount for no benefit at this write volume. Per-tap is simpler and strictly fewer edge cases.
7. **(v2 reorder UI: drag-and-drop / new control)** — descartada: `<ExerciseBlock>` already has chevron props the live screen uses; reusing them is zero new UI and matches the existing reorder idiom. Drag-and-drop would need a new gesture library surface — scope creep for a bug-fix + small feature.

## Out of scope (follow-up)

- **Stale comments in `src/utils/volume-target.ts:183, 258`** ("orders by completion timestamp" — now `set_number`). Minor (`diagnosis.md:30, 96`), not tied to this root cause (kernels order-independent). Doc-only follow-up.
- **Live mid-session reorder persistence** — still snapshot-only at Finish; persisting `exerciseOrderOverride` on each mid-session reorder is a separate enhancement.
- **Reorder in the read-only (non-edit) History view** — chevrons appear ONLY in edit mode, by design.
- **Drag-and-drop reorder** — chevron up/down only.
- **Remove-exercise control in History edit mode** — not present today; not added here. If added later, it should prune the persisted array on next reorder persist (read already tolerates stale ids).
- **Auto-backfilling historical sessions to "what the user saw"** — impossible (never recorded). Legacy sessions get the deterministic fallback until the user manually reorders them (the recovery path).
- **Pruning never-logged added-exercise ids from the column** — a persisted id with no surviving sets is ignored at read (harmless); explicit pruning is a follow-up if it ever matters.

## Backfill / fallback for historical sessions [v1-carryover, unchanged]

- **No backfill.** Existing finished sessions never recorded the displayed order; they keep `session_exercise_order = NULL`.
- **Deterministic fallback at read.** When `session_exercise_order` is `NULL` or missing an exercise, History orders the affected exercises by **first-occurrence in `listSetsForSession`** (today's behavior). Same order they show today → legacy sessions do not start reshuffling. If the Regression Tester observes run-to-run instability on legacy sessions, the Implementer may add a `created_at`/`id` secondary key **scoped to the fallback path only** (NOT to `listSetsForSession`'s primary sort) — `TODO: Implementer to verify` whether the current first-occurrence order is already run-to-run stable for legacy rows before adding any key.
- **Hard constraint preserved:** `set_number` remains the PRIMARY within-exercise sort. The new order governs the EXERCISE sequence only, layered above per-exercise set order. `setsByExercise` (`history/[id].tsx:119-127`) untouched.

## Regression test plan (preview — Regression Tester will execute)

- **Static gates:** `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npx expo export --platform web`.
- **Migration applied** to a test/preview DB first (NOT straight to prod): confirm `ADD COLUMN` succeeds, existing rows read `NULL`, `getSession` still returns valid `SessionRow`s. (Live application is the OWNER's `db:push`.)
- **Replay original reproduction** (`repro.md` Step A / B) — e2e harness can seed + finish a multi-exercise session (`tests/e2e/read-only-history.spec.ts:38-155` pattern):
  - **Routine session** (interleaved seed): finish → assert History order == live order.
  - **Ad-hoc session** (log B's first set before A): finish → assert History == live.
  - **Manually-reordered live session** (live-screen chevrons / `moveExercise`): finish → assert History == the reordered order.
- **NEW — History edit-mode reorder [v2]:**
  - Open a finished **routine** session in History → tap Pencil (edit) → chevrons appear on each `<ExerciseBlock>`; first block's up is disabled, last block's down is disabled. Move an exercise up → it persists. Exit edit, navigate away, reopen → the new order is shown (read from column).
  - Same for an **ad-hoc** session.
  - **Legacy session (column `NULL`):** reorder once → assert the column went from `NULL` to a full `uuid[]` of the displayed order with the move applied; reopen → new order persists. (The recovery path.)
  - **Set order WITHIN each exercise unchanged** after a reorder (still `set_number` ASC; the `sets.ts:49-53` UX fix stays — checked sets don't bubble above unchecked).
  - **Non-edit (read-only) History view has NO chevrons.**
  - Rapid multi-tap (up/up/up) on one exercise → final persisted order matches the displayed order, no cache desync (optimistic + per-tap last-write-wins).
  - Reorder an exercise that was **added in edit mode** (via the picker) before logging a set → no crash; on reopen, an unlogged-and-removed-from-`addedExerciseIds` id is ignored at read.
- **Adjacent regression checks:**
  - Verdict screen PR list unchanged (order-independent).
  - Volume / e1RM / per-muscle / progress charts unchanged (order-independent, `diagnosis.md:104`).
  - **Legacy session (NULL order) does not reshuffle** between two consecutive History opens (no reorder performed).
  - Edit-mode add-exercise still appends after snapshotted ones, no crash.
  - Zero-set Finish path (`onFinish` `uncheckedCount === 0`, `:352-362`) and discard/check-all Finish paths all finish without error (snapshot from surviving list, possibly empty `[]` → column omitted/empty, no clobber).
  - **RLS:** a second user cannot read OR write the first user's `session_exercise_order` (the reorder UPDATE is a new write path — confirm it is RLS-blocked cross-user).
- **Manual verification needed?** Yes — owner does Step B (manual UI repro) on web (and ideally one native run): (1) routine session History matches live order; (2) reorder a session in History edit, reopen, confirm it sticks; (3) reorder a pre-migration legacy session and confirm it recovers a stable order.

## Confidence / Risk

- **Confiança: ALTA** — the root cause is HIGH-confidence and verified at file:line; the persistence direction (snapshot-at-Finish) is the only one the diagnosis shows can match the user's order for all three session shapes; the v2 reorder reuses the EXISTING `<ExerciseBlock>` chevron props (verified present, `exercise-block.tsx:24-25, 204-227`) and the EXISTING optimistic-mutation pattern (`use-routine-exercises.ts:50-80`), so it adds no novel UI or cache mechanism. Every write/read site is identified in code. Residual gaps (do not change the design): the `uuid[]` PostgREST/Drizzle round-trip (flagged with a `jsonb` fallback) and run-to-run stability of the legacy fallback order (flagged with a fallback-only secondary key). The single detail correcting the prompt: History has no remove control today — addressed, not assumed.
- **Risco: MÉDIO** — driven by the **migration on the shared live Supabase project** (additive, nullable, no-backfill, reversible `DROP COLUMN`, no new RLS — capped severity, but any schema change on a shared prod backend is MEDIUM per the CLAUDE.md calibration; owner-applied via `db:push`). v2 adds a real (non-Finish) WRITE path to the column — more code than v1 — but it reuses an audited optimistic pattern, touches no auth/credential/untrusted-input surface, and the write is the user's own RLS-scoped session. Code-side risk LOW; the migration keeps the overall risk at MEDIUM.

### Security relevance carry-forward
`security_relevant: no` carried forward from `diagnosis.md:113-115` and re-assessed for v2. v2 introduces a new WRITE path (`updateSessionExerciseOrder`) — re-checked against the upgrade triggers: no new endpoint (PostgREST table UPDATE through existing client), no auth-path change, no credential handling, no untrusted-input acceptance (the array is `exercise_id`s the user already owns; the write is RLS-scoped to `auth.uid() = user_id` on `sessions`, covering UPDATE as well as SELECT). No upgrade warranted. The Regression Tester's RLS check (cross-user read AND write of `session_exercise_order`) remains the gate.

## Awaiting

Human RE-approval before Implement phase (v2 supersedes v1 at the gate).
