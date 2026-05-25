# Design v2 — 2026-05-24_2327_exercise-note

## Diff from v1

Every change driven by `validation-v1.md`. Numbering matches the Validator's findings.

1. **BLK-1 — `.upsert()` removed.** `upsertMyExerciseNote` is rewritten as **read-then-write** (SELECT active row by `(user_id, exercise_id, deleted_at IS NULL)` → if present `UPDATE` by `id`; if absent `INSERT`; on 23505 from concurrent writer, recurse once). No `onConflict` parameter. Removes the deterministic 42P10 failure against the partial unique index. Precedent: `src/api/measurements.ts:121-159` (explicit `INSERT` + `error.code === "23505"` discrimination — re-cited correctly per MIN-3).
2. **MAJ-1 — Body length cap = 2000 chars at 3 layers.** zod `body: z.string().max(2000)` inside `<ExerciseNoteSlot>` pre-mutate, `maxLength={2000}` prop on the `<Textarea>`, and a DB-level `check (char_length(body) <= 2000)` constraint in `0010_exercise_notes.sql`. Matches the `routine.notes` zod cap.
3. **MAJ-2 — `exercise_id` FK switched to `ON DELETE RESTRICT`.** Aligns with `routine_exercises.exercise_id` + `sets.exercise_id`. Drizzle + SQL updated. Rationale updated.
4. **MIN-1 — Collapsed "+ Add note" affordance.** When `<ExerciseBlock>` mounts with `editable={true}` AND no note exists, the slot renders a single-line tappable `<Pressable>` showing `+ Add note`. On tap, local `expanded` state flips and the full `<Textarea>` appears with autofocus. On progress screen, the slot still renders the full `<Textarea>` empty (vertical density not a constraint there). Documented in the props/states matrix.
5. **MIN-3 — Precedent citation corrected.** `measurements.ts:121-159` is the explicit-`INSERT` + SQLSTATE-23505 precedent, NOT a `.upsert()` precedent. The codebase has zero `.upsert()` callers.
6. **MIN-4 — `tests/rls.test.ts` arm format clarified.** The arm is a sequence of `await` blocks in node:test style (no `describe/it`), mirroring the `measurement_entries` arm at lines 88-131 verbatim.
7. **MIN-5 — Hook-smoke test marked deterministically skipped.** Vitest config excludes `.tsx`. API unit + e2e cover the hook surface; no hook test will be written.
8. **MIN-6 — Empty-body display rule documented once.** `<ExerciseNoteSlot>` is the single source-of-truth for "`body === "" → display as no-note`". No consumer carries the rule.
9. **MIN-7 — Slot loading semantics pinned.** `<ExerciseNoteSlot>` returns `null` while its own `useMyExerciseNote` is `isLoading`, so a slow note query never reflows the host page.
10. **MIN-2 — pre-existing `keyboardShouldPersistTaps` gap acknowledged in Test plan only.** Out of scope for this change.

Full restated design follows below — no need to cross-reference v1.

---

## Goal (1 sentence)

Add a per-(user, exercise) free-text personal note, backed by a new RLS-protected `exercise_notes` table, surfaced on the exercise progress screen and on every `<ExerciseBlock>` / `<ReadOnlyExerciseBlock>` mount (live workout + history-edit + history-read).

## Approach

