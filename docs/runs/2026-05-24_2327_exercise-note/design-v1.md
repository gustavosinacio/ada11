# Design v1 — 2026-05-24_2327_exercise-note

## Goal (1 sentence)
Add a per-(user, exercise) free-text personal note, backed by a new RLS-protected `exercise_notes` table, surfaced on the exercise progress screen and on every `<ExerciseBlock>` / `<ReadOnlyExerciseBlock>` mount (live workout + history-edit + history-read).

## Approach
Mirror the `user_preferences` + `measurement_entries` precedents end-to-end: new table created via migration `0010_exercise_notes.sql`, Drizzle definition appended to `src/db/schema.ts`, snake_case `ExerciseNoteRow` added to `src/db/types.ts`, thin API at `src/api/exercise-notes.ts` with `getMyExerciseNote(exerciseId)` + `upsertMyExerciseNote(exerciseId, body)`, and a TanStack-Query hook pair at `src/hooks/use-exercise-note.ts` keyed by `["exercise_note", exerciseId, "me"]`. Rendering is unified by a single pure presenter `<ExerciseNoteSlot>` whose four mount points are: (1) the progress screen body between the summary line and the chart branch, (2) `<ExerciseBlock>`'s header — just below the header row, above the optional `<VolumeTargetSlot>`, (3) the same `<ExerciseBlock>` re-mount on history-edit (free for that surface because the component is shared), (4) `<ReadOnlyExerciseBlock>` in read-only history. Edit affordance is **commit-on-blur on an inline `<Textarea>`**, matching the inline-name editor on `history/[id].tsx:248-256` and the `<SessionTimesEditor>` pattern. The existing `exercises.notes` column is left untouched and explicitly out of scope (user mandate). Schema choice goes with **UUID `id` PK + UNIQUE partial index on `(user_id, exercise_id) WHERE deleted_at IS NULL`** (Conductor decision #1) — gives soft-delete/re-create idempotency that a composite PK couldn't.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `supabase/migrations/0010_exercise_notes.sql` | new | Create `exercise_notes` table (UUID `id`, `user_id` cascade, `exercise_id` cascade, `body text NOT NULL`, timestamps), composite index `(user_id, exercise_id)` for the read path, UNIQUE partial index `(user_id, exercise_id) WHERE deleted_at IS NULL`, enable RLS + 4 policies, attach `touch_updated_at` trigger. Mirrors `0005_measurements.sql` shape. |
| `src/db/schema.ts` | edited | Append `exerciseNotes` Drizzle table (after `measurementEntries`, before file end). FK both `user_id` and `exercise_id` with `onDelete: "cascade"`. Adds composite index + UNIQUE partial index (the partial predicate stays the source-of-truth in SQL, mirroring the `measurement_entries_user_day_idx` precedent comment at `src/db/schema.ts:211-216`). |
| `src/db/types.ts` | edited | Import `exerciseNotes`. Export `ExerciseNote = InferSelectModel<...>`, `NewExerciseNote = InferInsertModel<...>`, and snake_case `ExerciseNoteRow` matching PostgREST output. |
| `src/api/exercise-notes.ts` | new | `getMyExerciseNote(exerciseId): Promise<ExerciseNoteRow \| null>` + `upsertMyExerciseNote(exerciseId, body): Promise<ExerciseNoteRow>`. Auth-gated, `.is("deleted_at", null)`, `.maybeSingle()`. Upsert uses PostgREST `upsert` with `onConflict: "user_id,exercise_id"`. |
| `src/hooks/use-exercise-note.ts` | new | `useMyExerciseNote(exerciseId)` reader (queryKey `["exercise_note", exerciseId, "me"] as const`, `enabled: !!exerciseId`) + `useUpsertMyExerciseNote(exerciseId)` mutation (`onSuccess: (row) => qc.setQueryData(KEY, row)`). Single-row hydration — no list invalidation. |
| `src/components/exercise-note-slot.tsx` | new | Pure presenter component. Props detailed in Contracts. Renders the four UI states (read-only-present / read-only-empty-hidden / editable-present / editable-empty). Self-contained — wires `useMyExerciseNote` + `useUpsertMyExerciseNote` itself so callers only pass `{ exerciseId, editable }`. Keeps the call sites trivial. |
| `app/(app)/exercises/[id]/progress.tsx` | edited | Mount `<ExerciseNoteSlot exerciseId={id} editable={true} />` between line 138 (the summary `<Text>`) and line 140 (the `e1rmData.length === 0` branch). One responsibility: surface the note on the progress screen. |
| `src/components/exercise-block.tsx` | edited | Mount `<ExerciseNoteSlot exerciseId={exercise.id} editable={true} />` between the closing `</View>` of the header row (line 215) and the `showVolumeTarget` ternary at 217. One responsibility: surface the note inside the editable exercise block (live + history-edit). |
| `src/components/read-only-exercise-block.tsx` | edited | Mount `<ExerciseNoteSlot exerciseId={exercise.id} editable={false} />` between the closing `</View>` of the header row (line 75) and the column-header strip at line 77. One responsibility: surface the note in read-only history. Read-only-empty renders nothing (vertical density preserved). |
| `tests/rls.test.ts` | edited | Add a new arm (after the `measurement_entries` arm at line 131) covering `exercise_notes`. A creates an exercise + a note row; B's SELECT/UPDATE/DELETE on the note id must each return zero rows. |
| `tests/unit/exercise-notes-api.test.ts` | new | Unit tests for `src/api/exercise-notes.ts` against a mocked Supabase client: (1) unauth read returns `null`, (2) unauth upsert throws, (3) read returns `null` when no row, (4) upsert round-trips body verbatim, (5) `.is("deleted_at", null)` filter is applied. |
| `tests/e2e/exercise-note.spec.ts` | new | Playwright/Detox e2e: user A creates a note from the progress screen → opens a live workout containing the same exercise → note shows inline in `<ExerciseBlock>` → opens a finished session in history → note shows inline in `<ReadOnlyExerciseBlock>`. |
| `docs/data-model.md` | edited | Append `exercise_notes` to the table catalog (single short row matching the existing entries' shape). |
| `docs/decisions.md` | edited | Append ADR entry: "`exercise_notes` is a separate table, not `exercises.notes`" — short, links to U1 in discovery.md. |

## Contratos de I/O

### DB columns / migration (verbatim)

```sql
-- supabase/migrations/0010_exercise_notes.sql

create table public.exercise_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Plain composite read index — every read is gated by (user_id, exercise_id).
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
- `user_id → auth.users(id) ON DELETE CASCADE`: matches every other user-owned table in the codebase (`exercises`, `routines`, `sessions`, `sets`, `measurement_entries`). When a user is hard-deleted, their notes go with them.
- `exercise_id → exercises(id) ON DELETE CASCADE`: **deliberate divergence** from the `routine_exercises.exercise_id` / `sets.exercise_id` precedents (those use `restrict` to preserve history). Notes are private cues, not historical data — if the underlying exercise is hard-deleted, the cue is meaningless. The app uses soft-delete (`exercises.deleted_at`) for the user-visible deletion path; that flow leaves the note row untouched (the FK only fires on hard `DELETE FROM exercises`). The progress screen continues to render notes for soft-deleted exercises (the screen uses `useAllExercise(id)` which includes deleted).
- No `set null` option: would orphan the note (`exercise_id` is `NOT NULL`).

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
      .references(() => exercises.id, { onDelete: "cascade" }),
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
    // is enforced by supabase/migrations/0010_exercise_notes.sql.
    // Drizzle's typed index builder has no first-class support for partial
    // predicates — matches the measurement_entries_user_day_idx precedent
    // (schema.ts:211-216).
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

### API signatures (verbatim)

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

export async function upsertMyExerciseNote(
  exerciseId: string,
  body: string,
): Promise<ExerciseNoteRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  // PostgREST upsert keyed on the UNIQUE partial index columns. The partial
  // predicate (`WHERE deleted_at IS NULL`) is the active-row filter; rows
  // that have been soft-deleted in the past do not collide with the insert.
  // If the active row exists, body is overwritten; updated_at is refreshed
  // by the touch trigger.
  const { data, error } = await supabase
    .from("exercise_notes")
    .upsert(
      {
        user_id: userId,
        exercise_id: exerciseId,
        body,
        deleted_at: null,
      },
      { onConflict: "user_id,exercise_id" },
    )
    .select()
    .single();
  if (error) throw error;
  return data as ExerciseNoteRow;
}
```

Implementer note: PostgREST's `onConflict` does not honor partial indexes directly. If the upsert fails to match a soft-deleted (deleted_at IS NOT NULL) prior row, the next-best alternative is a read-then-update-or-insert flow — same external contract, slightly more code. The Implementer should ship the upsert call first; if running tests against a real DB reveals the partial-index collision (one user's prior soft-deleted row blocking re-creation), fall back to the read-then-write flow inside the same function. **This contingency is acceptable because the external signature does not change.**

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
   * When `true`, the slot wires an inline `<Textarea>` and commits on blur.
   * When `false`, the slot renders read-only `<Text>` — or nothing, if the
   * note is empty. The `false` path is what `<ReadOnlyExerciseBlock>` uses
   * during read-only history viewing (vertical density preserved).
   */
  editable: boolean;
};
```

State matrix:

| `editable` | `note` (string from server) | Render                                                                |
|:----------:|:----------------------------|:----------------------------------------------------------------------|
| `false`    | `null` / `""` (trimmed)     | **nothing** — return `null`. Read-only blocks stay dense.             |
| `false`    | non-empty                   | `<Text className="px-4 py-2 text-sm italic text-gray-600 dark:text-gray-400">{body}</Text>` — mirrors the `session.data.notes` rendering at `history/[id].tsx:294-298`. |
| `true`     | `null` / `""` (trimmed)     | Collapsed "Add a note for this exercise…" placeholder inside a tappable `<Textarea>` (focuses on tap; commit-on-blur creates the row only if the committed body is non-empty). |
| `true`     | non-empty                   | `<Textarea>` pre-populated with `body`. Edit-in-place, commit-on-blur. Trimmed empty commit → delete the note (server-side: `upsertMyExerciseNote(id, "")` — see edge case below). |

Edge case — empty commit: an editable surface that ends up with an empty trimmed body after blur **does not** delete the row. It writes `body: ""` (the column allows empty string, per Conductor guidance #1). UI treats `body.trim() === ""` as "no note" for display purposes; if the user wants to surface the empty state again, they simply leave the textarea empty. Hard-delete UX is deferred (no UI surface today; soft-delete on this table is supported by the schema for future use).

Self-contained data wiring: `<ExerciseNoteSlot>` calls `useMyExerciseNote(exerciseId)` + `useUpsertMyExerciseNote(exerciseId)` internally. Call sites pass only `{ exerciseId, editable }`. This keeps the four mount points to a single one-liner each and avoids prop drilling — matches the `<VolumeTargetSlot>` self-wired pattern (`exercise-block.tsx:217-222`).

Loading + error: `isLoading` renders nothing (don't flash a skeleton on every block); `isError` renders nothing on read-only, renders a small inline `<Text className="text-xs text-red-500">` retry hint on editable. Errors are also surfaced through the mutation's `isError` after a blur-commit fails (red border on the `<Textarea>` matching the existing primitive's `error` prop).

### UI surface mount points (file:line)

1. **`app/(app)/exercises/[id]/progress.tsx`** — insert between line 138 (`</Text>` closing the summary) and line 140 (`{e1rmData.length === 0 ? (`). Always editable. Renders even when the chart is empty.

2. **`src/components/exercise-block.tsx`** — insert between line 215 (closing `</View>` of the header row) and line 217 (`{showVolumeTarget ? (`). Always editable. Sits **above** `<VolumeTargetSlot>` so the layout reads: header → note → volume target → sets → add-set footer.

3. **`src/components/read-only-exercise-block.tsx`** — insert between line 75 (closing `</View>` of the header row) and line 77 (`{p.showColumnHeader ? (`). Editable=`false`. Renders nothing when no note (vertical density preserved).

4. **History-edit re-mount of `<ExerciseBlock>`** at `app/(app)/history/[id].tsx:310` — **no edit required** at this site. The slot inside `<ExerciseBlock>` (point #2 above) already covers history-edit because the same component is reused.

### Edit affordance idiom

Commit-on-blur, inline `<Textarea>`. Matches:
- `history/[id].tsx:248-256` (inline session-name editor on blur)
- `<SessionTimesEditor>` (commit-on-submit shape, blur-aware)

Specifically:
- Local state `[draft, setDraft] = useState(row?.body ?? "")`.
- `useEffect` resyncs `draft` from `row?.body` when the server row changes (TanStack hydrate or external invalidate).
- `<Textarea>` `value={draft}`, `onChangeText={setDraft}`, `onBlur={commit}`.
- `commit()`: if `draft === (row?.body ?? "")` → noop. Otherwise `mutate(draft)`.

Not chosen — bottom-sheet, dedicated screen, modal pencil (see Alternativas).

## Riscos

### Data integrity
- **RLS gap**: the new policies are gated on `auth.uid() = user_id`. The two-user arm in `tests/rls.test.ts` (deliverable #12) is the certificate. If the arm is skipped, a privilege-escalation bug could ship silently — same risk as every other RLS-protected table in this codebase, mitigated the same way.
- **UNIQUE partial index vs PostgREST upsert**: `onConflict: "user_id,exercise_id"` targets the unique index. If a row was soft-deleted in the past, the partial index excludes it, so a fresh `INSERT` should succeed — but PostgREST's upsert path may still attempt `ON CONFLICT DO UPDATE` against the full-key constraint and find no match. **Mitigation**: documented in the Implementer note above (fall back to read-then-write within the same function if integration tests show the conflict). External signature does not change.
- **Cascade on `exercise_id`**: divergence from the `restrict`-everywhere precedent for `exercise_id`. **Justified** because notes carry no historical value (private cues, not workout history) — but the Validator should flag if the divergence feels inconsistent with the codebase's preservation idiom. Counter-argument: `sets`/`routine_exercises` need `restrict` because losing them would silently break past sessions and routine plans; the note is self-contained per (user, exercise) and dies cleanly with its exercise.
- **`body text NOT NULL`**: allowing empty string (per Conductor decision #1) means downstream code must treat `body.trim() === ""` as semantically empty. The UI layer handles this in `<ExerciseNoteSlot>` (state matrix above). DB-level, no CHECK enforces non-empty — matches the no-CHECK-on-length convention at every other notes column.

### UX regressions
- **`<ExerciseBlock>` is mounted on 3 surfaces** (live workout, history-edit re-mount, and the picker-confirm rendering, if any). Adding a note row below the header changes vertical layout. Existing e2e specs that target the header positionally could fail: `tests/e2e/rest-timer-auto-start.spec.ts`, `tests/e2e/exercise-progress-ia.spec.ts`, `tests/e2e/exercise-session-row-list.spec.ts`, `tests/e2e/progress-page.spec.ts`, `tests/e2e/soft-deleted-exercises-in-history.spec.ts`, `tests/e2e/max-volume-window.spec.ts`. **Mitigation**: the empty-state on `editable === true` is a small placeholder (one-line collapsed `<Textarea>`), and on `editable === false` is `null`. Tester should sanity-run these and assert no selector relies on absolute coordinates; existing selectors use accessibility labels, so the risk is bounded.
- **Read-only history with no note renders nothing** — that's by design. If a user expects to "see the absence", they don't get a placeholder. Acceptable: matches the absence-of-`session.notes` behavior at `history/[id].tsx:294-298` (the session-notes block renders nothing when empty).
- **Progress screen note appears above the chart on first paint** even before the data resolves. Reads are independent (separate query), so the note can paint while charts are still loading. Acceptable — actually a UX win.
- **Commit-on-blur on the live workout** — if the user taps away mid-typing, the note saves automatically. Matches every other inline editor in the app (name editor, set rows). No surprise.

### Platform-specific
- React-native universal. `<Textarea>` (`src/components/ui/textarea.tsx`) is already used on iOS/Android/web. No platform divergence anticipated.
- Keyboard behavior on iOS: tapping outside the textarea must dismiss the keyboard for commit-on-blur to fire. Standard React-Native pattern; same as the inline name editor on history.
- Web: `onBlur` fires reliably; commit path identical.

### Performance
- Per-`<ExerciseBlock>` query: each block fires its own `useMyExerciseNote(exerciseId)` on mount. On the live workout (typically 5-8 exercises), that's 5-8 round-trips on first paint. **Acceptable** — Conductor guidance defers a batch endpoint; TanStack caches by exercise id so subsequent renders are free. Discovery U9 documented this. If it bites, a future `listMyNotesForExerciseIds([...])` batch hook is the upgrade path (same precedent as `useAllExercises`).
- Index cost: two indexes on a tiny table (one note per (user, exercise)). Negligible.
- Mutation flush: `onSuccess: setQueryData` updates the exact key — no cascade invalidation, no list refetch.

## Alternativas descartadas

1. **Repurpose `exercises.notes` (option α from discovery U1)** — drop the new table, lift the existing column's rendering onto the new surfaces. Cheapest path. **Descartada porque** the user explicitly chose Option 2 (new table) with a "special care" mandate. Keeps the door open for richer per-note metadata (versioning, attachments) later without overloading the exercises row.

2. **Composite PK `(user_id, exercise_id)` instead of `id` + UNIQUE partial index** — matches `user_preferences` shape, no separate UNIQUE index needed. **Descartada porque** soft-delete + re-create demands a UNIQUE *partial* constraint (excluding `deleted_at IS NOT NULL`), which is impossible with a composite PK (PKs can't be partial). The `id` + partial-UNIQUE shape is the only way to preserve the soft-delete-then-recreate idiom that every other table in this codebase supports.

3. **Edit-in-modal / bottom-sheet** — tap pencil → pop a sheet with a full-screen `<Textarea>`, save button. **Descartada porque** it adds a navigation step for a 5-word cue that the user wants to glance-at + tweak inline. Commit-on-blur matches the codebase's existing inline-edit idiom (`history/[id].tsx:248-256`).

4. **Dedicated edit screen at `/exercises/[id]/note`** — push to a new screen for editing. **Descartada porque** the progress screen header-right pencil is already taken by the "edit exercise" action, and adding a second navigation step duplicates UX with no functional gain. Also wastes nav stack depth.

5. **Render in read-only history with an "Add note" affordance** — show a tappable "+ Add note" CTA on `<ReadOnlyExerciseBlock>` when the note is empty. **Descartada porque** the read-only surface is by contract a viewing context (the screen's edit toggle gates writes). The user can tap the exercise name → progress screen → add note there (the path is one tap away).

6. **Batch endpoint `listMyNotesForExerciseIds(ids)`** — single PostgREST `in.(...)` query, one round-trip for an entire workout. **Descartada para v1** because 5-8 round-trips on first paint is comfortable in practice and TanStack dedupes/caches. The batch is a follow-up if N-query latency becomes noticeable (acceptable upgrade path — no API contract churn).

7. **Markdown rendering for notes** — render `**bold**`, lists, etc. **Descartada porque** the prompt explicitly says "simple text area"; plain text with preserved line breaks (default `<Text>` behavior) is sufficient.

8. **Surface the note in the routine builder (`app/(app)/routines/[id]/index.tsx`)** — show the user their cue while picking sets/reps. **Descartada para v1** because the prompt's listed surfaces (1) and (2) do not include the routine builder, and the routine builder already has its own `routine_exercises.notes` field which serves a different purpose. Out of scope; revisit if the human asks.

## Out of scope

- **Migrating data from `exercises.notes` into `exercise_notes`** — user mandate: leave it alone for a future cleanup pass.
- **Deprecating or removing the `<Textarea label="Notes (optional)">` on `app/(app)/exercises/[id]/index.tsx:162-174`** — that field continues to write to `exercises.notes`, which is now an orphaned data path (no render surfaces). Acceptable temporary state per user mandate.
- **Markdown rendering** (links, lists, bold).
- **Note search / filter** (no UI surface needs it).
- **Per-set notes** (already covered by `sets.notes`).
- **Routine-scoped notes** (already covered by `routine_exercises.notes`).
- **Routine builder note rendering** (out of v1; see Alternativa #8).
- **Sharing notes between users** (feature is private by design).
- **Note version history** (only the latest body per (user, exercise) is stored).
- **Batch endpoint** (`listMyNotesForExerciseIds`) — see Alternativa #6.
- **`seed_new_user()` change** — new users have no notes; the row is created lazily on first edit.
- **`v_exercise_progress` materialized view change** — the note is independent of every volume/PR kernel.

## Test plan

### Migration / schema (automated via `npm run db:reset` in CI)
- Migration runs cleanly on top of `0009_max_volume_window.sql`.
- All 4 RLS policies are present on `exercise_notes`.
- `touch_updated_at` trigger fires on UPDATE (verified by writing a row, then updating it, then comparing `updated_at`).

### RLS (`tests/rls.test.ts` — new arm)
Cover:
1. User A inserts a `(user_id=A, exercise_id=A_exercise, body="cue")` note row → returns the row.
2. User B `select('*').eq('id', noteId)` → returns 0 rows.
3. User B `update({body:"hijacked"}).eq('id', noteId).select()` → returns 0 rows.
4. User B `delete().eq('id', noteId).select()` → returns 0 rows.
5. User B `insert({user_id: A.id, exercise_id: A_exercise.id, body: "spoof"})` → fails (INSERT policy `with check (auth.uid() = user_id)` rejects).

Mirror the structure of the existing `measurement_entries` arm at `tests/rls.test.ts:88-131`.

### Unit (`tests/unit/exercise-notes-api.test.ts` — new)
Cover the `src/api/exercise-notes.ts` boundary:
1. Unauth `getMyExerciseNote("x")` returns `null` (no DB call).
2. Auth, no row: `getMyExerciseNote("x")` returns `null` (.maybeSingle → null).
3. Auth, row present: `getMyExerciseNote("x")` returns the row, filter `.is("deleted_at", null)` is applied.
4. Unauth `upsertMyExerciseNote("x","body")` throws `"Not authenticated"`.
5. Auth `upsertMyExerciseNote("x","body")` calls `.upsert(...)` with `onConflict: "user_id,exercise_id"` and returns the resulting row.

Mock the Supabase client the same way existing unit tests do (search for an existing api unit test in `tests/unit/` for the pattern).

### Hook smoke (`tests/unit/use-exercise-note.test.tsx` — optional, follow precedent)
If the codebase has hook-level unit tests for `use-preferences` (Implementer can check), mirror that shape. If not, skip — the API layer + e2e cover the same ground.

### E2E (`tests/e2e/exercise-note.spec.ts` — new)
Cover the four-surface journey:
1. From the progress screen for an exercise with no prior note, the slot renders an editable empty state.
2. User types `"grip width: shoulder-width"`, blurs → server returns the row → slot re-renders with the body.
3. User navigates to a live workout that contains the same exercise → `<ExerciseBlock>` shows the note inline.
4. User finishes the workout → opens the history detail → `<ReadOnlyExerciseBlock>` shows the note inline (italic gray-600).
5. User goes back to the progress screen → edits to `"grip width: narrow"` → blurs → server roundtrip → live workout block (re-opened) reflects the new body.
6. User edits to empty string → blurs → server stores `body: ""` → read-only surfaces render nothing → editable surfaces render the empty placeholder.

### Manual / observation
- Dark mode: italic gray-600 / gray-400 reads at the right contrast on both light + dark (already validated for `session.data.notes` italic at `history/[id].tsx:294-298`).
- Long note (>2000 chars): the inline `<Textarea>` grows; the read-only `<Text>` wraps. No truncation per Conductor decision (full note inline).
- Multi-line: line breaks preserved by `<Text>` default behavior.

## Confidence + risk

- **Confidence (overall design): HIGH.** Schema, RLS, API, hook patterns are 1:1 mirrors of `measurement_entries` + `user_preferences`. UI mount points verified against the actual file lines. The only LOW-confidence piece is the **PostgREST `onConflict` vs partial-unique-index** interaction — flagged in the Implementer note with a documented fallback that does not change the external contract.
- **Risk (overall): MEDIUM.** Concentrated in three places:
  1. The RLS test arm must be written and pass (otherwise this is a privilege-escalation vector — same risk as every new RLS table).
  2. The `exercise_id ON DELETE CASCADE` divergence from the codebase's `restrict` idiom — justified, but the Validator may want to weigh in.
  3. The e2e specs touching `<ExerciseBlock>` may need selector audits (`<ExerciseNoteSlot>` pushes content down; if any spec relies on positional layout, it will need updating). Mitigation: the existing specs use a11y labels by convention.

All other surfaces (data integrity for ordinary reads/writes, platform behavior, performance) are LOW-risk.
