---
run-id: 2026-06-01_0941_session-finish-exercise-order
security_relevant: no
---

# Fix plan — 2026-06-01_0941_session-finish-exercise-order

## Scope

**Includes (blocker + major from `diagnosis.md`):**
- BLOCKER — History detail (`app/(app)/history/[id].tsx:91-117`) reorders exercises vs the live screen. Fixed by making History consume a **persisted, session-scoped exercise order** instead of deriving order from the tie-broken set query.
- BLOCKER — `listSetsForSession` (`src/api/sets.ts:43-56`) `set_number`-only sort with no secondary key is the proximate tie-break. We do **not** change this query's sort (it must keep `set_number` primary — hard constraint, see Risks). Instead we layer a persisted exercise order **above** it, so the unspecified tie-break no longer decides cross-exercise sequence.
- MAJOR — non-persistence of the authoritative live order (`workout/[sessionId].tsx:124-131, 281-290`: `exerciseOrderOverride` / `adHocExerciseIds`, client-only). Fixed by **snapshotting the live `orderedExercises` sequence to the DB at Finish** — the only moment all four order inputs (routine position, set-first-occurrence, ad-hoc, manual reorder) are resolved into one in-memory list.
- MAJOR — interleaved seed insertion (`routine-exercise-sets.ts:233-243, 288-351`) is why a `created_at`/`id` tie-break can NOT recover routine order. This major is **addressed by avoidance**: the snapshot captures the routine-position order the live screen already shows, so the seed's insertion order becomes irrelevant to display. No change to `seedSetsForSession`.

**Explicitly does NOT include:** persisting live drag-reorder mid-session (we snapshot only at Finish), a reorder UI in History, changing within-exercise set order, changing `listSetsForSession`'s sort, the stale comments in `volume-target.ts` (minor — see Out of scope), or any verdict-screen change. See "Out of scope".

## Approach

Chosen direction: **(c) persist a per-session exercise order**, sub-variant **(c2) "snapshot at Finish"**, stored as a **`session_exercise_order uuid[]` column on `sessions`** (an ordered array of `exercise_id`s).

Why (c) and not (a)/(b): the diagnosis establishes as fact that three of the live order's four inputs (set-first-occurrence ordering, ad-hoc additions, manual reorder) are never persisted (`diagnosis.md:58-67`). Directions (a) "deterministic secondary `.order` key" and (b) "History orders by routine `position`" both reconstruct order from data that **cannot discriminate the order the user actually saw** for ad-hoc or manually-reordered sessions — the same class of mistake flagged in the prior Fix Designer feedback (proposing a mechanism whose source can't represent the must-match case). (a) converts "unstable" to "stably wrong"; (b) fixes only routine sessions and re-ties for ad-hoc. Only (c) satisfies the repro's "Expected" (History == live order) for all three session shapes (routine / ad-hoc / manual reorder). The snapshot is taken at Finish because that is the single moment the live screen has all four inputs already resolved into `orderedExercises` (`workout/[sessionId].tsx:215-279`) — no need to sync on every reorder.