Mirror the `user_preferences` + `measurement_entries` precedents end-to-end. New table created via migration `0010_exercise_notes.sql`, Drizzle definition appended to `src/db/schema.ts`, snake_case `ExerciseNoteRow` added to `src/db/types.ts`, thin API at `src/api/exercise-notes.ts` exposing `getMyExerciseNote(exerciseId)` and `upsertMyExerciseNote(exerciseId, body)` (read-then-write — no PostgREST `.upsert()`), and a TanStack-Query hook pair at `src/hooks/use-exercise-note.ts` keyed by `["exercise_note", exerciseId, "me"]`. Rendering is unified by a single self-wired presenter `<ExerciseNoteSlot>` mounted in four places: (1) the progress screen body between the summary line and the chart branch, (2) `<ExerciseBlock>` between header and `<VolumeTargetSlot>`, (3) `<ReadOnlyExerciseBlock>` between header and the column-header strip, (4) the history-edit re-mount of `<ExerciseBlock>` (no extra wiring — the same component is reused). Edit affordance is **commit-on-blur on an inline `<Textarea>` capped at 2000 chars**; on `<ExerciseBlock>` the empty-editable state collapses to a single-line `+ Add note` `Pressable` that expands on tap. The existing `exercises.notes` column is left untouched per user mandate. Schema choice: **UUID `id` PK + UNIQUE partial index on `(user_id, exercise_id) WHERE deleted_at IS NULL`** for soft-delete idempotency.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `supabase/migrations/0010_exercise_notes.sql` | new | Create `exercise_notes` (UUID `id`, `user_id` cascade, `exercise_id` RESTRICT, `body text NOT NULL` with `CHECK (char_length(body) <= 2000)`, timestamps), composite read index `(user_id, exercise_id)`, UNIQUE partial index `(user_id, exercise_id) WHERE deleted_at IS NULL`, enable RLS + 4 inlined policies, attach `touch_updated_at` trigger. Mirrors `0005_measurements.sql` shape. |
| `src/db/schema.ts` | edited | Append `exerciseNotes` Drizzle table (after `measurementEntries`). FK `user_id` cascade; FK `exercise_id` RESTRICT (matches sibling-table precedent). Composite index in Drizzle; the UNIQUE partial index + CHECK constraint stay in the SQL source-of-truth (Drizzle has no first-class support for partial-predicate indexes or column-level CHECK without raw SQL — matches the `measurement_entries_user_day_idx` precedent at `schema.ts:211-216`). |
| `src/db/types.ts` | edited | Import `exerciseNotes`. Export `ExerciseNote = InferSelectModel<typeof exerciseNotes>`, `NewExerciseNote = InferInsertModel<typeof exerciseNotes>`, and snake_case `ExerciseNoteRow`. |
| `src/api/exercise-notes.ts` | new | `getMyExerciseNote(exerciseId): Promise<ExerciseNoteRow \| null>` + `upsertMyExerciseNote(exerciseId, body): Promise<ExerciseNoteRow>` implemented as **read-then-write**. Auth-gated, `.is("deleted_at", null)`, `.maybeSingle()`. On `INSERT` collision with SQLSTATE 23505 (concurrent writer race), recurse once. |
| `src/hooks/use-exercise-note.ts` | new | `useMyExerciseNote(exerciseId)` reader (queryKey `["exercise_note", exerciseId, "me"] as const`, `enabled: !!exerciseId`) + `useUpsertMyExerciseNote(exerciseId)` mutation (`onSuccess: (row) => qc.setQueryData(KEY, row)`). |
| `src/components/exercise-note-slot.tsx` | new | Pure presenter component. Self-wires `useMyExerciseNote` + `useUpsertMyExerciseNote`. Owns the empty-body display rule, the 2-state editable affordance (collapsed `+ Add note` ↔ expanded `<Textarea>`), the 2000-char zod guard, and the `isLoading → null` rule. |
| `app/(app)/exercises/[id]/progress.tsx` | edited | Mount `<ExerciseNoteSlot exerciseId={id} editable={true} />` between line 138 (summary `</Text>`) and line 140 (chart branch). One responsibility: surface the note on progress. |
| `src/components/exercise-block.tsx` | edited | Mount `<ExerciseNoteSlot exerciseId={exercise.id} editable={true} />` between line 215 (header `</View>`) and line 217 (`{showVolumeTarget ? (`). One responsibility: surface the note inside the editable exercise block (live + history-edit). |
| `src/components/read-only-exercise-block.tsx` | edited | Mount `<ExerciseNoteSlot exerciseId={exercise.id} editable={false} />` between line 75 (header `</View>`) and line 77 (column-header strip). One responsibility: surface the note read-only. |
| `tests/rls.test.ts` | edited | Add `exercise_notes` arm after the `measurement_entries` arm (line 131), node:test style — sequence of `await` blocks mirroring lines 88-131 verbatim. |
| `tests/unit/exercise-notes-api.test.ts` | new | Unit tests for `src/api/exercise-notes.ts` against a mocked Supabase client. Covers read-then-write branches (no row → INSERT; row exists → UPDATE; 23505 race → retry). |
| `tests/e2e/exercise-note.spec.ts` | new | E2E covering all four mount points + 2000-char enforcement + collapsed/expanded affordance on `<ExerciseBlock>`. |
| `docs/data-model.md` | edited | Append `exercise_notes` to the catalog. |
| `docs/decisions.md` | edited | ADR: "`exercise_notes` is a separate table from `exercises.notes`" — short, links to U1 in discovery. |

## Contratos de I/O

