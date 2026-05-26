# Discovery — 2026-05-25_1921_canonical-exercises

## Feature prompt

> Canonical exercises (shared catalog) — single table, nullable `user_id`.
>
> Today `exercises.user_id NOT NULL` means every user gets their own copy of the 31 seeded exercises plus any they add. Move to a shared catalog where canonical exercises (admin-managed via direct DB edit, no admin UI) live as `user_id = NULL` rows visible to everyone, while any exercise a user creates stays scoped to them via `user_id = auth.uid()`. No per-user customization of canonical rows — canonical = read-only from app context.
>
> Migration `0011_canonical_exercises.sql`: (1) drop NOT NULL on `exercises.user_id`; (2) `UPDATE exercises SET user_id = NULL` (flips all 127 existing rows; UUIDs unchanged → no FK churn); (3) replace 4 RLS policies on `exercises` (SELECT: `user_id IS NULL OR user_id = auth.uid()`; INSERT/UPDATE/DELETE: `user_id = auth.uid()`); (4) rewrite `seed_new_user()` to drop the exercises INSERT (keep `user_preferences` insert); (5) decide on `exercises_user_idx`.
>
> App: zero changes expected on reads (RLS handles merge). Picker + Exercises library list render a "Created by you" chip on rows where `user_id !== null`. Create exercise mutation must explicitly set `user_id = auth.uid()`. Edit + soft-delete affordances gated on `user_id === currentUser.id` (canonical rows have no pencil, no trash).

Verbatim copy lives in `docs/runs/2026-05-25_1921_canonical-exercises/state.md:5-36`.

## Scope summary

Single-table-with-nullable-owner refactor of `public.exercises`. The 127 existing rows owned by the only current user (`gsinacio94@gmail.com`, uuid `0b2dfe22-2d30-41eb-bede-d7a42bc3651c`) flip to `user_id = NULL` (canonical, app-immutable, admin-edited via service role). The signup trigger stops inserting per-user copies. The app — which today never filters `exercises` by `user_id` from the client (relies on RLS entirely) — gets a new visibility predicate (`user_id IS NULL OR user_id = auth.uid()`) for free on every existing read, and grows three new UI affordances: a "Created by you" chip on user-owned rows in `<ExercisePicker>` + the Exercises library list row, and edit/delete-affordance gating on the edit screen + the per-exercise progress page header. All FKs from `sets`, `routine_exercises`, `exercise_notes` survive untouched because the migration only mutates `exercises.user_id` (PK `id` is the FK target and is unchanged).

## Affected files (verified)

### Schema / migration

- `src/db/schema.ts:46-63` — `exercises` table definition. Today: `userId: uuid("user_id").notNull().references(authUsers.id, { onDelete: "cascade" })`. The Drizzle schema must drop `.notNull()` so future `drizzle-kit generate` runs don't regress the migration; also drop (or comment out) the inline `userIdx: index("exercises_user_idx").on(t.userId)` if the migration drops the index. Drizzle has no first-class partial-index builder — precedent at `src/db/schema.ts:211-216` and `:238-245` for "SQL is the source of truth, schema.ts has a code comment".
- `src/db/types.ts:86-97` — `ExerciseRow.user_id: string` must become `string | null`. Load-bearing because `InferInsertModel<typeof exercises>` already follows `.notNull()`. The hand-rolled `ExerciseRow` PostgREST snake_case type is the one consumers read; the change needs to land there.
- `supabase/migrations/0001_rls_and_seed.sql:7-44` — uniform RLS loop that creates the 4 `exercises_*` policies as `auth.uid() = user_id`. Migration 0011 must `DROP POLICY IF EXISTS` each `exercises_*` policy and re-create them inline with the new SELECT predicate. The 0001 loop only runs on initial bootstrap (the `if exists` is for re-apply safety) — re-running 0001 would re-create the old policies, but in production 0001 is already applied and won't re-fire; the 0011 migration is what's deployed.
- `supabase/migrations/0001_rls_and_seed.sql:48-95` — original `seed_new_user()` body with text `primary_muscle`. Superseded by 0004.
- `supabase/migrations/0004_exercise_muscles_array.sql:43-90` — **current authoritative `seed_new_user()`** with the `muscles[]` payload. Migration 0011 must `CREATE OR REPLACE FUNCTION public.seed_new_user()` dropping the entire `insert into public.exercises (...)` block (lines 54-86 of 0004), keeping the `user_preferences` insert (lines 50-52 of 0004 + the `on conflict (user_id) do nothing` from 0001:55-57).
- `supabase/migrations/0000_schema.sql:91` — `CREATE INDEX exercises_user_idx ON exercises USING btree (user_id)`. Drop or convert to `WHERE user_id IS NOT NULL` partial. See Unknowns U2 and the "Index analysis" appendix below.
- `supabase/migrations/0005_measurements.sql:72-96` — **closest precedent for inline 4-policy RLS replacement** on a single table.
- `supabase/migrations/0010_exercise_notes.sql:1-74` — most recent migration. Next number is **0011**, confirmed.
- `supabase/migrations/0006_add_source_flag.sql:30-33` — `exercises.source` column with `CHECK (source is null or source in ('strong'))`. No change required; canonical rows continue carrying `source = NULL` (their original native state) which is correct semantically.

