# Discovery — 2026-05-24_2327_exercise-note

## Feature prompt
> Exercise note. Be able to add a personal note to an exercise that will always show on that exercise, independent of the routine. This note belongs to the user on that exercise, not to the exercise directly. The database needs to handle one note per (user, exercise) pair — these notes are private to the individual user. Surfaces: (1) the exercise's progress/detail screen should show the note prominently with an edit affordance; (2) when an `<ExerciseBlock>` is rendered on the live workout screen, the note should be visible to the user (e.g. inline below the exercise header). Editing should be a simple text area. New table `exercise_notes` (user_id + exercise_id + body, plus timestamps) with RLS so each user only reads/writes their own. New migration. Standard hook + API pair, mirror the `user_preferences` precedent for the auth-scoped reads.

## Scope summary
A new per-user, per-exercise free-text "note" surfaced on the exercise progress screen and on the live `<ExerciseBlock>` header area (also reused on history detail, since the same `<ExerciseBlock>` mounts there in edit mode and `<ReadOnlyExerciseBlock>` in read mode). The data backbone is a new RLS-protected `exercise_notes` table (UUID PK, `(user_id, exercise_id)` unique pair, `body` text, soft-delete timestamps), a thin `src/api/exercise-notes.ts` (mirroring `src/api/preferences.ts` shape), and a `src/hooks/use-exercise-note.ts` reader+setter (mirroring `src/hooks/use-preferences.ts`).

**Critical pre-existing overlap (flag for Designer):** the `exercises` table is already per-user (FK to `auth.users` with cascade — `src/db/schema.ts:50-52`) and already carries a `notes text` column (`src/db/schema.ts:56`, added in `supabase/migrations/0002_add_notes_columns.sql`). That column is editable on `app/(app)/exercises/[id]/index.tsx:162-174` (a `<Textarea label="Notes (optional)">` with a 500-char zod cap) but is **never rendered** on either the progress screen or the `<ExerciseBlock>` / `<ReadOnlyExerciseBlock>` components. So the data store the prompt is asking for already exists in everything but name — the prompt's stated requirement of "one note per (user, exercise) pair" is satisfied today by `exercises.notes` because `exercises` is itself a per-user library. See Unknowns U1.

## Affected files (verified)

### Schema / database
- `src/db/schema.ts:33-44` — `userPreferences` table: precedent for PK = `user_id`, FK to `authUsers.id` cascade, `...timestamps` triple (created/updated/deleted), no UUID `id` column (since 1:1 with user).
- `src/db/schema.ts:46-63` — `exercises` table: `id` UUID PK, `user_id` FK cascade, **`notes: text("notes")`** existing column, `userIdx` btree index on `user_id`. New `exercise_notes` table will FK both `user_id` (cascade) and `exercise_id` (restrict? — see Unknowns U5).
- `src/db/schema.ts:23-31` — `timestamps` spread: `createdAt`, `updatedAt`, `deletedAt`. Mirror exactly.
- `src/db/schema.ts:19-21` — `authUsers` declaration (FK target reference; never define columns).
- `src/db/types.ts:13` — `UserPreferences = InferSelectModel<typeof userPreferences>` shape precedent.
- `src/db/types.ts:82-93` — `ExerciseRow` snake_case row type precedent. PostgREST returns snake_case; Drizzle infers camelCase — screens and hooks consume `Row` types.
- `supabase/migrations/0001_rls_and_seed.sql:7-44` — RLS pattern (loop over a tables array applying the same 4 policies: select / insert / update / delete, gated on `auth.uid() = user_id`).
- `supabase/migrations/0001_rls_and_seed.sql:104-130` — `touch_updated_at()` trigger function precedent + the loop that applies it.
- `supabase/migrations/0005_measurements.sql:72-96` — "new table" RLS pattern: 4 inlined policies (cleaner than the table-array loop when adding a single new table) + `touch_updated_at` trigger. **This is the closer precedent** for a brand-new RLS-protected table.
- `supabase/migrations/0002_add_notes_columns.sql:1-2` — "minimal additive migration" precedent (adds `exercises.notes` and `sets.notes`). Confirms text-notes don't carry a DB-level CHECK length cap in this codebase.
- `supabase/migrations/0009_max_volume_window.sql:1-39` — most recent migration; next free number is **0010**, confirmed.