Why `uuid[]` on `sessions` and not a new junction table or a column on `sets` (sub-variant trade-off): the order is a **session-level** fact (one ordered list per session), so it has a natural home on the `sessions` row. A `uuid[]` column is the minimal footprint that fully fixes the bug: one column, zero new RLS surface (inherits `sessions`' existing per-user policies), one write at Finish, one read in History. A junction table `session_exercise_order(session_id, exercise_id, position)` is the normalized alternative but adds a whole table + 4 RLS policies + a trigger + a new API module + a join read — heavier than a bug fix warrants. A column on `sets` (`exercise_order int`) is rejected: there is no per-(session,exercise) row to hold it (only the `sets` table), so the value would be **denormalized across every set of an exercise** (N copies), creating an update-anomaly surface and forcing the write to touch every set row. (See Alternatives.)

Read/write symmetry:
- **Write** (snapshot): in the live screen's Finish path, after the discard/check mutation settles and within `finish.mutateAsync`, compute `orderedExercises.map(e => e.id)` and persist it as `session_exercise_order`. The order is computed from the SURVIVING (post-discard) list to match what History will render (`diagnosis.md:106`).
- **Read** (History): `history/[id].tsx` `orderedExercises` sorts the exercises it discovers (set-first-occurrence + edit-added) by their index in `session.data.session_exercise_order`; any exercise not present in the array (legacy session, or an exercise added in History edit mode after Finish) falls back to a **deterministic** secondary order appended after the snapshot.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `supabase/migrations/0016_session_exercise_order.sql` | new | Add nullable `session_exercise_order uuid[]` column to `public.sessions`. No backfill (legacy sessions stay `NULL` → deterministic fallback at read). No new RLS (column inherits the existing `sessions` row policies). DDL sketch below. |
| `src/db/schema.ts` | edited | Add `sessionExerciseOrder: uuid("session_exercise_order").array()` (nullable) to the `sessions` pgTable, next to the existing columns (`:120-140`). One responsibility: keep Drizzle schema in sync with the migration. |
| `src/db/types.ts` | edited | Add `session_exercise_order: string[] \| null` to `SessionRow` (`:196-208`). One responsibility: the PostgREST row shape History reads. |
| `src/api/sessions.ts` | edited | Add a write path for the snapshot. Preferred: extend `finishSession(id, exerciseOrder?: string[])` to write `session_exercise_order` in the SAME `update({ ended_at, session_exercise_order })` as `ended_at` (one round-trip, atomic with finish). `exerciseOrder` optional/omittable so the zero-set Finish path and any other caller stay valid. One responsibility: persist the snapshot atomically with finish. |
| `src/hooks/use-sessions.ts` | edited | Update `useFinishSession` (`:99-111`) mutation input from `id: string` to `{ id: string; exerciseOrder?: string[] }`, forwarding to `finishSession`. Keep all existing cache writes/invalidations unchanged (`setQueryData(detail)` already lands the updated row carrying the new column). One responsibility: thread the snapshot through the existing mutation. |
| `app/(app)/workout/[sessionId].tsx` | edited | In `finishAfterMutation` (`:336-344`) pass `exerciseOrder: orderedExercises.map(e => e.id)` to `finish.mutateAsync`. It is computed AFTER `bulkCheckAll`/`bulkDiscardUnchecked` settle (those paths call `finishAfterMutation` last — `:368-378, 406-416`), but note `orderedExercises` is in-memory and the closure already excludes `removedExerciseIds`; the snapshot reflects the displayed surviving list. One responsibility: capture the displayed order at Finish. |
| `app/(app)/history/[id].tsx` | edited | In `orderedExercises` (`:91-117`), after building the discovered-exercise list, stable-sort it by index in `session.data?.session_exercise_order ?? []`; exercises absent from the array keep their current first-occurrence relative order and are appended after the ordered ones (deterministic fallback). `session` is already available in this component (used at `:84` and `:143`). One responsibility: honor the persisted order, fall back deterministically. |

### Migration DDL sketch (`0016_session_exercise_order.sql`)

```sql
-- =============================================================================
-- 0016_session_exercise_order.sql
-- Hand-written. Persist the per-session EXERCISE display order, snapshotted
-- from the live workout screen when the user taps Finish. Fixes History
-- reordering exercises vs the order shown during the live workout.
--
-- Storage: an ordered uuid[] of exercise_id on the sessions row. Nullable;
-- legacy/in-progress sessions stay NULL and the read-side falls back to a
-- deterministic order. No new RLS — inherits the existing sessions policies
-- (already gated on auth.uid() = user_id).
-- =============================================================================

alter table public.sessions
  add column session_exercise_order uuid[];

-- Intentionally NO backfill: historical finished sessions never recorded the
-- order the user saw, so we cannot recover it. They keep NULL and render via
-- the deterministic read-side fallback (stops them reshuffling run-to-run
-- WITHOUT claiming a fidelity we don't have). See fix-plan "Backfill".
```

No `NOT NULL`, no default, no index (the array is read only on the single-session detail screen, already fetched by PK). RLS unchanged. A `touch_updated_at` trigger on `sessions` (if present) is unaffected — adding a column does not require touching the trigger.

**TODO: Implementer to verify** — confirm PostgREST returns a `uuid[]` column as a JS `string[]` (expected for the `supabase-js` client) and that the `.update({ session_exercise_order: [...] })` payload serializes the array correctly. If the array round-trip is awkward via PostgREST, the Implementer may fall back to a `jsonb` column (`string[]` JSON) and must document the deviation in `implementation.md`. Drizzle's `.array()` on a `uuid` column is the expected mapping; verify against the installed drizzle-orm version (project is on 0.38 per `schema.ts:108`) before relying on it for the generated SQL.

## Contratos de I/O

- **Function signatures / types added or changed:**
  - `finishSession(id: string, exerciseOrder?: string[]): Promise<SessionRow>` — second param added, optional (back-compatible).
  - `useFinishSession()` mutation input: `string` → `{ id: string; exerciseOrder?: string[] }`. **Caller change required** in `workout/[sessionId].tsx` (`finish.mutateAsync(sessionId)` → `finish.mutateAsync({ id: sessionId, exerciseOrder })`). Grep for other `finish.mutateAsync(` / `useFinishSession` callers before merge — Implementer to confirm `workout/[sessionId].tsx` is the only one.
  - `SessionRow` gains `session_exercise_order: string[] | null`.
  - Drizzle `sessions` gains `sessionExerciseOrder` (`uuid[]`, nullable).
- **DB columns / queries:**
  - New column `public.sessions.session_exercise_order uuid[]` (nullable). Written in the existing `finishSession` UPDATE; read via the existing `getSession`/`useSession` `select("*")`.
  - No change to `listSetsForSession` or any set query.
- **UI props / state:**
  - None new. History's `orderedExercises` is re-derived from existing `session.data` — no new prop passed to the read-only exercise block (it still receives an ordered list). Live screen `orderedExercises` unchanged; `exerciseOrderOverride` stays client-only (we read it indirectly via `orderedExercises` at Finish, we do not persist the override field itself).

## Riscos

- **Regressões em fluxos adjacentes:**
  - `listSetsForSession` consumers (`history/[id]`, `workout/[sessionId]`, `workout/verdict/[sessionId]` — `diagnosis.md:100`) are **untouched** because we do not change the set query. Live screen order: unchanged (it still builds `orderedExercises` its own way; we only *read* that array at Finish). Verdict: order-independent, unaffected.
  - History edit mode (`history/[id].tsx:326-368`) can `logSet` new sets / add exercises (`addedExerciseIds`) to a finished session AFTER the snapshot. Those exercises won't be in `session_exercise_order` → they hit the deterministic fallback and append after the snapshotted ones. Acceptable (matches today's "appended" semantics at `:106-114`); flagged for the Regression Tester. We deliberately do NOT re-snapshot on History edits (out of scope) — re-snapshotting would need a reorder UI that doesn't exist.
  - `seedSetsForSession` idempotency (`routine-exercise-sets.ts:261-275`, natural key `(exercise_id, set_number)`) is **untouched** — we add no column to `sets`, so the seed insert payload and re-keying are unaffected. This is a direct reason for choosing `sessions` over a `sets` column.