### API layer (every consumer of `exercises`)

- `src/api/exercises.ts:11-19` — `listExercises()` → `.from("exercises").select("*").is("deleted_at", null).order("name")`. Post-migration this returns `(canonical ∪ own) ∩ (deleted_at IS NULL)` via RLS. **Zero code change required.**
- `src/api/exercises.ts:21-30` — `getExercise(id)` → `.eq("id", id).is("deleted_at", null).single()`. Post-migration works for both canonical and user-owned rows (RLS SELECT now permits both). **Zero code change.**
- `src/api/exercises.ts:36-44` — `listAllExercises()` (sibling that intentionally includes soft-deleted rows). **Zero code change.**
- `src/api/exercises.ts:49-58` — `getAnyExercise(id)` (sibling include-soft-deleted). **Zero code change.**
- `src/api/exercises.ts:60-78` — `createExercise(input)` → already passes `user_id: userId` explicitly via `supabase.auth.getUser()` at lines 61-63. **Zero code change required for correctness.** The prompt's "ensure mutation explicitly sets `user_id = auth.uid()` (don't rely on implicit fill)" is already satisfied today.
- `src/api/exercises.ts:80-97` — `updateExercise(id, patch)` → `.update(...).eq("id", id).select().single()`. **Behaviour change post-migration**: calling this against a canonical row returns zero rows (RLS UPDATE policy uses `user_id = auth.uid()`, canonical has `user_id = NULL`). PostgREST surfaces this as a `PGRST116` "JSON object requested, multiple (or no) rows returned" because of the `.single()`. **Must be UI-gated** to prevent the confusing error toast — see Edit-screen item below.
- `src/api/exercises.ts:99-105` — `softDeleteExercise(id)` → `.update({ deleted_at }).eq("id", id)`. No `.select()`, so PostgREST returns 204 with zero affected rows silently. **Worse failure mode** than `updateExercise`: the optimistic invalidation runs, the row stays visible in the next list, and the user thinks they deleted it. **Must be UI-gated**.
- `src/api/routine-exercises.ts:14-25` — `listRoutineExercises(routineId)` → `.select("*, exercise:exercises(*)")` with an embedded join. RLS applies to the embedded child too; post-migration the embedded `exercise` may be a canonical row. **Zero code change.**
- `src/api/routine-exercises.ts:27-63` — `addExerciseToRoutine(...)` writes `user_id: userId` (routine entry's owner) and `exercise_id: input.exerciseId` (which may now reference a canonical row). **This is the intended new behaviour** — users add canonical exercises to their routines. **Zero code change.**

### Hook layer

- `src/hooks/use-exercises.ts:1-95` — all keys live under the `["exercises"]` prefix. The prefix-invalidate (`qc.invalidateQueries({ queryKey: KEYS.all })` at lines 63, 75, 91) means a create / update / soft-delete refetches both filtered + include-deleted reads. Behaviour for canonical-rows-not-mutable is correctness-preserved because the mutations never succeed against canonical rows (RLS).
- `src/hooks/use-routine-exercises.ts:16-22` — embedded `exercise:exercises(*)` ride-along works with canonical rows. **Zero code change.**
- `src/hooks/use-progress-page.ts:220-334` — `useExercisesThisWeek()` joins `useAllExercises()` (`lib.data`) with the lifetime sets dataset via `libById`. Post-migration the lookup still resolves because UUIDs are preserved through the migration's `UPDATE`. **Zero code change.**

### UI surfaces

**(A) `<ExercisePicker>` modal** — `src/components/exercise-picker.tsx:29-160`

- Renders rows from `useExercises()` (filtered, no soft-deleted). Each row is a name + muscles/equipment subline. **Insertion point for the "Created by you" chip**: inside the `<View className="flex-1 pr-3">` at lines 128-146, next to the name `<Text>` at 129-133. Precedent for an inline `rounded-full` chip next to a name: `src/components/pr-list-row.tsx:48-52` ("PR" pill). The chip renders only when `item.user_id !== null`.
- Neither this file nor any of its imports use `useAuth()` today. Predicate options: `item.user_id !== null` (RLS-trusted, no auth import) or `item.user_id === currentUser.id` (explicit, requires `useAuth()` or a `currentUserId` prop). See Unknowns U5.
- `excludeIds` (line 25-26) is purely a UI gate ("already in routine") and is unaffected.

**(B) `<ExerciseListItem>` — Exercises library list row** — `src/components/exercise-list-item.tsx:11-34`

- Mounted by `app/(app)/exercises/index.tsx:62-65` via `<FlatList>`. Same shape as the picker row: name + muscles/equipment subline. Same chip insertion point + same predicate decision.

**(C) Edit-exercise screen** — `app/(app)/exercises/[id]/index.tsx:31-208`

- Reached from `app/(app)/exercises/[id]/progress.tsx:55-63` (header pencil on the progress page). The form is currently unconditional once `useExercise(id)` resolves.
- **Three gating options** for canonical rows (`data?.user_id == null`):
  - **(a) Hide the pencil at source** — `app/(app)/exercises/[id]/progress.tsx:55-63` conditionally renders the pencil based on `exercise.data?.user_id != null`. Closes the affordance from the navigation graph.
  - **(b) Render read-only view** — keep the screen reachable (deep-link, route history) but show the fields as `<Text>` rather than `<Input>`, and hide both the Save and Delete buttons (lines 186-204). Mirror the read-only-history precedent (`src/components/read-only-exercise-block.tsx`).
  - **(c) Both** — defense-in-depth.
- The "Delete exercise" `<Button>` at lines 198-204 must NOT be rendered for canonical rows under any branch.
- Designer call (Unknowns U4). My recommendation: (c) both.

**(D) Per-exercise progress screen** — `app/(app)/exercises/[id]/progress.tsx:37-195`

- The header pencil at lines 55-63 routes to `/(app)/exercises/${id}` (the edit screen). For canonical rows, hide it. The predicate is `exercise.data?.user_id !== null` available via the existing `useAllExercise(id)` query at line 44 (so include-deleted is fine — admin could soft-delete a canonical row).
- The note slot at lines 144-146 (`<ExerciseNoteSlot exerciseId={id} editable={true} />`) is **per-user, not per-exercise** — the note belongs to `(user_id, exercise_id)` and stays editable on canonical exercises. The recent `2026-05-24_2327_exercise-note` design's `exercise_notes` table FKs `exercise_id` with ON DELETE RESTRICT and is scoped by `user_id = auth.uid()`. Notes on canonical exercises remain user-owned and editable.

**(E) `<ExerciseBlock>` header (live workout + history edit)** — `src/components/exercise-block.tsx:140-216`

- Out of scope. Prompt names only the picker + library list for the chip. The in-session block continues to render name + muscles/equipment without a chip.
- `onRemove` (line 31, called at 203-213) removes the exercise *from the current workout*, not from the library — no gating change needed.

### Read-only / unaffected paths

- `app/(app)/workout/[sessionId].tsx` — live workout. Uses `useExercises()` (filtered). RLS merges canonical + own. No change.
- `app/(app)/history/[id].tsx` — history detail. Uses `useAllExercises()` (include-soft-deleted) and the read-only block. No change.
- `app/(app)/history/index.tsx`, `app/(app)/progress/index.tsx`, `app/(app)/routines/[id]/index.tsx`, `app/(app)/routines/index.tsx`, `app/(app)/routines/new.tsx` — none filter `exercises` by `user_id` client-side. Verified: `grep -rn 'from("exercises")' src app` returns only `src/api/exercises.ts`.

### Test infrastructure (critical breakage scope)

- `tests/rls.test.ts:18-204` — two-user RLS smoke. **Must add a canonical-exercises arm**. Required assertions (Tester step will own these; flagging the contract here):
  1. Admin (service role) `insert({ user_id: null, name: ... })` succeeds — service role bypasses RLS.
  2. Signed-in user A `SELECT … WHERE id = <canonical id>` returns the row.
  3. Signed-in user B (different anon user) `SELECT` returns the same canonical row.
  4. Signed-in user A `UPDATE name=…` on a canonical row affects zero rows; re-read shows the name unchanged.
  5. Signed-in user A `DELETE` on a canonical row affects zero rows; re-read shows it present.
  6. Signed-in user A `INSERT (user_id: NULL, …)` is rejected by the INSERT policy (mirror `tests/rls.test.ts:181-192` `bNSpoof` pattern).
  7. **Anonymous (no JWT) `SELECT` from `exercises`** — depends on Unknowns U1's resolution.
  8. New signup trigger arm: confirm `seed_new_user` no longer inserts exercises (the day-2 verification at `tests/seed-and-auth.test.ts` is the natural home; rls.test.ts can stay scoped to access control).
- `tests/seed-and-auth.test.ts:1-93` — day-2 verification.
  - **Lines 52-60**: `.from("exercises").select("id, name").eq("user_id", userId)` expecting `length >= 25`. **Hard-fails after the migration** because the trigger no longer inserts. Change to: assert `eq("user_id", userId)` returns zero rows AND a separate `is("user_id", null)` query returns the canonical count.
  - **Lines 76-81**: `userClient.from("exercises").select("id")` expects `length >= 25`. RLS-scoped, so post-migration this returns canonical + own = canonical. Assertion still holds qualitatively but the comment should be updated to "user sees canonical via RLS".
- **e2e specs — 17 query sites across 16 files, all share the same `.eq("user_id", userId)` pattern** to look up a seeded exercise. **Every one will fail after the migration** (returns zero rows; throws "No exercises for ${userId}"). Sites:
  - `tests/e2e/rest-timer-auto-start.spec.ts:74`
  - `tests/e2e/auto-fill-placeholder-on-check.spec.ts:81`
  - `tests/e2e/max-volume-window.spec.ts:69`
  - `tests/e2e/week-drill-down.spec.ts:75`
  - `tests/e2e/end-of-session-verdict.spec.ts:75`
  - `tests/e2e/read-only-history.spec.ts:102`
  - `tests/e2e/exercise-session-row-list.spec.ts:83`
  - `tests/e2e/volume-target.spec.ts:90`
  - `tests/e2e/exercise-note.spec.ts:87` (and 457 which is an `UPDATE` to soft-delete by `id`, not affected)
  - `tests/e2e/weekly-volume-strip.spec.ts:74`
  - `tests/e2e/chart-scroll-week-selector.spec.ts:77`
  - `tests/e2e/soft-deleted-session-volume-leak.spec.ts:99`
  - `tests/e2e/session-total-volume-header.spec.ts:86`
  - `tests/e2e/progress-page.spec.ts:69`
  - `tests/e2e/crud.spec.ts:324`
  - (The two extra `progress-page.spec.ts` sites at lines 277 and 443 are `UPDATE name=… WHERE id=…` and don't depend on `user_id`.)
  - **Fix**: rewrite each to `.is("user_id", null)`. See Unknowns U6 for "in-place rewrite vs `pickCanonicalExercise(admin)` helper extraction".
- `scripts/create-user.ts:50-57` — diagnostic prints `exercises seeded: ${exCount}`. Post-migration prints `0`. Cosmetic; not a blocker. Out of scope unless Designer chooses to fix.

## Relevant conventions (verified by reading code)

1. **The client never filters `exercises` by `user_id`.** Verified: `grep -rn 'eq("user_id"' src app` matches only test/script files, never source. The SELECT policy is the sole authority on visibility. This is the foundational reason the migration is "zero client read changes" — RLS does the merge.
2. **Mutation explicitness.** Even though RLS would enforce `user_id = auth.uid()` on INSERT, `createExercise` (`src/api/exercises.ts:60-78`) already passes `user_id: userId` explicitly via `supabase.auth.getUser()`. Pattern mirrored in `src/api/routine-exercises.ts:50`, `src/api/exercise-notes.ts:…`, etc. **Convention is "pass the user_id, don't rely on the default"**. No code change.
3. **Migration shape.** Hand-written `.sql` files in `supabase/migrations/`. New tables: inline 4 RLS policies (`0005_measurements.sql:72-90`, `0010_exercise_notes.sql:49-67`). Schema changes to existing tables: `0004_exercise_muscles_array.sql` is the closest precedent (column add → backfill → drop legacy → `create or replace` the trigger function). Migration 0011 mirrors this structurally (nullability change → backfill via UPDATE → policy replace → trigger rewrite).
4. **Policy replacement style.** For a single table replacing 4 policies, inline (`drop policy if exists exercises_select on public.exercises; create policy exercises_select on public.exercises for select using (…);` × 4) is the convention. Precedent: `0010:53-67`.
5. **Schema-as-code drift discipline.** `src/db/schema.ts` is the Drizzle source of truth. The next `npm run db:generate` after the migration would emit a regression migration restoring `NOT NULL` if `schema.ts` isn't also updated. `docs/development.md:99-116` codifies this. Implementer must update `schema.ts` in the same commit as the migration.
6. **Persisted query cache buster.** `src/lib/query-client.ts:27` exports `queryCacheBuster = "schema-2026-05-21-set-check"`. `docs/decisions.md` Decision 9 (the iPhone shakedown lesson) mandates bumping this on any schema change that affects a column read by a persisted query. The 0011 migration doesn't add/rename/remove columns but **does** change the runtime value of `user_id` for all 127 existing rows (UUID → NULL). Consumers that read `row.user_id` (the new chip predicate) will see stale UUIDs from the persisted cache. **My recommendation: bump the buster** to e.g. `schema-2026-05-25-canonical-exercises`. Designer should confirm. Type-level shift (`string` → `string | null`) further argues for the bump.
7. **Chip / badge precedent.** `src/components/pr-list-row.tsx:48-52` — `<View className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 dark:bg-emerald-900"><Text className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">PR</Text></View>`. Only "inline label-chip next to a row name" precedent in the codebase. Re-use the shape verbatim for "Created by you"; pick a neutral colour (gray / amber / slate) so the visual semantic is "you authored this", not "achievement". Designer rules colour.
8. **Auth context coupling at the leaf component layer.** Only `app/(app)/profile.tsx:35` consumes `useAuth()` today. No component currently does `useAuth().user?.id` to gate UI. Adding it to `<ExercisePicker>` or `<ExerciseListItem>` is a precedent-setting choice. Two-side argument lives in Unknowns U5.
9. **Soft-delete on canonical rows is admin-only.** App `softDeleteExercise` can't touch canonical (RLS UPDATE denies). An admin running `UPDATE … SET deleted_at = now() WHERE user_id IS NULL AND id = …` via service role can soft-delete a canonical row; the app filters it via `.is("deleted_at", null)` and it disappears from every user's view. History references survive via the include-soft-deleted reader (`listAllExercises`). No UI change.
10. **Drizzle index limitations.** Partial indexes can't be expressed in the typed builder — the precedent is to declare the index in SQL and leave a comment in `schema.ts` (`schema.ts:211-216` for `measurement_entries_user_day_idx`, `schema.ts:238-245` for `exercise_notes_user_exercise_active_uq`). If 0011 ships a partial index, this is the established way.

## Constraints

- **Data**: only `public.exercises` mutated by 0011. FKs into `exercises` from `sets.exercise_id` (RESTRICT — `schema.ts:145`), `routine_exercises.exercise_id` (RESTRICT — `schema.ts:93`), `exercise_notes.exercise_id` (RESTRICT — `schema.ts:228`) are on the `id` column, not `user_id` — unaffected. UUIDs are preserved through the `UPDATE … SET user_id = NULL`, so all FKs continue to resolve. The migration must run in a single transaction (Supabase CLI's `db push` wraps migrations in `BEGIN ... COMMIT` automatically).
- **UI**: NativeWind classes only. Every text/bg utility used in the chip must have a `dark:` counterpart (precedent — `pr-list-row.tsx:48-52`). The chip lives next to the name `<Text>`, not in the subline (precedent). Chip should be `ml-2 rounded-full px-2 py-0.5` (consistent vertical alignment with `text-base` name).
- **Platform**: web (Playwright) is the active test surface; iOS via Expo Go + free-provisioning native build. No platform-specific code expected. RN-Web maps `<View>` to `<div>`; chip renders identically.
- **Auth**: `auth-context.tsx` exposes `session.user.id`. RLS uses `auth.uid()` populated from the JWT. **No anon-key code path passes a JWT-less request today** (every reachable screen is behind the `app/_layout.tsx` auth gate). The "anon sees canonical" question (Unknowns U1) is therefore an explicit Designer call, not an accidental side-effect of existing code.
- **Performance**: post-migration the RLS predicate is `(user_id IS NULL OR user_id = auth.uid())`. With 127 rows total, sequential scan is fine. Index analysis in the appendix below.

## Existing precedents

1. **Migration adjusting an existing table + rewriting a trigger function** — `0004_exercise_muscles_array.sql:1-90` (text → text[] migration, `CREATE OR REPLACE` of `seed_new_user`). The 0011 migration mirrors this structure almost line-for-line: column-nullability change, UPDATE backfill, function rewrite, policy replace.
2. **Inline 4-policy block for a single table** — `0010_exercise_notes.sql:53-67` (replacement-friendly with `drop policy if exists` + `create policy` paired four times). Use this style for the 4 replaced `exercises_*` policies.
3. **Read-only sibling of an editable component** — `src/components/read-only-exercise-block.tsx:1-107` (sibling of `<ExerciseBlock>`). For the edit screen's canonical-row branch, two options: a dedicated read-only sibling, or in-place conditional rendering. The read-only-block precedent argues for "dedicated sibling" but the edit screen is a single screen with one form, not a recurring component — in-place gating is lighter and idiomatic for screens. Designer call.
4. **Pill chip next to a row name** — `src/components/pr-list-row.tsx:48-52` is the only example. Use it as the visual template.
5. **No client-side ownership predicate precedent exists** — this run introduces it for the first time. The "screen reads `useAuth()`, passes `currentUserId` down" approach is partly established by `app/(app)/profile.tsx:35`, but no leaf component currently consumes auth. Designer should rule the predicate shape (Unknowns U5).
6. **F4 read-only-history toggle pattern** — `app/(app)/history/[id].tsx:182-214` (the pencil flips a screen-level `isEditing` boolean, swapping `<ExerciseBlock>` for `<ReadOnlyExerciseBlock>`). Not directly transferable to the edit screen (which is a single-purpose screen, not a viewer-with-edit-toggle), but the philosophy — "default to read-only, edit is an explicit affordance" — could guide the canonical-row handling.

## Unknowns (require Designer judgment or human decision)

### U1 — Anonymous (no JWT) read access to canonical rows

**(a) What's unknown.** The proposed SELECT policy `user_id IS NULL OR user_id = auth.uid()` evaluates `NULL IS NULL = TRUE` for any caller. An anonymous (no-JWT) PostgREST client would therefore read the canonical exercise catalog. The prompt says "canonical = visible to everyone"; the current app forces sign-in before any exercises screen mounts. The policy still permits it.

**(b) Why it matters.** Security posture decision: do we want a logged-out caller scraping the canonical exercise list via PostgREST? Possibly yes (future marketing/SEO), possibly no (data privacy stance). The decision shapes the Tester's anon-client assertion — locking it in now avoids a rewrite later.

**(c) Recommended Conductor check.** Ask the user: "The proposed SELECT policy lets a logged-out client SELECT canonical rows. Intentional, or should the policy be tightened to `auth.uid() IS NOT NULL AND (user_id IS NULL OR user_id = auth.uid())`?" **Not a true blocker** — Designer can default to the looser variant and the human can flip it if needed; flagging here so the choice is conscious. Default recommendation: the looser variant (current proposal-as-written), with an explicit Test arm pinning the behaviour.

### U2 — `exercises_user_idx` resolution

**(a) What's unknown.** The prompt asks Discovery to confirm whether the index is exercised. **Verified fact**: no client query passes a `user_id` predicate explicitly. RLS's implicit predicate is the only consumer, and at 127 rows the planner will seq-scan regardless.

**(b) Why it matters.** Cosmetic for current scale; defensible for future. Drop now is YAGNI-consistent with the codebase ethos. A partial index `(user_id) WHERE user_id IS NOT NULL` would be the post-migration optimal if user-owned-row volume ever climbs.

**(c) Recommended Conductor check.** Not a blocker. Designer rules. Default recommendation: **drop the index**.

### U3 — Schema-file update enforcement

**(a) What's unknown.** The prompt focuses on the SQL migration and does not explicitly call out updating `src/db/schema.ts:46-63` (the Drizzle definition). Without that update, the next `npm run db:generate` would emit a regression migration restoring `NOT NULL`.

**(b) Why it matters.** Drizzle schema drift is a recurring foot-gun. `docs/development.md:99-116` codifies the convention.

**(c) Recommended Conductor check.** Not a blocker. Designer must explicitly require the Implementer to update `src/db/schema.ts` in the same commit. Flag.

### U4 — Edit-screen treatment of canonical rows

**(a) What's unknown.** The prompt says "Edit exercise UI: gate edit affordance on `exercise.user_id === currentUser.id` (user-owned only). Canonical rows render with no pencil." Does "no pencil" mean (a) the progress-screen header pencil is hidden so the user can't reach the edit screen for a canonical row; or (b) the user can still reach the screen (deep-link, route history) but the screen renders a read-only view; or (c) both.

**(b) Why it matters.** (a) alone leaves a deep-link hole. (b) is defense-in-depth and matches the read-only-history precedent. (c) is the safest.

**(c) Recommended Conductor check.** Not a blocker. Designer rules. My recommendation: **(c) both**.

### U5 — Auth coupling for the chip predicate

**(a) What's unknown.** Two viable predicates for the "Created by you" chip: (1) `exercise.user_id !== null` (RLS-trusted, no auth import in the leaf); (2) `exercise.user_id === currentUser.id` (explicit, defense-in-depth, requires `useAuth()` or a prop drill).

**(b) Why it matters.** (1) couples the chip's correctness to RLS correctness (which the new Tester arm now explicitly covers). (2) is more code but defends against an RLS regression.

**(c) Recommended Conductor check.** Not a blocker. Designer rules. My recommendation: **(1) `user_id !== null`** for simplicity; the failure mode is bounded by the explicit RLS test arm.

### U6 — e2e test rewrite scope: in-place vs helper extraction

**(a) What's unknown.** Whether the Implementer flat-rewrites `.eq("user_id", userId)` → `.is("user_id", null)` across 15 e2e specs (17 query sites), or extracts a `pickCanonicalExercise(admin)` helper to a new shared module (no precedent for one).

**(b) Why it matters.** 17 identical call sites is past the point where DRY pays. The Implementer round budget (2 I↔R rounds + 2 I↔T rounds) is tight; a helper makes the diff cleaner and the post-merge maintenance easier.

**(c) Recommended Conductor check.** Not a blocker. Designer rules. My recommendation: **ship the helper** (e.g. `tests/e2e/_helpers/canonical-exercise.ts`).

## Out-of-scope flags

- **Admin UI for canonical-exercise editing.** Prompt: "admin-managed via direct DB edit, no admin UI." No screen, no Edge Function, no service route.
- **Per-user override / overlay of canonical rows.** No table for "user A renames canonical X locally". Canonical = strictly read-only from the app, no exceptions.
- **Name-uniqueness constraints between canonical and user-owned.** Prompt explicit. The user may create an exercise with the same name as a canonical; both appear in the picker, distinguished by the chip on the user-owned one.
- **Backfill of `sets` / `routine_exercises` / `exercise_notes`.** Not needed — UUIDs preserved by `UPDATE … SET user_id = NULL` on `exercises`. All FKs continue to resolve.
- **`routine_exercises.user_id`, `sets.user_id` nullability.** Stay `NOT NULL`. Only `exercises.user_id` becomes nullable.
- **"Created by you" badge in `<ExerciseBlock>` (live workout / history).** Prompt names only the picker + Exercises library list. The in-session block keeps its current shape.
- **Migrating the seed list contents.** The 31 seeded exercises (per the current trigger body in `0004:54-86`) stay as the canonical set — the migration flips them in place, not by drop-and-reinsert.
- **Wiring a "Recommended" or "Featured" subset of canonical.** Out of scope; canonical = unsorted, name-ordered, same as today.
- **Anonymous-public read enablement / disablement** (per U1): explicit Designer call; default to the looser variant (current proposal-as-written) unless the user says otherwise.
- **`scripts/create-user.ts:56-57` cosmetic** (it prints "exercises seeded: 0" post-migration). Out of scope unless Designer chooses to fix.

---

## Index analysis (extra detail per prompt step 1)

`exercises_user_idx` (btree on `user_id`):

- **Defined**: `supabase/migrations/0000_schema.sql:91`, schema-side `src/db/schema.ts:61` (`userIdx: index("exercises_user_idx").on(t.userId)`).
- **Consumers**: zero client-side `WHERE user_id = …` predicates anywhere in `src/`, `app/`, `scripts/` (only in `tests/`, which uses the admin client). RLS injects `user_id = auth.uid()` into every SELECT/UPDATE/DELETE plan — the planner *may* use the btree depending on stats and selectivity. With 1 user and 127 rows, the planner does a seq scan.
- **Post-migration shape**: the RLS predicate becomes `(user_id IS NULL OR user_id = auth.uid())`. Postgres can OR-decompose this into two index scans, but the `user_id IS NULL` branch is best served by a partial index; the equality branch can use the original btree if selective. At the projected scale (127 canonical + <10 user-owned per user, ever), this is academic.
- **Recommendation (Discovery's read; Designer rules)**: drop the index in 0011. If/when user-owned exercise volume becomes interesting (>1k per user — unlikely for a personal app), introduce a partial index on the non-null branch via a future migration. Matches the YAGNI ethos visible across `docs/decisions.md`.