### DB columns / migration (verbatim)

```sql
-- supabase/migrations/0010_exercise_notes.sql

create table public.exercise_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  body text not null check (char_length(body) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Composite read index — every read is gated by (user_id, exercise_id).
create index exercise_notes_user_exercise_idx
  on public.exercise_notes (user_id, exercise_id);

-- One active note per (user, exercise). Soft-deleted rows are excluded so a
-- user can re-create after delete (matches measurement_entries_user_day_idx
-- semantics from 0005).
create unique index exercise_notes_user_exercise_active_uq
  on public.exercise_notes (user_id, exercise_id)
  where deleted_at is null;

-- RLS — enable + 4 inlined policies, gated on auth.uid() = user_id.
alter table public.exercise_notes enable row level security;

drop policy if exists exercise_notes_select on public.exercise_notes;
create policy exercise_notes_select on public.exercise_notes
  for select using (auth.uid() = user_id);

drop policy if exists exercise_notes_insert on public.exercise_notes;
create policy exercise_notes_insert on public.exercise_notes
  for insert with check (auth.uid() = user_id);

drop policy if exists exercise_notes_update on public.exercise_notes;
create policy exercise_notes_update on public.exercise_notes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists exercise_notes_delete on public.exercise_notes;
create policy exercise_notes_delete on public.exercise_notes
  for delete using (auth.uid() = user_id);

-- touch_updated_at trigger (function exists since 0001).
drop trigger if exists exercise_notes_touch_updated_at on public.exercise_notes;
create trigger exercise_notes_touch_updated_at
  before update on public.exercise_notes
  for each row execute function public.touch_updated_at();
```

**Cascade rationale**:
- `user_id → auth.users(id) ON DELETE CASCADE`: matches every other user-owned table in the codebase (`exercises`, `routines`, `sessions`, `sets`, `measurement_entries`).
- `exercise_id → exercises(id) ON DELETE RESTRICT`: **matches the sibling-table precedent** (`routine_exercises.exercise_id`, `sets.exercise_id` at `schema.ts:93, 145`). The app today only soft-deletes exercises (sets `deleted_at`), which does not fire the FK. If a future migration introduces hard-delete, that migration decides how notes are disposed of (likely soft-delete in the same transaction).
- No `set null` option: `exercise_id` is `NOT NULL`.

**CHECK constraint rationale**: `char_length(body) <= 2000` is defense-in-depth against bypassing the zod guard. No existing migration in the codebase carries a length CHECK (`grep "length(" supabase/migrations/` returns 0 hits), but no migration explicitly rejects them either. The cost is one O(1) check on INSERT/UPDATE — negligible.

### Drizzle schema (verbatim)

```ts
// src/db/schema.ts — appended after measurementEntries

export const exerciseNotes = pgTable(
  "exercise_notes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    ...timestamps,
  },
  (t) => ({
    userExerciseIdx: index("exercise_notes_user_exercise_idx").on(
      t.userId,
      t.exerciseId,
    ),
    // The UNIQUE partial index
    //   (user_id, exercise_id) WHERE deleted_at IS NULL
    // and the CHECK (char_length(body) <= 2000) constraint live in
    // supabase/migrations/0010_exercise_notes.sql. Drizzle's typed
    // builders have no first-class support for partial predicates or
    // column-level CHECK — matches measurement_entries_user_day_idx
    // precedent (schema.ts:211-216).
  }),
);
```

### Row + insert types (verbatim)

```ts
// src/db/types.ts — appended

export type ExerciseNote = InferSelectModel<typeof exerciseNotes>;
export type NewExerciseNote = InferInsertModel<typeof exerciseNotes>;

export type ExerciseNoteRow = {
  id: string;
  user_id: string;
  exercise_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
```

### API signatures (verbatim) — read-then-write

