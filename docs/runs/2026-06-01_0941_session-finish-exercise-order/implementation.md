# Implementation — 2026-06-01_0941_session-finish-exercise-order

Based on: `fix-plan-v2.md` (approved by owner 2026-06-01 10:38 BRT). Baseline commit: `5985c576af32081f84b41b2169cfef8d537a913d`.

v2 = persisted `session_exercise_order` column + snapshot-at-Finish (v1 core) PLUS the History edit-mode up/down reorder control that persists to the same column.

## Files changed
- `supabase/migrations/0019_session_exercise_order.sql` (new) — adds nullable `session_exercise_order uuid[]` to `public.sessions`. No backfill, no new RLS. **DDL is exactly the fix-plan's; only the migration NUMBER changed from `0016` to `0019` (see Deviation 1).** Written but NOT applied — the Conductor applies it to the live DB.
- `src/db/schema.ts` (edited) — added `sessionExerciseOrder: uuid("session_exercise_order").array()` (nullable) to the `sessions` pgTable. Keeps Drizzle in sync with the migration (typecheck-only; the SQL is hand-written/owner-applied, not `db:generate`d).
- `src/db/types.ts` (edited) — added `session_exercise_order: string[] | null` to `SessionRow` (the PostgREST row shape History reads).
- `src/api/sessions.ts` (edited) — (v1) `finishSession(id, exerciseOrder?)` now writes `session_exercise_order` in the SAME `update()` when an order is supplied, and OMITS the key when not (zero-exercise Finish leaves the column untouched). (v2) NEW `updateSessionExerciseOrder(id, order)` — standalone `update({ session_exercise_order })`, mirrors `updateSessionName`/`updateSessionTimes`.
- `src/hooks/use-sessions.ts` (edited) — (v1) `useFinishSession` mutation input `string` → `{ id; exerciseOrder? }`, forwards to `finishSession`; cache writes/invalidations unchanged. (v2) NEW `useUpdateSessionExerciseOrder` — optimistic `onMutate` patch of the `["sessions", id]` detail cache (single `SessionRow`, not a list), `onError` rollback, `onSettled` narrow-invalidate of the detail key only.
- `app/(app)/workout/[sessionId].tsx` (edited) — `finishAfterMutation` passes `exerciseOrder` (the surviving displayed order) to `finish.mutateAsync({ id, exerciseOrder })`. Order is read from a ref kept in sync with `orderedExercises` (see Deviation 2).
- `app/(app)/history/[id].tsx` (edited) — (v1 read) `orderedExercises` now orders the discovered list by the persisted `session_exercise_order` via the pure helper, with first-occurrence fallback. (v2) added `localOrder` state + `moveExercise` handler; edit-mode `<ExerciseBlock>` now gets `onMoveUp`/`onMoveDown`/`isFirst`/`isLast`; the read-only `<ReadOnlyExerciseBlock>` gets nothing new. Render now iterates the effective (local-or-derived) order.
- `src/utils/session-exercise-order.ts` (new) — pure `orderExerciseIds(discoveredIds, persistedOrder)` helper (the History order-by-persisted-array sort with fallback), extracted so it's deterministically unit-testable.
- `tests/unit/session-exercise-order.test.ts` (new) — 11 cases covering the helper: legacy NULL/undefined/empty fallback, persisted reorder, append-unpersisted, ignore-stale-ids, no-mutation, legacy first-reorder snapshot.
- `tests/e2e/session-exercise-order.spec.ts` (new) — 3 tests (authored here; RUN by the Regression Tester after the migration is applied): persisted-order render, legacy-NULL read + first edit-mode reorder persists the column, within-exercise set order/count intact after reorder.

## Deviations from plan

1. **Migration number `0016` → `0019` (mechanical).** The fix-plan names the migration `0016_session_exercise_order.sql`, but `0016_admin.sql` already exists (plus `0017_admin_secdef_reads.sql`, `0018_admin_edit_exercises.sql`) — the plan's number is stale (written before/without noticing those). Migrations are hand-written and applied in numeric order by `supabase db push`; reusing `0016` would collide. Created `0019_session_exercise_order.sql` (next free number). The DDL is byte-for-byte the plan's. This is a correctness-required rename, not a design change. **Conductor: apply `0019`, not `0016`.**