- **Data integrity:**
  - **Migration on the shared live Supabase project** (`ykrbgpctbfvndxjnpzrg`) — this is the real risk. It is **additive and reversible** (a single nullable `ADD COLUMN`, no backfill, no data rewrite, no constraint that can fail against existing rows). Rollback = `DROP COLUMN`. Postgres adds a nullable column without a table rewrite (metadata-only, brief `ACCESS EXCLUSIVE`). Must be applied via the project's migration mechanism, not ad-hoc.
  - RLS: **no new surface.** The column lives on `sessions`, already protected by per-user policies (`auth.uid() = user_id`). The Regression Tester should still confirm a user cannot read/write another user's `session_exercise_order` — but no new policy is introduced, so the existing `sessions` posture covers it (consistent with `diagnosis.md:113-115` carry-forward).
  - The snapshot stores `exercise_id`s that may later be soft-deleted; the read-side maps array entries to discovered exercises and simply ignores ids with no surviving sets — no FK on the array, so a deleted exercise can't break the read.
- **Platform-specific:** none expected. The bug and the fix are entirely backend-query/data-derived (`diagnosis.md:43-45`); the column round-trips identically on web and native via `supabase-js`. The one platform-adjacent unknown is the `uuid[]` ↔ `string[]` serialization (flagged as Implementer TODO above), which is platform-independent (same JS client). No iOS/Android/web divergence in render logic — both screens consume the same array.
- **Performance:** negligible. Write: folded into the existing single `finishSession` UPDATE (no extra round-trip). Read: the array is already fetched by `select("*")` on the single-session `getSession` — no new query. History sort is O(n log n) over a handful of exercises. No index needed (single-row PK fetch).