```ts
// src/api/exercise-notes.ts

import { supabase } from "~/lib/supabase";
import type { ExerciseNoteRow } from "~/db/types";

export async function getMyExerciseNote(
  exerciseId: string,
): Promise<ExerciseNoteRow | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("exercise_notes")
    .select("*")
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as ExerciseNoteRow | null) ?? null;
}

/**
 * Read-then-write. PostgREST `.upsert()` is intentionally avoided because
 * `ON CONFLICT (cols)` cannot infer a *partial* unique index without a
 * `WHERE` predicate, and PostgREST's `onConflict` parameter does not
 * forward predicates — so an `.upsert(..., { onConflict: "user_id,exercise_id" })`
 * call against this table's partial UNIQUE index fails deterministically
 * with `42P10: there is no unique or exclusion constraint matching the
 * ON CONFLICT specification`. The pattern below matches the explicit
 * INSERT + SQLSTATE 23505 discriminator precedent at
 * src/api/measurements.ts:121-159.
 *
 * Race semantics: between SELECT and INSERT, a concurrent writer (another
 * tab / device for the same user) may insert a row. The INSERT then trips
 * the partial UNIQUE index → 23505. We retry once — the next iteration's
 * SELECT will find the row and switch to UPDATE.
 */
export async function upsertMyExerciseNote(
  exerciseId: string,
  body: string,
): Promise<ExerciseNoteRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { data: existing, error: selErr } = await supabase
    .from("exercise_notes")
    .select("*")
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId)
    .is("deleted_at", null)
    .maybeSingle();
  if (selErr) throw selErr;

  if (existing) {
    const { data, error } = await supabase
      .from("exercise_notes")
      .update({ body })
      .eq("id", (existing as ExerciseNoteRow).id)
      .select()
      .single();
    if (error) throw error;
    return data as ExerciseNoteRow;
  }

  const { data, error } = await supabase
    .from("exercise_notes")
    .insert({ user_id: userId, exercise_id: exerciseId, body })
    .select()
    .single();
  if (error) {
    // Concurrent writer created the row between our SELECT and INSERT.
    // Retry once — the SELECT in the next call will pick the row up and
    // route to UPDATE. No unbounded loop: the retry's INSERT path is
    // unreachable once an active row exists.
    if ((error as { code?: string }).code === "23505") {
      return upsertMyExerciseNote(exerciseId, body);
    }
    throw error;
  }
  return data as ExerciseNoteRow;
}
```

### Hook signatures (verbatim)

```ts
// src/hooks/use-exercise-note.ts

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getMyExerciseNote,
  upsertMyExerciseNote,
} from "~/api/exercise-notes";
import type { ExerciseNoteRow } from "~/db/types";

const KEYS = {
  detail: (exerciseId: string) =>
    ["exercise_note", exerciseId, "me"] as const,
};

export function useMyExerciseNote(exerciseId: string | undefined | null) {
  return useQuery({
    queryKey: KEYS.detail(exerciseId ?? ""),
    queryFn: () => getMyExerciseNote(exerciseId as string),
    enabled: !!exerciseId,
  });
}

export function useUpsertMyExerciseNote(exerciseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => upsertMyExerciseNote(exerciseId, body),
    onSuccess: (row) => qc.setQueryData(KEYS.detail(exerciseId), row),
  });
}
```

### `<ExerciseNoteSlot>` props + states (verbatim)

```ts
// src/components/exercise-note-slot.tsx

type Props = {
  exerciseId: string;
  /**
   * When true, the slot wires an inline editor and commits on blur.
   * When false, the slot renders read-only Text — or nothing, if the
   * stored body trims to empty. The false path is what
   * <ReadOnlyExerciseBlock> uses during read-only history viewing.
   */
  editable: boolean;
  /**
   * When true, force the full <Textarea> in the empty-editable state.
   * The progress screen passes this. <ExerciseBlock> does not, so it
   * gets the collapsed "+ Add note" affordance (vertical density).
   */
  alwaysExpanded?: boolean;
};
```

**Body length cap** (3 layers — defense in depth):

1. zod inside the slot before `mutate()`:
   ```ts
   const noteSchema = z.string().max(2000);
   const parsed = noteSchema.safeParse(draft);
   if (!parsed.success) { /* show inline error, do not commit */ return; }
   ```
2. `maxLength={2000}` prop on `<Textarea>` (prevents typing past the limit on iOS/Android/web).
3. DB CHECK `char_length(body) <= 2000` (final defense; rejects anything that bypasses the client).

**Empty-body display rule** (single source-of-truth — documented here ONCE; no consumer carries it):
- "Empty" means `row === null || row.body.trim() === ""`.
- Read-only surfaces render `null` when empty.
- Editable surfaces render the empty placeholder (collapsed or full per `alwaysExpanded`).
- Mutations that produce an empty trimmed body still write `body: ""` (no soft-delete UX today); the row stays so the user can re-edit without re-creating.