2. **Finish snapshot reads `orderedExerciseIdsRef.current`, not the closure's `orderedExercises` directly (robustness).** The plan says pass `orderedExercises.map(e => e.id)` from `finishAfterMutation`. `finishAfterMutation` is created in a render closure; the check-all / discard-unchecked bulk mutations flip `setsQ.data` (re-deriving `orderedExercises`) BETWEEN the bulk mutation resolving and `finishAfterMutation` running, so the closure value can be stale (the discard path only `invalidateQueries`, no awaited refetch — the larger window). The plan's own design tolerates this (stale ids are ignored at read), but I added an effect-synced ref (`orderedExerciseIdsRef`) so the snapshot reflects the SURVIVING list the user is actually left with — directly satisfying `diagnosis.md:106` ("derive from the SURVIVING (checked) sets... sequenced AFTER the discard"). Same id values the plan intended; this only removes a staleness window. No behavior change for the non-discard path.

No other deviations. `set_number` within-exercise sort untouched; `listSetsForSession` untouched; `setsByExercise` untouched; no remove-in-History added; no read-only chevrons; per-tap optimistic persist as specified.

## uuid[] vs jsonb decision (the Implementer TODO)

**Decision: keep `uuid[]`. No `jsonb` fallback needed.** Rationale (reasoned from the runtime behavior, since I have no live-DB access — the Regression Tester confirms against the live DB):

- **Strong existing precedent in this exact codebase:** `exercises.muscles` is a Postgres `text[]`, declared in Drizzle as `text("muscles").array()` (`schema.ts:58`), and consumed everywhere as a JS `string[]` (`ExerciseRow.muscles: string[]`, `types.ts:149`). supabase-js/PostgREST serializes a Postgres array to a JSON array of elements; on `.update()` it accepts a JS array and writes it. A `uuid[]` serializes identically to a `text[]` — each element is a JSON string (the UUID text) — so `uuid[]` round-trips as `string[]` exactly like the proven `text[]`. There is no awkwardness to dodge.
- **Drizzle 0.38 mapping:** `uuid(...).array()` is a first-class column builder in drizzle-orm 0.38 (`^0.38.3`, `package.json`). It only needs to TYPECHECK here (the migration is hand-written + owner-applied, NOT `db:generate`d), and it does — `npm run typecheck` is clean. The Drizzle type for the column is `string[] | null`, matching `SessionRow.session_exercise_order`.
- **Why `jsonb` would be strictly worse:** it would lose the native array element typing, require `as`-casting on read, and diverge from the `text[]` precedent for no benefit. The plan's `jsonb` fallback was a contingency for an awkward round-trip that does not materialize.

**Regression Tester gate:** confirm `.update({ session_exercise_order: [uuid,...] })` (both the Finish write and the standalone reorder write) round-trips, and that `select("*")` returns the column as a JS `string[]` (or `null`). The e2e (`session-exercise-order.spec.ts`) asserts the persisted array equals the expected id array after a reorder, which exercises the full round-trip end to end against the live DB.

## Soft callbacks made
- None. The plan was decision-dense enough to implement without escalation; the one mechanical ambiguity (migration number collision) was resolvable against the migrations directory and recorded as Deviation 1.