### API layer
- `src/api/preferences.ts:1-74` — direct mirror target. Shape: `getMyX()` (one auth-scoped row, `.maybeSingle()`, returns `null` if no auth or no row), `setX()` (auth check → `.update().eq("user_id", userId).select().single()`). For the note we want a `getMyExerciseNote(exerciseId)` reader + `upsertMyExerciseNote(exerciseId, body)` writer (the row doesn't exist for every (user, exercise) — the user only creates it when they first save a note). See Unknowns U4 about read-or-write semantics.
- `src/api/preferences.ts:14-27` — pattern: `supabase.auth.getUser()` + early-return-null when unauth + `.is("deleted_at", null)` + `.maybeSingle()`. Note that `user_preferences` queries DO add the `deleted_at` filter even though no soft-delete UX exists for prefs.
- `src/api/exercises.ts:60-78` — `createExercise()` precedent: `supabase.auth.getUser()` → `auth.user?.id` → throw if not authed → `.insert({user_id: userId, ...}).select().single()`.
- `src/api/measurements.ts:121-159` — alternate precedent: per-row writes for a "1 row per user per business-key" table, including a UNIQUE-violation discriminator (SQLSTATE 23505). Not strictly needed for upsert, but documents the duplicate-key error-path convention.

### Hook layer
- `src/hooks/use-preferences.ts:1-69` — direct mirror target. `useQuery({queryKey, queryFn})` reader + `useMutation` setter with `onSuccess: (row) => qc.setQueryData(KEY, row)`. KEY array uses `["preferences", "me"] as const`. For the note: `["exercise_note", exerciseId, "me"] as const` (parameterized).
- `src/hooks/use-exercises.ts:14-25` — multi-key cache convention with `KEYS` const: useful if we want a list view ever, but `exercise_notes` is read by `exerciseId` so a parameterized single-key suffices.
- `src/hooks/use-measurements.ts` — companion 1-row-per-day precedent; would be worth a glance if Designer wants per-row CRUD instead of upsert.

### UI surfaces

**(A) Per-exercise progress screen** — `app/(app)/exercises/[id]/progress.tsx`
- Renders header (`Stack.Screen options`) at lines 49-66 with a header-right Pencil already wired to the edit screen (`router.push('/(app)/exercises/${id}')` at 56). The note belongs inside the scroll body, NOT as a header-right action — the existing pencil is already taken.
- The body opens at lines 125-138 with `<Text>` exercise name + sessions/best-1RM summary line. **Likely insertion point for the note section is between line 138 and line 140** (between the summary line and the chart "no working sets" branch / charts), so the note sits above the chart and is the first thing the user sees after the name. The note section should render even when `e1rmData.length === 0` (empty progress).
- The progress query (`useExerciseProgress(id)` at line 44, sourced via `src/api/progress.ts:10-39`) is set-based, NOT note-based. The note read is independent (a separate `useMyExerciseNote(id)` query).
- Header title uses `exercise.data?.name` — `useAllExercise(id)` (include-deleted variant) returns the row at line 43. The note should also continue to render for soft-deleted exercises (the screen is a "see all history" view).

**(B) `<ExerciseBlock>` — live workout + history-edit** — `src/components/exercise-block.tsx:60-324`
- Header block at lines 141-215: name + optional `(deleted)` suffix + muscles/equipment subline.
- **Natural insertion point for note**: between the header `<View>` (closes at 215) and the `showVolumeTarget` slot at 217-222 — i.e., a new "note slot" rendered just below the header but above `<VolumeTargetSlot>`. Alternative: stack note above the volume target slot so the user sees note → target → sets. Designer call (see Unknowns U6 for ergonomics).
- Editing affordance options seen in the codebase:
  - **Inline-and-tap-to-edit-in-modal/bottom-sheet** — analogous to `<SetRowMenu>` at `src/components/set-row-menu.tsx` for RPE/notes-per-set. Looking at the existing pencil header-right pattern.
  - **Pencil icon to open a screen** — `app/(app)/exercises/[id]/progress.tsx:55-63` opens the edit screen via push.
  - **Inline `<Textarea>` collapsed-to-expanded with commit-on-blur** — `<SessionTimesEditor>` and the inline name editor on `history/[id].tsx:248-256` follow this commit-on-blur pattern.
- The header `<View>` may not be the right place because of the existing `(deleted)` and chevron-up/down/trash icons next to the title. A separate "note row" below the title section is cleaner.

**(C) History detail re-mounts `<ExerciseBlock>`** — `app/(app)/history/[id].tsx`
- Line 308-352: `<ExerciseBlock>` is mounted when `isEditing === true` (the F4 read-only-history edit toggle).
- Line 353-363: `<ReadOnlyExerciseBlock>` (separate component, `src/components/read-only-exercise-block.tsx`) mounts when `isEditing === false`.
- **The note appears on BOTH paths** — the user must see their note when they open a past session in read-only too. That means `<ReadOnlyExerciseBlock>` must also render the note. Editing the note from inside read-only history is a design question (Unknowns U6); the simplest read-the-prompt answer is "show always, edit only when `isEditing`".

**(D) Edit-exercise screen** — `app/(app)/exercises/[id]/index.tsx:162-174`
- Already has a `<Textarea label="Notes (optional)" placeholder="Cues, grip width, stance, etc." />` bound to `exercises.notes`. **Critical decision point**: is the new `exercise_notes` body a separate concept or does it replace this? See Unknowns U1.

### Reusable UI primitive
- `src/components/ui/textarea.tsx:1-37` — `<Textarea label, error, ...TextInputProps>` with `multiline numberOfLines={4} textAlignVertical="top"`, NativeWind border, dark-mode classes. Reuse directly for both surfaces (no new primitive needed). Existing usage: `app/(app)/exercises/[id]/index.tsx:162` and `app/(app)/routines/[id]/index.tsx:159`.

### Test surfaces that exist and might need new arms
- `tests/rls.test.ts` — RLS smoke test for two users. **Must add an `exercise_notes` arm** (User A insert → User B cannot select/update/delete). Precedent: lines 119 of `docs/data-model.md` explicitly requires this for new RLS tables.
- `tests/e2e/rest-timer-auto-start.spec.ts`, `tests/e2e/exercise-progress-ia.spec.ts`, `tests/e2e/exercise-session-row-list.spec.ts`, `tests/e2e/progress-page.spec.ts`, `tests/e2e/soft-deleted-exercises-in-history.spec.ts`, `tests/e2e/max-volume-window.spec.ts` — touch the per-exercise progress screen (`/progress` URL) OR `<ExerciseBlock>`. Adding a note row below the header could shift element coordinates / accessible labels. Tester should sanity-check that none of these specs rely on positional selectors that the note section would push down.
- `tests/unit/read-only-history-display.test.ts` — already tests `presentReadOnlyExerciseBlock`. If we add note presentation to `<ReadOnlyExerciseBlock>`, this pure-function presenter may need a `noteBody` field (or the rendering may stay outside the presenter).

## Relevant conventions (verified by reading code)

1. **PK shape for per-user singletons** vs **per-row tables**:
   - `user_preferences` uses `user_id` as the PK (one row per user, no `id` column) — `src/db/schema.ts:33-37`.
   - `exercises`/`routines`/`sessions`/`sets`/`measurement_entries` use UUID `id` + FK `user_id`.
   - For `exercise_notes` (one row per `(user_id, exercise_id)` pair), both shapes are viable. **Two precedents to pick between** — see Unknowns U2.

2. **Foreign-key conventions**:
   - `user_id` always cascades on user delete (`{ onDelete: "cascade" }` — `src/db/schema.ts:36, 51, 70, 86, 116, 138, 187`).
   - `exercise_id` from history-bearing tables (`routine_exercises.exercise_id`, `sets.exercise_id`) restricts on exercise delete to preserve history (`{ onDelete: "restrict" }` — `src/db/schema.ts:93, 145`). **For `exercise_notes` the design choice is open** — restrict (forces soft-delete) or cascade (note disappears when exercise is hard-deleted, which never happens today because the app uses soft-delete). See Unknowns U5.

3. **RLS uniform pattern**: every user-owned table gets the same 4 policies, gated on `auth.uid() = user_id`. Two implementation styles:
   - Loop over a tables array (`0001_rls_and_seed.sql:17-44`).
   - Four inline `create policy` statements (`0005_measurements.sql:74-90`). Cleaner for a single new table.

4. **Soft-delete + `deleted_at` everywhere**, scrubbed by every read path with `.is("deleted_at", null)`. Whether the note carries `deleted_at` is open — Designer call (Unknowns U7). The cheapest answer is "yes for uniformity, even if no UI uses it".

5. **API read paths**: always re-fetch `supabase.auth.getUser()` at call time, never read a cached user. Pattern at `src/api/preferences.ts:15-17`. Same applies to writes (`src/api/exercises.ts:61-64`).

6. **Hook cache keys** are tuples-as-const. Parameterized by the resource ID (`KEYS.detail(id)` — `src/hooks/use-exercises.ts:21-25`).

7. **Mutation cache hydration**: `onSuccess: (row) => qc.setQueryData(KEY, row)` for single-row endpoints (preferences pattern), or `qc.invalidateQueries({queryKey: KEYS.all})` for multi-row endpoints (exercises pattern). For a per-(user, exercise) note, **`setQueryData(["exercise_note", exerciseId, "me"], row)`** is correct.

8. **Text validation lives in zod, NOT in CHECK**: no `length()` CHECK constraints exist in any migration (`grep "length(" supabase/migrations/` returns 0). Existing zod caps: `notes z.string().trim().max(500)` on exercises (`app/(app)/exercises/[id]/index.tsx:26`), `notes max(2000)` on routines (`app/(app)/routines/[id]/index.tsx:37`). Designer should pick a cap that fits the use case (Unknowns U3).

9. **Header-right Pencil** is the established "go to edit screen" affordance — `app/(app)/exercises/[id]/progress.tsx:55-63`, `app/(app)/history/[id].tsx:206-214`. The progress screen's header-right is **already taken** by the edit-exercise pencil; for the note, edit affordance must live in the scroll body, not the header.

10. **NativeWind class palette** for note presentation should match the body-text idiom seen at `app/(app)/history/[id].tsx:294-298` (`text-sm italic text-gray-600 dark:text-gray-400`) when displaying session notes inside the read-only summary. The `<ExerciseBlock>` header uses `text-lg font-semibold` for name and `text-sm text-gray-500` for the muscles/equipment subline (`src/components/exercise-block.tsx:150, 166`).

## Constraints

- **Data**:
  - New table `exercise_notes` is RLS-protected. The standard 4 policies on `auth.uid() = user_id` apply.
  - One row per `(user_id, exercise_id)` — enforce with either composite PK or a UNIQUE index on the (user_id, exercise_id) pair.
  - FK targets: `auth.users.id` (cascade) and `exercises.id` (open: restrict vs cascade — Unknowns U5).
  - `seed_new_user()` does NOT need updating — new users have no notes; the row is created lazily on first edit.
  - The seed function runs `SECURITY DEFINER` and would be the place to seed default notes, but the feature is purely user-driven (no defaults), so no change.

- **UI**:
  - Two render surfaces minimum: (1) progress screen body, (2) `<ExerciseBlock>` (live + history-edit modes).
  - Third surface required by the prompt's "always show on that exercise, independent of the routine": `<ReadOnlyExerciseBlock>` (history detail in read-only). Confirmed because the prompt says the note shows "when an `<ExerciseBlock>` is rendered" — but the same exercise card rendered in history-read-only is the closest precedent, so consistency dictates including it (Designer can debate).
  - NOT a render surface (prompt says "independent of the routine"): the routine builder at `app/(app)/routines/[id]/index.tsx`. The prompt's phrase is ambiguous — see Unknowns U8 — but the literal reading is that the **per-routine** `routine_exercises.notes` field stays separate and the new `exercise_notes` body does NOT need to render in the routine builder. Recommendation to Designer: keep the routine builder untouched in v1.
  - `<Textarea>` primitive at `src/components/ui/textarea.tsx` is reusable as-is.

- **Platform**: react-native universal app — same code paths for iOS/Android/web. No platform divergence.

- **Auth**: `supabase.auth.getUser()` at read time + RLS enforcement. Reads return `null` when unauthed (preferences precedent at `src/api/preferences.ts:17-18`).

- **Performance**:
  - Per-exercise note reads are 1 row by composite key — trivial.
  - The `<ExerciseBlock>` is rendered N times on the live workout screen (one per exercise). Each block firing its own `useMyExerciseNote(exerciseId)` query is N HTTP requests on first mount. Acceptable for a typical workout (5-8 exercises), and TanStack caches by exercise id so subsequent renders are free. Designer may prefer a session-wide batch read (`listMyNotesForExerciseIds([...])` returning a Map) if the N-query pattern feels excessive — see Unknowns U9.

## Existing precedents

- **`user_preferences` (auth-scoped single-row reader)** — `src/api/preferences.ts:14-27`, `src/hooks/use-preferences.ts:17-22`. Direct mirror target for the prompt's stated goal.
- **`measurement_entries` (per-row CRUD with unique-constraint discrimination)** — `src/api/measurements.ts:42-99`, `supabase/migrations/0005_measurements.sql:40-96`. Better precedent for the **migration shape** (single new RLS-protected table, inline 4-policy block, `touch_updated_at` trigger).
- **`exercises.notes` (existing per-user free-text)** — `src/db/schema.ts:56`, `app/(app)/exercises/[id]/index.tsx:162-174`, `supabase/migrations/0002_add_notes_columns.sql:1`. Direct semantic overlap with the new feature — see Unknowns U1.
- **`session_notes`-style inline display** — `app/(app)/history/[id].tsx:294-298` shows session notes as `text-sm italic text-gray-600 dark:text-gray-400` italic body text. Reusable styling for a "read-only display below header" note.
- **Read-only / edit-mode split** — `app/(app)/history/[id].tsx:179-215` Pencil → "Done" header toggle, with `<ReadOnlyExerciseBlock>` ↔ `<ExerciseBlock>` swap (F4 read-only-history pattern). Precedent for "show always, edit gated on a mode toggle".
- **Soft-delete-aware reads** — `src/api/exercises.ts:36-58` (`listAllExercises`, `getAnyExercise`) ship include-deleted siblings. For `exercise_notes` no equivalent is needed because notes belong to the user, not to history.

## Unknowns (require Designer judgment or human decision)

**U1. (POTENTIAL SHOWSTOPPER) `exercises.notes` already exists and is per-user.** The `exercises` table is per-user (every user has their own library — `src/db/schema.ts:50-52`), so the existing `exercises.notes` text column at `src/db/schema.ts:56` is effectively already a "per-(user, exercise) note". The prompt asks for a **new table** with the same semantics. Three Designer options:
   - (a) **Repurpose the existing column** — drop the new table, lift the existing `exercises.notes` rendering onto the two new surfaces, keep the existing edit screen as the edit point. Cheapest and removes the duplication risk. But it ignores the prompt's explicit "new table `exercise_notes`" instruction.
   - (b) **Build the new table as requested**, leave `exercises.notes` orphaned (still editable on the edit screen but no longer rendered anywhere) — defensible if the owner intends to deprecate `exercises.notes` later, but creates schema drift.
   - (c) **Build the new table, deprecate `exercises.notes`** in a follow-up — explicit migration story.
   - **Confidence on the diagnosis: HIGH.** The duplication is verified (file:lines above). Risk of choosing (b) without surfacing this: MEDIUM (creates two write paths for the same logical concept). **Recommendation to Conductor: surface this to the human before invoking Designer** if there's any doubt the prompt was written aware of the existing column.

**U2. PK shape for the new table.**
   - Option α: composite PK `(user_id, exercise_id)` — natural one-row-per-pair guarantee, no separate UNIQUE index. Closer to the `user_preferences` shape.
   - Option β: UUID `id` PK + UNIQUE `(user_id, exercise_id)`. Closer to `exercises` / `routine_exercises` shape. Adds a stable URL-safe identifier (useful if the note ever becomes addressable on its own, which the prompt doesn't require).
   - **Recommendation**: option α — the prompt frames the row as "the note for (user, exercise)", not "a note entity with an id". Aligns with `user_preferences`. Designer call.

**U3. Body length cap.** No DB CHECK length-cap precedent exists. Existing zod caps: 500 chars (exercise.notes), 2000 chars (routine.notes), 4000 chars (workout `sets.notes` — needs verification). Designer should pick — recommendation 2000 chars (matches routine.notes, comfortable for grip cues + warmup protocol + form reminders).

**U4. Read returns `null` vs returns empty row vs `getOrCreate`.** When the user has never edited a note for an exercise, the row does not exist. Three patterns:
   - `getMyExerciseNote(exerciseId): ExerciseNoteRow | null` — preferences precedent; UI checks for null and shows empty state. **Recommended.**
   - `getMyExerciseNote(exerciseId): ExerciseNoteRow` with auto-create — wasteful (rows for never-edited exercises).
   - Read-then-default-to-`{body: ""}` in the hook — slightly less honest but UI-friendly. Designer call.

**U5. FK behavior on exercise delete.** Today the app does not hard-delete exercises (always soft-delete via `deleted_at`). FK choices:
   - `onDelete: "restrict"` — matches `routine_exercises.exercise_id` and `sets.exercise_id`. Safest. Note stays in the DB if a hard-delete ever happens, blocking it.
   - `onDelete: "cascade"` — note dies with the exercise. Fine if hard-deletes are deliberate.
   - `onDelete: "set null"` — would orphan the note (loses the FK), bad idea.
   - **Recommendation**: cascade. Notes aren't history — they're private cues. If an exercise is gone, the cue is dead too. But "restrict" is the safer existing precedent. Designer call.

**U6. Edit affordance idiom.** Three viable patterns in the codebase:
   - (a) Inline tap-to-edit pencil → opens a bottom-sheet / modal with the textarea (analogous to per-set RPE menu).
   - (b) Pencil → push a dedicated edit screen (matches `progress.tsx` header pencil → `/exercises/[id]`).
   - (c) Inline collapsed `<Textarea>` that expands on tap and commits on blur (matches the inline name edit on `history/[id].tsx:248-256`).
   - **Recommendation**: (c) for the progress screen (low friction, no nav stack churn), (a) for `<ExerciseBlock>` on live workout (don't steal scroll focus mid-set; modal pops on demand). Designer call.

**U7. `deleted_at` on the new table.** Convention is "yes, every table". No UI surfaces soft-delete for notes today. Recommendation: include it for uniformity (every read path `.is("deleted_at", null)` already), zero cost.

**U8. Routine builder visibility.** Prompt says "independent of the routine" — does the new note ALSO render inside the routine builder (`app/(app)/routines/[id]/index.tsx`), so the user sees their cue while choosing target sets/reps? Two readings:
   - Strict: "independent of the routine" means the note's STORAGE is unrelated to routines (i.e., not a column on `routine_exercises`). The note still renders everywhere the exercise is shown.
   - Permissive: the note is intentionally scoped to the live/progress surfaces only; the routine builder is a separate context.
   - **Recommendation**: strict reading — display in the routine builder too. But the prompt's listed surfaces are only (1) progress and (2) live `<ExerciseBlock>`, so the routine builder is out of v1 scope unless the human says otherwise. Surfacing this for explicit decision.

**U9. Per-exercise queries vs batch.** On the live workout screen with 5-8 exercises, mounting 5-8 separate `useMyExerciseNote(id)` queries costs 5-8 round-trips on first paint. Cheap enough to ignore, but a `useMyExerciseNotesForExerciseIds(ids)` batch hook (one PostgREST `in.(...)` query) is the precedent set by, e.g., `useAllExercises()` (`src/hooks/use-exercises.ts:42-47`). Designer call — recommended: ship the per-id hook for simplicity, batch later if it bites.

**U10. Markdown / line breaks.** Prompt says "simple text area". Recommendation: plain text with line breaks preserved (`<Text>` with no link parsing), no markdown. Mirrors `app/(app)/history/[id].tsx:294-298` italic body text.

**U11. Empty-state copy.** When the note is empty: show an "Add a note for this exercise…" placeholder + Add button (Designer call), or hide the note slot entirely until a note is set. Recommendation: show the affordance always on the progress screen (it's a feature discovery point); hide entirely on the live `<ExerciseBlock>` (preserves vertical density during a workout). Designer call.

**U12. Unit toggle dependency.** Prompt asks if kg/lbs matters. Confidence HIGH that it does not — the note is free text. Flagging only because the prompt asked.

## Out-of-scope flags

- **Sharing notes between users** — feature is explicitly private per-user. No public/shared note surface.
- **Note history / versioning** — only the latest note per (user, exercise) is stored. `updated_at` exists but no version log.
- **Markdown rendering** (links, lists, bold) — plain text only per "simple text area" in the prompt.
- **Per-set notes** — already covered by `sets.notes` + the per-set menu at `src/components/set-row-menu.tsx`. Out of scope.
- **Routine-scoped notes** — already covered by `routine_exercises.notes`. The new feature is deliberately routine-independent.
- **Migration of `exercises.notes` data into `exercise_notes`** — see U1. Backfill / deprecation strategy is a follow-up if Designer chooses option (b) or (c).
- **Updating `seed_new_user()`** — no defaults to seed.
- **`v_exercise_progress` materialized view changes** — the note is independent of the volume/PR kernels; no shared math.
- **Routine builder note rendering** — see U8. Out of v1 unless escalated.