## Alternativas descartadas

1. **(a) Add a deterministic secondary `.order` key (`created_at`/`id`) to `listSetsForSession`** — descartada porque it only makes the tie *stable*, not *correct*: the interleaved seed (`routine-exercise-sets.ts:242`) means insertion order ≠ routine order, so routine sessions render "stably wrong", and manual reorder is never captured (`diagnosis.md:75, 81`). It also risks the documented within-exercise set-order regression if mis-specified. Fails the repro's "Expected".
2. **(b) Make History order by routine `position` (consult `useRoutineExercises`)** — descartada porque ad-hoc sessions (`routine_id = null`) have no position source and fall back to today's broken tie; manual reorder is ignored (`diagnosis.md:76, 82`). Fixes only the primary trigger, leaves two of three shapes broken, and couples History to routine data. Partial, not a root-cause fix.
3. **(c2-alt) New junction table `session_exercise_order(session_id, exercise_id, position)`** — descartada porque it is heavier than a bug fix warrants: a new table needs 4 RLS policies, a `touch_updated_at` trigger, a partial-unique index, a new API module, and a join read in History — all to store an ordered list that is conceptually one field on the session. The `uuid[]` column captures the same fact with one additive column and zero new RLS surface.
4. **(c2-alt) New `exercise_order int` column on `sets`** — descartada porque there is no per-(session,exercise) row; the value would be denormalized across every set of an exercise (N copies → update anomalies), the write would have to touch every set row, and it would force the seed insert payload + idempotency re-keying to populate it (`diagnosis.md:105`), enlarging the regression surface. The order is session-level, not set-level.
5. **(c-alt) Persist `exerciseOrderOverride` live on every reorder** — descartada porque it is higher write-frequency and out of the bug's scope; the at-Finish snapshot captures the same final order with one write. (Explicitly the "while I'm here" temptation — rejected.)

## Out of scope (follow-up)

- **Stale comments in `src/utils/volume-target.ts:183, 258`** claiming `listSetsForSession` "orders by completion timestamp" (minor in `diagnosis.md:30, 96`). Not tied to this root cause (kernels are order-independent); a doc-only follow-up. Listed so it's not lost.
- **Live mid-session reorder persistence** — we snapshot only at Finish. Persisting `exerciseOrderOverride` on each reorder (so a mid-session reload keeps the order) is a separate enhancement.
- **Reorder UI in History** — letting the user re-sequence exercises on a finished session (and re-snapshot) is a feature, not a fix.
- **Backfilling historical sessions to "what the user saw"** — impossible (never recorded); legacy sessions get the deterministic fallback only.
- **Re-snapshotting when History edit adds an exercise** — the added exercise appends via the fallback; promoting it into the persisted array is a follow-up if it ever matters.