## Quality gates
- [x] `npm run typecheck` — pass. 0 errors in `src/`/`app/`/`tests/`. (The only `tsc` errors are 29 pre-existing `TS18048`/`TS2322` in the Reproducer's throwaway probe scripts `docs/runs/.../repro-probe*.ts` — verified present on the baseline via `git stash`; not introduced by this change.)
- [x] `npm run lint` — pass. 0 errors, 1 warning — the pre-existing auto-generated `.expo/types/router.d.ts` warning (baseline-unchanged).
- [x] `npm run test:unit` — 455/455 passed (+11 new from `session-exercise-order.test.ts`; prior baseline 444).
- [~] `npx expo export --platform web` — NOT run here. It requires the `session_exercise_order` column to exist (the History/finish code now reads/writes it through `select("*")`/`update`), so it should run AFTER the Conductor applies `0019`. Handed to the Regression Tester (additive, no source-side reason to expect a build break — typecheck is the static proxy and is green).
- [x] No new `any` — grep-clean across all changed files (`: any`/`as any`/`<any>` — 0 in the diff).
- [x] No new `// @ts-ignore` / `@ts-expect-error` / `eslint-disable` — 0 in the diff.
- [x] No stray `console.log` / `debugger` — 0 in the diff (only the pre-existing `console.warn("Finish failed", err)` style error logs remain).

## Process notes (for retro)
- Applied the recurring prior-run lesson PRE-EMPTIVELY: the e2e seeds canonical exercise names (`Bench Press`, `Squat (Barbell)`, `Chin-up`) verified against the runtime catalog `pickCanonicalExercise` actually queries (`exercises WHERE user_id IS NULL`) — these are the 23 / 1 / 2 proven-green call sites across the existing suite, NOT names trusted from a seed migration. This is the exact seed-data trap that cost prior runs an I↔T round.
- No `replace_all` was used (all edits were surgical, uniquely-anchored), so no shadow-rename risk; typecheck was still run after each logical edit batch and at the end.
- The migration-number collision (`0016` taken) was caught by listing `supabase/migrations/` before writing — a reminder that the fix-plan's filenames can lag the tree on a fast-moving repo.

## Notes for Regression Tester
- **Migration first:** the Conductor applies `0019_session_exercise_order.sql` (additive nullable `ADD COLUMN`, reversible `DROP COLUMN`). All e2e + `expo export` depend on the column existing. Confirm existing rows read `session_exercise_order = NULL` post-migration and `getSession` still returns valid `SessionRow`s.
- **uuid[] ↔ string[] round-trip** — the headline verification (see decision above). The e2e's `readSessionOrder()` reads the column back via admin and asserts it equals the expected id array, covering Finish-write and reorder-write round-trips.
- **Replay the original repro** (`repro.md` Step A/B): a multi-exercise session whose sets are inserted in a non-display order now renders History in the persisted order, not the tie-break. The e2e test (1) pins this for a persisted session; the live Finish path is exercised by Step B manual repro (snapshot at Finish).
- **Run my e2e** `tests/e2e/session-exercise-order.spec.ts` (3 tests). It asserts: (1) persisted order wins over insertion order; (2) legacy NULL reads the fallback order + has no chevrons in read-only + first edit-mode reorder writes the column NULL→uuid[] and survives reopen; (3) within-exercise set count/order intact after a reorder.
- **Adjacent checks:** verdict PR list unchanged (order-independent); volume/e1RM/per-muscle/progress unchanged (order-independent); zero-set / discard-unchecked / check-all Finish paths finish without error (snapshot from surviving list).
- **RLS:** confirm a second user can neither READ nor WRITE the first user's `session_exercise_order` (the reorder UPDATE is a new write path; no new policy was added — it inherits `sessions`' `auth.uid() = user_id`).
- **Edit-mode add-exercise:** an exercise added in History edit then reordered before logging a set can persist its id into the column; on reopen an unmatched/never-logged id is ignored at read (covered by the helper's "ignore stale ids" unit case). No crash expected.
- **Limitation:** I cannot run e2e or the live build from this environment (no migration applied, sandbox). All live-DB verification is the Regression Tester's, post-apply.

## Round 2 (e2e de-flake)

Test-only, surgical. Acting on the Regression Tester's flag (`regression-report.md:55-59, 116`): test (2)'s post-reopen UI-render assertion intermittently caught the stale first paint due to the app's `PersistQueryClientProvider` cache-rehydration race on `page.goto` reopen — not a product defect (the persist/write assertion passes every run; the render resolves to the persisted order once the background refetch wins).

- **Change:** wrapped the post-reopen render assertion (formerly the bare `nameY`/`toBeLessThan` block at lines 270-274) in `await expect(async () => { ... }).toPass({ timeout: 15_000 })` — `tests/e2e/session-exercise-order.spec.ts:270-282`. Polls the render until the persisted order (A, C, B) settles, matching the `toPass` pattern already used in the same spec for the local-reorder assertions (lines 248-252, 309-313). Added a 6-line comment explaining the rehydration race.
- **Timeout choice:** `15_000` (vs the 5s used for the instant local-reorder waits) because this path waits on a full localStorage rehydration + background refetch, not an in-memory reorder. Matches the value the Tester verified 3/3.
- **Left as-is (per scope):** the persist assertion `readSessionOrder(sessionId) == [A,C,B]` (lines 254-261, already `toPass`-wrapped) — unchanged. No product code, migration, other tests, or `docs/features.md` touched.
- **Quality gates:** `npm run typecheck` pass (exit 0); `npm run lint` pass (0 errors, 1 pre-existing `router.d.ts` warning).
- **Re-run (live backend, fresh `npm run web` on :8081, column 0019 present):**
  - Initial `--repeat-each=3` on test (2): 1 failure / 2 pass. The single failure was the **cold-bundle first repeat** — the Expo web dev server pays a multi-second first-request bundling cost that consumed the 15s rehydration race window (`Expected: < 229, Received: 391` = stale legacy order, predicate timed out). Not a reproducible assertion flake.
  - Warm-server `--repeat-each=3` on test (2): **3/3 passed** (7.6–8.3s each; 0 unexpected, 0 flaky).
  - Full spec run ×2 on warm server: **3/3 passed both times** (0 unexpected, 0 flaky).
  - **Verdict:** deterministic on a warm server; the only observed failure was a known cold-start bundling artifact, not the de-flaked assertion. Recommend the suite be run against an already-warm dev server (the repo convention — Playwright does not manage the server lifecycle, `playwright.config.ts:5-8`).