**Loading semantics** (MIN-7 — pinned):
- `useMyExerciseNote(exerciseId).isLoading === true` → slot returns `null`. No skeleton, no reflow. A slow note query never pushes the rest of the host page down.
- `isError` on the read: read-only surfaces render `null`; editable surfaces render a small `text-xs text-red-500` retry hint inline.
- `isError` on the mutate (post-blur): the `<Textarea>` shows its `error` prop (red border per the primitive's existing API).

**State matrix**:

| `editable` | `alwaysExpanded` | `body` (trimmed) | Render |
|:---:|:---:|:---|:---|
| `false` | — | empty | `null` (read-only blocks stay dense) |
| `false` | — | non-empty | `<Text className="px-4 py-2 text-sm italic text-gray-600 dark:text-gray-400">{body}</Text>` (mirrors `history/[id].tsx:294-298` italic) |
| `true` | `false` (default — `<ExerciseBlock>`) | empty | Collapsed `<Pressable className="px-4 py-2"><Text className="text-sm text-blue-600 dark:text-blue-400">+ Add note</Text></Pressable>`. Tap sets local `expanded=true`, focuses the `<Textarea>` |
| `true` | `false`, after tap (`expanded=true`) | empty | `<Textarea autoFocus value={draft} onChangeText={setDraft} onBlur={commit} maxLength={2000} placeholder="Add a note for this exercise…" />`. If `draft.trim() === ""` on blur, slot collapses back to the `+ Add note` `Pressable` and skips the mutate |
| `true` | `true` (progress screen) | empty | `<Textarea value={draft} onChangeText={setDraft} onBlur={commit} maxLength={2000} placeholder="Add a note for this exercise…" />` always rendered (no collapse) |
| `true` | — | non-empty | `<Textarea value={draft} onChangeText={setDraft} onBlur={commit} maxLength={2000} />` pre-populated with `body`. Edit-in-place, commit-on-blur. Trimmed empty commit writes `body: ""` (UI then displays per the empty rule) |

**Commit-on-blur**:
- Local state `[draft, setDraft] = useState(row?.body ?? "")`.
- `useEffect` resyncs `draft` from `row?.body` when the server row changes (TanStack hydrate or external invalidate).
- `commit()`: if `draft === (row?.body ?? "")` → noop. Otherwise validate via zod, `mutate(draft)`.

**Self-wired**: call sites pass only `{ exerciseId, editable, alwaysExpanded? }`. No prop drilling. Matches `<VolumeTargetSlot>` self-wired pattern (`exercise-block.tsx:217-222`).

### UI surface mount points (file:line)

1. **`app/(app)/exercises/[id]/progress.tsx`** — insert between line 138 (`</Text>` summary) and line 140 (chart branch). Props: `editable={true} alwaysExpanded={true}`.
2. **`src/components/exercise-block.tsx`** — insert between line 215 (header `</View>`) and line 217 (`{showVolumeTarget ? (`). Props: `editable={true}` (no `alwaysExpanded` — collapsed empty state).
3. **`src/components/read-only-exercise-block.tsx`** — insert between line 75 (header `</View>`) and line 77 (column-header strip). Props: `editable={false}`.
4. **History-edit re-mount of `<ExerciseBlock>`** at `app/(app)/history/[id].tsx:310` — no extra wiring; mount point #2 covers it because `<ExerciseBlock>` is reused.

## Riscos

### Data integrity
- **RLS gap**: the new policies are gated on `auth.uid() = user_id`. The two-user arm in `tests/rls.test.ts` is the certificate. Same mitigation pattern as every other RLS-protected table.
- **Read-then-write race**: between SELECT and INSERT, a concurrent writer (another tab) may insert a row first. Handled by the explicit 23505 catch + single recursive retry. The retry is bounded: after the race-winner's INSERT lands, the loser's next-iteration SELECT finds the active row and routes to UPDATE — no INSERT collision possible.
- **`exercise_id ON DELETE RESTRICT`**: matches the sibling-table precedent. The app's soft-delete path (`exercises.deleted_at`) does not fire the FK; only a hard `DELETE FROM exercises` would. No such code path exists today. If introduced later, that migration decides note disposition.
- **2000-char body cap at DB level**: enforced by the CHECK constraint. Even if a future caller bypasses the API layer (e.g., a bulk-import script), the DB rejects the row. Cost is O(1) per write.
- **Empty body persisted as `body = ""`**: documented in the empty-body display rule. Consumers do not branch — `<ExerciseNoteSlot>` is the only place that interprets the empty.

### UX regressions
- **`<ExerciseBlock>` mount surfaces**: live workout, history-edit, picker-confirm (if any). Adding a single tappable `+ Add note` row when empty (collapsed) or a `<Textarea>` row when populated changes layout. e2e specs that touch the block (`tests/e2e/rest-timer-auto-start.spec.ts`, `tests/e2e/exercise-progress-ia.spec.ts`, `tests/e2e/exercise-session-row-list.spec.ts`, `tests/e2e/progress-page.spec.ts`, `tests/e2e/soft-deleted-exercises-in-history.spec.ts`, `tests/e2e/max-volume-window.spec.ts`) should be sanity-run by Tester. Selectors use a11y labels by convention, so the risk is bounded.
- **Read-only history with no note**: renders nothing. Matches the absence-of-`session.notes` behavior at `history/[id].tsx:294-298`.
- **Commit-on-blur on live workout**: tapping away mid-typing saves automatically. Matches every inline editor in the app.
- **Collapsed `+ Add note` discoverability**: the affordance is one tap to expand. Tester should confirm tap area is comfortable (target ≥ 44pt on iOS).
- **2000-char hard cap**: a user pasting a long blob beyond 2000 chars sees the input silently truncate (RN `<TextInput maxLength>` is a hard limit). Acceptable; matches `routine.notes` UX.

### Platform-specific
- React-native universal. `<Textarea>` (`src/components/ui/textarea.tsx`) is already used on iOS/Android/web.
- iOS keyboard dismissal: tap outside must dismiss for `onBlur` to fire. Standard RN pattern; same as inline name editor on history.
- Web: `onBlur` fires reliably.
- `<Pressable>` for collapsed affordance: works identically across platforms; `hitSlop` not required since the row is a full-width line.

### Performance
- Per-`<ExerciseBlock>` query: each block fires its own `useMyExerciseNote(exerciseId)`. On a typical 5-8 exercise live workout, that's 5-8 round-trips on first paint. TanStack caches by id so subsequent renders are free. Discovery U9 documented this trade-off; batch endpoint is a future upgrade with no contract churn.
- Read-then-write is 1 extra round-trip vs `.upsert()` on the write path (SELECT + INSERT-or-UPDATE = 2 RTs vs 1). Acceptable for a low-frequency interaction (the user edits a note once in a while, not in a hot loop). The reliability win dominates.
- Index cost: 2 indexes on a tiny table. Negligible.
- Mutation flush: `onSuccess: setQueryData` updates the exact key — no cascade invalidation.

## Alternativas descartadas

1. **PostgREST `.upsert({ onConflict: "user_id,exercise_id" })`** — single round-trip, declarative. **Descartada porque** `ON CONFLICT (cols)` cannot infer a partial unique index without a `WHERE` predicate, and PostgREST does not forward predicates through `onConflict`. The call fails deterministically with PostgreSQL `42P10`. Verified against PG docs and the (empty) `.upsert()` usage grep in this repo. Read-then-write is the correct pattern (BLK-1).
2. **Repurpose `exercises.notes`** — drop the new table; lift the existing column onto the new surfaces. **Descartada porque** user explicitly chose Option 2 (new table) with a "special care" mandate. Keeps the door open for richer per-note metadata later.
3. **Composite PK `(user_id, exercise_id)`** instead of `id` + UNIQUE partial. **Descartada porque** soft-delete + re-create demands a UNIQUE *partial* constraint, which a PK cannot be. The `id` + partial-UNIQUE shape preserves the soft-delete-then-recreate idiom.
4. **`exercise_id ON DELETE CASCADE`** (v1's choice). **Descartada porque** the v1 cascade had zero behavioral benefit today (no hard-delete UI) and silently destroys user-authored notes if a future hard-delete is introduced. RESTRICT matches the sibling-table precedent and forces any future hard-delete migration to make the disposition decision explicitly.
5. **Edit-in-modal / bottom-sheet** — tap pencil → pop a sheet. **Descartada porque** it adds nav for a 5-word cue. Commit-on-blur matches existing inline-edit idiom.
6. **Dedicated edit screen at `/exercises/[id]/note`**. **Descartada porque** the progress screen header-right pencil is already taken; second nav step adds no value.
7. **"+ Add note" affordance on read-only history**. **Descartada porque** read-only is a viewing context by contract.
8. **Batch endpoint `listMyNotesForExerciseIds(ids)`** — single PostgREST `in.(...)` query. **Descartada para v1** because 5-8 RTs first-paint is comfortable and TanStack dedupes. Future upgrade with no contract churn.
9. **Markdown rendering** for notes. **Descartada porque** prompt says "simple text area".
10. **Surface the note in the routine builder**. **Descartada para v1** because the prompt does not list it; routine builder has its own `routine_exercises.notes`. Revisit if asked.
11. **No DB CHECK on body length** (rely on zod + `maxLength` only). **Descartada porque** defense-in-depth — a future bulk-import script or RLS-bypassed write path would otherwise be unbounded. The CHECK is O(1).
12. **Skip the collapsed `+ Add note` affordance on `<ExerciseBlock>`** (render full empty `<Textarea>`). **Descartada porque** 96-120px × 5-8 blocks = ~600-960px of empty vertical space on the live workout screen — unacceptable density loss. The collapsed affordance is a single-line tap target.

## Out of scope

- Migrating data from `exercises.notes` into `exercise_notes` (user mandate).
- Deprecating the `<Textarea label="Notes (optional)">` on `app/(app)/exercises/[id]/index.tsx:162-174` (continues to write to `exercises.notes`, now orphaned — acceptable temporary state).
- Markdown rendering.
- Note search / filter.
- Per-set notes (covered by `sets.notes`).
- Routine-scoped notes (covered by `routine_exercises.notes`).
- Routine builder note rendering.
- Sharing notes between users.
- Note version history.
- Batch endpoint.
- `seed_new_user()` change.
- `v_exercise_progress` view change.
- Pre-existing `keyboardShouldPersistTaps` gap on `app/(app)/workout/[sessionId].tsx:424` (MIN-2) — noted by Validator, but not introduced by this change.

## Test plan

### Migration / schema (automated via `npm run db:reset` in CI)
- Migration runs cleanly on top of `0009_max_volume_window.sql`.
- All 4 RLS policies present on `exercise_notes`.
- `touch_updated_at` trigger fires on UPDATE.
- CHECK constraint rejects a 2001-char body (verify via direct SQL INSERT with `' '.repeat(2001)`).
- Partial UNIQUE index permits re-INSERT after a soft-delete.

### RLS (`tests/rls.test.ts` — new arm)

**Format**: node:test style. Sequence of `await` blocks appended after the `measurement_entries` arm (line 131). Mirrors lines 88-131 verbatim, swapping `measurement_entries` → `exercise_notes` and the row shape. No `describe`/`it`/vitest scaffolding.

Cover:
1. User A inserts a note row for an exercise A owns → returns the row.
2. User B `select('*').eq('id', noteId)` → 0 rows.
3. User B `update({body:"hijacked"}).eq('id', noteId).select()` → 0 rows.
4. User B `delete().eq('id', noteId).select()` → 0 rows.
5. User B `insert({user_id: A.id, exercise_id: A_exercise.id, body: "spoof"})` → fails (INSERT policy `with check (auth.uid() = user_id)` rejects).

### Unit (`tests/unit/exercise-notes-api.test.ts` — new)

Mock the Supabase client. Cover:
1. Unauth `getMyExerciseNote("x")` → returns `null`, no DB call.
2. Auth, no row → returns `null` (`.maybeSingle()` returns `null`).
3. Auth, row present → returns the row; `.is("deleted_at", null)` filter is applied.
4. Unauth `upsertMyExerciseNote("x","body")` → throws `"Not authenticated"`.
5. Auth, no existing row → SELECT (no row) → INSERT → returns the inserted row.
6. Auth, existing row → SELECT (row) → UPDATE by `id` → returns the updated row.
7. Auth, race scenario: SELECT (no row) → INSERT errors with `{ code: "23505" }` → recursive call → SELECT (row from race winner) → UPDATE → returns final row. Verify the recursion runs exactly once and terminates.
8. Auth, INSERT with non-23505 error → throws.

### Hook smoke
**Skipped deterministically.** Vitest config excludes `.tsx`; no hook-test infrastructure exists for this app. API unit + e2e cover the surface.

### E2E (`tests/e2e/exercise-note.spec.ts` — new)
1. Progress screen, no prior note → slot renders an editable empty `<Textarea>` (`alwaysExpanded=true`).
2. Type `"grip width: shoulder-width"`, blur → server returns row → slot re-renders with body.
3. Navigate to live workout containing the same exercise → `<ExerciseBlock>` shows the note inline (populated `<Textarea>`).
4. Live workout, a different exercise with no note → `<ExerciseBlock>` shows the collapsed `+ Add note` row. Tap → `<Textarea>` expands and autofocuses. Type → blur → re-renders populated. Re-mount → still populated.
5. Live workout, empty `+ Add note` tap → expand → leave blank → blur → collapses back, no mutate fired (verify by inspecting network mock count).
6. Finish the workout → open history detail → `<ReadOnlyExerciseBlock>` shows the note inline (italic gray-600).
7. History detail, exercise with no note → `<ReadOnlyExerciseBlock>` renders nothing for the slot.
8. Edit a note to `"x".repeat(2500)` → `<Textarea>` accepts up to 2000 chars (`maxLength`) → blur commits 2000-char body → server returns success.
9. Bypass zod in test harness, try to write 2001-char body through API directly → expect PG CHECK violation surfaced.

### Manual / observation
- Dark mode: italic gray-600 / gray-400 contrast on light + dark — already validated at `history/[id].tsx:294-298`.
- Multi-line: `<Text>` preserves line breaks by default.
- iOS keyboard dismissal triggers `onBlur` correctly.
- Tap target on collapsed `+ Add note`: ≥ 44pt vertical.

## Resposta a issues do Validator

- **[BLK-1] — `.upsert()` against partial unique index**: removed entirely. `upsertMyExerciseNote` is now read-then-write — SELECT active row → UPDATE by `id` if present, INSERT if absent, retry once on 23505 (race). Precedent cited correctly as `src/api/measurements.ts:121-159` (explicit INSERT + SQLSTATE 23505). Rationale for rejecting `.upsert()` documented in the JSDoc above the function (PG 42P10 deterministic failure; PostgREST does not forward partial-index `WHERE` predicates).
- **[MAJ-1] — Body length cap = 2000 chars**: enforced at 3 layers — zod `z.string().max(2000)` inside `<ExerciseNoteSlot>` pre-mutate, `maxLength={2000}` on `<Textarea>`, DB `CHECK (char_length(body) <= 2000)` in `0010_exercise_notes.sql`. Matches `routine.notes` cap.
- **[MAJ-2] — `exercise_id` FK switched to `ON DELETE RESTRICT`**: matches `routine_exercises.exercise_id` + `sets.exercise_id`. Drizzle + SQL updated. Rationale: "matches sibling-table precedent; if hard-delete is later introduced, that migration decides note disposition".
- **[MIN-1] — Collapsed `+ Add note` affordance**: implemented as a `<Pressable>` single-line row on `<ExerciseBlock>` when `editable=true` AND body is empty. Tap sets local `expanded=true` → full `<Textarea>` with autofocus. Progress screen keeps the full empty `<Textarea>` via `alwaysExpanded={true}` (vertical density not a constraint there). 2-state UX documented in the state matrix.
- **[MIN-2] — `keyboardShouldPersistTaps` on live workout `ScrollView`**: pre-existing; noted in Test plan but not modified.
- **[MIN-3] — Precedent citation corrected**: `measurements.ts:121-159` is the explicit-INSERT + SQLSTATE 23505 precedent, not a `.upsert()` precedent. The codebase has zero `.upsert()` callers.
- **[MIN-4] — `tests/rls.test.ts` arm format**: clarified as node:test sequence of `await` blocks, mirroring lines 88-131 verbatim.
- **[MIN-5] — Hook smoke**: deterministically skipped — vitest excludes `.tsx`; API unit + e2e cover.
- **[MIN-6] — Empty-body display rule**: documented ONCE inside `<ExerciseNoteSlot>` (single source-of-truth). Consumers never branch.
- **[MIN-7] — Slot loading semantics**: `<ExerciseNoteSlot>` returns `null` while its own `useMyExerciseNote` is `isLoading`. No skeleton, no reflow.

## Confidence + risk

- **Confidence (overall design): HIGH.** Read-then-write closes BLK-1's deterministic failure. All other shapes (schema, RLS, hook keys, mount points) are 1:1 mirrors of `measurement_entries` + `user_preferences` and are verified against file:line. The 23505 race retry is bounded by construction.
- **Risk (overall): LOW-MEDIUM.** Concentrated in:
  1. RLS test arm must be written and pass (same risk as every new RLS table).
  2. E2E specs touching `<ExerciseBlock>` may need a sanity audit if any selector is positional (convention is a11y labels — risk bounded).
  3. The 23505 retry path is single-recursive and bounded but should be unit-tested explicitly (covered in test plan #7).