## Backfill / fallback for historical sessions

- **No backfill.** Existing finished sessions never recorded the displayed order, so it cannot be recovered. They keep `session_exercise_order = NULL`.
- **Deterministic fallback at read.** When `session_exercise_order` is `NULL` or missing an exercise, History orders the affected exercises by their **first-occurrence in `listSetsForSession`** (today's behavior). This is the SAME order they show today, so legacy sessions do **not** start reshuffling — they simply stop being able to match a live order they never persisted. The fallback is deterministic given a stable set-row order; if the Regression Tester observes run-to-run instability on legacy sessions, the Implementer may add a `created_at`/`id` secondary key **scoped to the fallback path only** (not to `listSetsForSession`'s primary sort) — `TODO: Implementer to verify` whether the current first-occurrence order is already run-to-run stable for legacy rows before adding any secondary key.
- **Hard constraint preserved:** `set_number` remains the PRIMARY within-exercise sort. The new order is for the EXERCISE sequence only, layered above the per-exercise set order. We do not touch `setsByExercise` (`history/[id].tsx:119-127`).

## Regression test plan (preview — Regression Tester will execute)

- **Static gates:** `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npx expo export --platform web`.
- **Migration applied** to a test/preview database first (NOT straight to prod): confirm `ADD COLUMN` succeeds, existing rows read `NULL`, and `getSession` still returns valid `SessionRow`s.
- **Replay original reproduction** (`repro.md` Step A / B) — the e2e harness can seed + finish a multi-exercise session (`tests/e2e/read-only-history.spec.ts:38-155` pattern):
  - **Routine session** (interleaved seed): finish, then assert History order == live order.
  - **Ad-hoc session** (log B's first set before A): finish, assert History == live.
  - **Manually-reordered session** (use the chevrons / `moveExercise`): finish, assert History == the reordered order.
- **Adjacent regression checks:**
  - Set order WITHIN each exercise unchanged (still `set_number` ASC; the `sets.ts:49-53` UX bug stays fixed — checked sets don't bubble above unchecked).
  - Verdict screen PR list unchanged (order-independent).
  - Volume / e1RM / per-muscle / progress charts unchanged (order-independent, `diagnosis.md:104`).
  - **Legacy session (NULL order) does not reshuffle** between two consecutive History opens.
  - History edit mode: add an exercise to a finished session → it appears appended after the snapshotted ones, no crash.
  - Zero-set Finish path (`onFinish` `uncheckedCount === 0`, `:352-362`) and the discard/check-all Finish paths all still finish without error (snapshot from the surviving list, possibly empty `[]`).
  - RLS: a second user cannot read/write the first user's `session_exercise_order`.
- **Manual verification needed?** Yes — owner does Step B (manual UI repro) on web (and ideally one native run) to visually confirm History matches the live order for a routine session, since the Reproducer captured data evidence, not pixels (`repro.md:68-70`).

## Confidence / Risk

- **Confiança: ALTA** — the root cause is HIGH-confidence and verified at file:line; the chosen direction (c2 snapshot at Finish) is the only one the diagnosis shows can match the user's order for all three session shapes, and every write/read site is identified in code (`finishSession`/`useFinishSession`/`finishAfterMutation` write; `history/[id].tsx orderedExercises` read). The one residual gap is the `uuid[]` PostgREST/Drizzle round-trip, flagged as an Implementer TODO with a `jsonb` fallback — it does not change the design, only the column type.
- **Risco: MÉDIO** — driven entirely by the **migration on the shared live Supabase project**. The change is additive, nullable, no-backfill, reversible (`DROP COLUMN`), and adds no RLS surface, which caps the severity; but any schema change on a shared prod backend is MEDIUM by the CLAUDE.md calibration. Code-side risk is LOW (additive optional param, one new read sort, no change to the hot set query). Apply the migration to a preview DB first.

## Awaiting

Human approval before Implement phase.
