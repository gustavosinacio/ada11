# Discovery — 2026-05-20_1657_remove-exercise-from-session

## Feature prompt

First open item in `docs/features.md` (line 3):

> "Allow user to remove exercise from current session in progress."

Owner context (from Conductor): mid-workout in the live session screen, user wants to drop an exercise entirely (skipped, added by mistake, ran out of time and wants to clean the record before finishing). Today there is no affordance — only individual sets can be removed (`SetInput` trash icon → `useDeleteSet()` → soft-delete one row).

## Scope summary

Add a per-exercise "remove" affordance inside `<ExerciseBlock>` while it is rendered by the live session screen (`app/(app)/workout/[sessionId].tsx`). "Removing an exercise from a session" has no dedicated table — the relationship is implicit via `sets.session_id + sets.exercise_id`. Removing means (a) soft-deleting every non-deleted set this exercise has in this session, and (b) hiding the exercise from the live session's exercise list. Because the live list is hydrated from three sources (routine_exercises, sets-with-rows, `adHocExerciseIds` local state), the suppression mechanism must cover all three. Identical concern, smaller surface, applies to the history detail screen (`app/(app)/history/[id].tsx`) which reuses the same `<ExerciseBlock>`.

## Affected files (verified)

- `app/(app)/workout/[sessionId].tsx:1-303` — live session screen. Computes `orderedExercises` (lines 71-131) from three sources: `routineExercisesQ.data` (DB), `setsQ.data` (DB), `adHocExerciseIds` (component state). Renders one `<ExerciseBlock>` per exercise (lines 211-255) wired to `useDeleteSet` for individual sets. Has `Add exercise` button (lines 259-268) but no "remove exercise" affordance anywhere.
- `app/(app)/history/[id].tsx:56-317` — history detail screen for finished sessions. Same `<ExerciseBlock>` component (line 245), same `useDeleteSet` wiring, also lacks remove-exercise affordance. Lines 84-88 redirect to the live screen if `!ended_at` — so a single component supports both flows.
- `src/components/exercise-block.tsx:1-206` — `<ExerciseBlock>` component. Props at lines 9-26: `exercise`, `sets`, `unit`, optional `isFirst/isLast/onMoveUp/onMoveDown`, `onAddSet`, `onUpdateSet`, `onDeleteSet` (per-set). Header (lines 83-123) currently holds only name/muscles/equipment + optional reorder chevrons. Internal "menu" state exists (lines 40, 162-203) but only toggles warmup/dropset add-set options. No exercise-level destructive action.
- `src/hooks/use-sets.ts:1-69` — TanStack Query hooks. `useDeleteSet` (lines 60-69) wraps `softDeleteSet(id)`, invalidates `["sets", sessionId]` + `["stats"]`. Only handles one set at a time.
- `src/api/sets.ts:1-126` — Supabase data layer. `softDeleteSet(id)` at lines 119-125 is the precedent (one row update `{ deleted_at: now() }`). No bulk variant. `listSetsForSession` (lines 22-31) filters `deleted_at IS NULL`, so soft-deleted sets disappear from the live list automatically.
- `src/db/schema.ts:107-173` — schema. `sessions` has no `exercises` FK; `sets` is the only link. `sets` cascades on `session.delete`, restricts on `exercise.delete`, soft-delete via `deleted_at` (line 30 + timestamps helper). No `session_exercises` table.
- `src/api/sessions.ts:62-85` — session lifecycle. `finishSession` only sets `ended_at`; nothing reads which exercises "belonged" to the session beyond what sets exist. `softDeleteSession` exists as bulk-cascade precedent.
- `src/components/confirm-delete.tsx:1-40` — cross-platform confirm dialog (`Alert` on native, `window.confirm` on web). Used in 4+ flows (workout finish, session delete, measurement delete, routine delete). Returns `Promise<boolean>`.
- `src/api/routine-exercises.ts:86-92` — `removeExerciseFromRoutine(id)` precedent. Soft-deletes one `routine_exercises` row by `deleted_at`. Used in the routine editor (`src/components/routine-exercise-row.tsx:99-107`) with a `Trash2` red icon in the row's trailing actions cluster.
- `src/components/routine-exercise-row.tsx:80-108` — trailing-actions pattern: `ChevronUp`, `ChevronDown`, `Trash2` (red, `#ef4444`). This is the existing precedent for "row-level destructive action next to reorder controls". `<ExerciseBlock>` already mirrors the first two (chevrons in header at lines 101-122) but stops short of the trash icon.
- `src/components/set-input.tsx:148-155` — per-set `Trash2` button precedent (size 16, `#ef4444`, label "Delete set"). Confirms the visual language for destructive row actions.
- `src/api/stats.ts:18-33`, `src/hooks/use-stats.ts:16-27` — weekly volume reads filter `sessions.ended_at IS NOT NULL` and `deleted_at IS NULL`, so removing sets from an in-progress session doesn't affect any stats until the session is finished. After finish, the cache is already invalidated by `useFinishSession` (lines 53-65 of `use-sessions.ts`).
- `src/api/progress.ts:10-36` — per-exercise progress reads finished sessions only. Soft-deleted sets are already excluded.
- `src/api/sets.ts:96-117` — `getLastWorkingSetForExercise` reads finished sessions only and excludes `deleted_at IS NOT NULL`. Safe.
- `src/components/exercise-picker.tsx` — modal used to add exercises mid-session. Its `excludeIds` prop receives `orderedExercises.map(e => e.id)` (`[sessionId].tsx:285`). If we remove an exercise from the session, it should reappear in the picker so the user can re-add it.
- `tests/e2e/crud.spec.ts:162-202` — only e2e covering the live workout flow today (quick-start → finish → see in history). No coverage for exercise removal.

## Relevant conventions (verified by reading code)

- **Soft delete everywhere** (`docs/data-model.md:93-100`, `decisions.md` lifecycle entries): user-facing "delete" is `UPDATE … SET deleted_at = now()`. Pattern is uniform across `exercises`, `routines`, `routine_exercises`, `sessions`, `sets`, `measurement_entries`. All list reads filter `.is("deleted_at", null)`.
- **No bulk-update helpers in the API layer.** Every mutation in `src/api/*.ts` operates on a single row id. The closest "bulk" is `reorderRoutineExercises` (`src/api/routine-exercises.ts:99-123`) which does sequential per-row updates inside a single function. No batch endpoints, no Postgres functions yet (Decision 2: "thick DB, thin server" but currently no RPC).
- **TanStack Query keys**: `["sets", sessionId]` (per-session sets), `["stats"]` (weekly volume), `["progress"]` (per-exercise). Mutations invalidate by prefix. Current `useDeleteSet` precedent invalidates `["sets", sessionId]` and `["stats"]` (`use-sets.ts:60-69`).
- **Confirmation copy convention** (from `[id].tsx:152-167`, `confirm-delete.tsx`): title is a question ("Delete this workout?"), message explains scope ("All sets and notes ... This can't be undone."), confirmLabel matches the verb. Destructive uses red (`#ef4444`).
- **Row trailing actions cluster**: chevron-up, chevron-down, `Trash2` (`routine-exercise-row.tsx:80-107`). When reorder + remove coexist on the same row, the trash sits to the right of the chevrons. `<ExerciseBlock>`'s header currently has the first two but not the third.
- **Hydration sources for an exercise list** (live screen):
  1. routine_exercises (DB, position order)
  2. sets with rows in this session (DB, first-occurrence order)
  3. `adHocExerciseIds` (React state, picker order)
  Plus `exerciseOrderOverride` (React state) which reorders the union. `setsByExercise` map (`[sessionId].tsx:144-152`) drives per-block rendering.
- **Live screen does not persist routine_exercises into the session.** Starting a routine-backed session does not duplicate `routine_exercises` rows into a "session_exercises" table — the routine is read live each render (`useRoutineExercises(session.data.routine_id)` at line 40). This is critical: "remove from session" cannot mutate the routine itself.
- **NativeWind tone for destructive**: `text-red-500` / `color="#ef4444"` consistently in `routine-exercise-row.tsx`, `set-input.tsx`, `[id].tsx`'s "Delete workout" button.
- **Accessibility**: every Pressable has `accessibilityRole="button"` and `accessibilityLabel` matching the visible verb. Live-region announcements not used.

## Constraints

- **Data**:
  - No `session_exercises` table; cannot soft-delete "the exercise from the session" as a single row. Removal = soft-delete all non-deleted `sets` rows where `session_id = X AND exercise_id = Y`.
  - RLS: `sets` policy is `auth.uid() = user_id` on all four CRUD verbs (`docs/data-model.md:108-115`). A bulk update over `(session_id, exercise_id)` runs under RLS like any single update — no special handling needed because every row's `user_id` matches.
  - `sets.parent_set_id` FK is `ON DELETE SET NULL`, but we are **not** hard-deleting; soft-delete leaves the FK chain intact. Dropsets whose parent working-set is soft-deleted will still have their `parent_set_id` pointing at the (now soft-deleted) parent. Currently no read path stumbles on this because `listSetsForSession` filters out soft-deleted rows entirely — both parent and child disappear together when the bulk soft-delete sets all of them.
  - **routine_exercises is untouched.** The routine is the template; removing an exercise from this session must not modify the routine. The suppression of the routine-sourced exercise from `orderedExercises` therefore needs a session-scoped client-side or DB-side mask — see Unknowns.
  - **No DB row representing "exercise X is excluded from session Y" when X has zero sets.** This is the core data gap. Three options surface in Unknowns.
- **UI**:
  - `<ExerciseBlock>` is shared by live (`[sessionId].tsx`) and history detail (`[id].tsx`). The remove affordance must either (a) be configurable via prop so history detail can disable it / show "Delete all sets" with different copy, or (b) be enabled in both with shared semantics (history detail already allows per-set delete, so this is consistent).
  - NativeWind classes; no separate stylesheet. Dark-mode variants required (`dark:` prefixes) — current trash icon is hardcoded red, which is acceptable both modes.
  - Reorder chevrons (`ChevronUp/ChevronDown`) are already present in the header; trash icon must sit alongside without crowding the small action row.
- **Platform**: `confirmDelete` already handles web vs native (`Platform.OS === "web"` branch uses `window.confirm`). No additional divergence.
- **Auth**: every set's `user_id` is the active user; RLS handles authorization. No service-role calls needed.
- **Performance**: typical exercise has 1-6 sets per session; bulk soft-delete is at worst ~10 row updates. Either sequential client-side loop (mirroring `reorderRoutineExercises`) or a single `.update(...).eq("session_id", X).eq("exercise_id", Y).is("deleted_at", null)` PostgREST bulk filter — both are within RLS. The bulk filter approach is cheaper (one network round-trip) and PostgREST supports it.

## Existing precedents

- **Soft-delete of a single grouping row**: `removeExerciseFromRoutine` (`src/api/routine-exercises.ts:86-92`) — the cleanest analog for "remove exercise from routine". Same verb, different scope. Cannot be directly reused (no row to update) but its **hook + mutation pattern** transplants almost verbatim: red `Trash2` button → `confirmDelete` → mutation → cache invalidation.
- **Trailing actions cluster (chevrons + trash)**: `src/components/routine-exercise-row.tsx:80-107`. Direct visual template for `<ExerciseBlock>`'s header.
- **Per-set destructive precedent inside ExerciseBlock**: `<SetInput>` already has a trash icon (`set-input.tsx:148-155`). Same icon, same color, smaller scale.
- **Bulk soft-delete by filter (PostgREST)**: not present in any current api/*.ts file. Closest is `reorderRoutineExercises` which does a sequential loop. Worth confirming the PostgREST single-update-with-filter pattern works under RLS (it does — RLS checks each affected row).
- **`confirmDelete` with explanatory message**: `app/(app)/history/[id].tsx:152-167` (delete workout) and the routine deletion flow are the established templates for "destructive + irreversible" copy.
- **Bulk-cascade-by-FK**: `sessions` soft-delete (`softDeleteSession`) leaves child sets technically reachable but they cascade-disappear via the session being soft-deleted on read joins. Not directly applicable here because we want the *session* to stay alive.
- **Component-local hydration override**: `exerciseOrderOverride` (`[sessionId].tsx:51-53,107-122`) demonstrates the pattern of layering a client-side override on top of DB-derived state in the live screen. A `removedExerciseIds` set would slot in identically.

## Unknowns (require Designer judgment or human decision)

1. **Affordance location** — three viable options, each with precedent:
   - (a) **Trash icon in `<ExerciseBlock>` header**, next to the reorder chevrons. Matches `routine-exercise-row.tsx` exactly. Most discoverable. Risk: cramped header, accidental tap. *(Assumption: this is the strongest default; Conductor's prompt also leans here.)*
   - (b) **Kebab menu** in the header (new `MoreVertical` button) opening a sheet with `Remove exercise` (red text). Lowest accidental-tap risk, scales to future actions ("Notes for this exercise", "Reorder…"). No kebab pattern exists in the codebase today (verified via grep — only the warmup/dropset toggle uses a `ChevronDown` reveal).
   - (c) **Swipe-to-delete** on the block. No swipe gestures used anywhere in the repo today; would introduce a new pattern + dependency.
2. **Confirmation copy and gating** — proposal: "Remove this exercise from the workout? `<N>` set(s) you've logged will also be removed. This can't be undone." Two sub-decisions:
   - Should the confirm be **skipped** when the exercise has zero logged sets (i.e., it's a routine-sourced exercise the user never touched, or an ad-hoc add)? Saves a tap in the most common removal case.
   - Confirm label: `Remove` vs `Delete`? Prompt says "remove"; codebase uses `Delete` for `softDeleteSet`. *(Assumption: "Remove" is right because it scopes the action to *this session*, not the exercise globally.)*
3. **Hard vs soft delete** — convention dictates soft (`deleted_at`). The Conductor's prompt confirms. Decision is straightforward; flagging only because the design must explicitly state which `sets` rows are affected. *(Assumption: soft-delete, mirroring all other delete flows.)*
4. **Routine-sourced exercise with zero logged sets** — the core data gap. If the user removes an exercise that came from the routine and has no sets, there is nothing to soft-delete in `sets`. Three options:
   - (i) **Client-only suppression** via a new component-local `removedExerciseIds` set in `[sessionId].tsx`, layered into the `orderedExercises` build. Pros: zero schema change, mirrors `adHocExerciseIds`/`exerciseOrderOverride` precedent. Cons: removal does not survive screen reload — if the user backgrounds the app or refreshes web, the routine-sourced exercise reappears. Likely confusing.
   - (ii) **Add a tombstone table** (e.g., `session_exercise_exclusions(session_id, exercise_id, deleted_at)`). Pros: persistent, durable, clean RLS. Cons: schema migration + new RLS rules + new api/hooks file + cache key — larger surface for a small UX win.
   - (iii) **Insert a soft-deleted placeholder set** (`set_number = 0`, `reps = null`, `weight = null`, `set_type = "working"`, `deleted_at = now()`) as a tombstone. Pros: no schema change. Cons: abuses semantics, pollutes the table, would need careful query filtering. *(Strongly discouraged in the codebase's "one obvious way" ethos — Decision 1 framing.)*
   - **Practical mid-point**: option (i) with a future migration to (ii) if persistence pain shows up. The current screen already loses `adHocExerciseIds` and `exerciseOrderOverride` on reload, so (i) is consistent with existing behavior — but the *direction* of the inconsistency is different (losing an addition vs gaining back a removal).
5. **History detail screen parity** — `app/(app)/history/[id].tsx` reuses `<ExerciseBlock>`. Two routes:
   - (a) Expose `onRemoveExercise` as an optional prop on `<ExerciseBlock>`; live screen passes it, history screen doesn't (so the trash icon is hidden there).
   - (b) Wire it in both screens with identical semantics (bulk-soft-delete sets). History detail already allows per-set delete (`[id].tsx:270-276`), so removing a whole exercise is a natural extension. *(Assumption: (b) is more consistent, but the Conductor's scope tags this as out-of-scope; design should call it explicitly.)*
6. **Excluded picker behavior** — `<ExercisePicker>` is invoked with `excludeIds: orderedExercises.map(e => e.id)` (`[sessionId].tsx:285`). After a removal, the exercise should drop out of `orderedExercises` and therefore reappear in the picker, so re-adding works. *(Verified by tracing the prop chain; no design decision needed beyond ensuring `removedExerciseIds` is reflected in `orderedExercises`.)*
7. **Effect on rest timer** — `useRestTimer` (`src/hooks/use-rest-timer.ts`) is decoupled from exercises (it's a global timer keyed only on end-time). Removing an exercise does not affect a running timer. No special handling.
8. **Last-exercise-removed empty state** — `[sessionId].tsx:204-209` already handles `orderedExercises.length === 0` with "No exercises in this session yet. Add one to start logging." This message renders fine post-removal but might mislead a user who has just emptied the session. The "Finish workout" button stays clickable (in `SessionHeader`), and finishing an empty session is allowed (`finishSession` only sets `ended_at`; no `CHECK` on sets count). Whether to offer "Cancel this workout instead" (i.e., `useSoftDeleteSession`) is a separate UX call — flag for designer.
9. **Optimistic UI** — current mutations (`useDeleteSet`, `useLogSet`) do not optimistically update; they wait for the server roundtrip then invalidate. Should the remove-exercise be optimistic to feel snappy across N set deletes? *(Assumption: stay non-optimistic to match the codebase, since one PostgREST call covers N rows if the bulk-filter approach is taken.)*
10. **Cache invalidation set** — current `useDeleteSet` invalidates `["sets", sessionId]` + `["stats"]`. For bulk remove, the live session is unfinished so `["stats"]` is unaffected (stats query filters `ended_at IS NOT NULL`), but invalidating it costs nothing and matches precedent. `["progress"]` is also stats-only and only matters post-finish.
11. **Concurrent edit (web tab + native)** — if the user has the same session open in two places, one tab removing the exercise should reflect on the other on next refetch. No realtime subscription wired; this is a known limitation of the current architecture and shouldn't be solved here.
12. **e2e test coverage** — `tests/e2e/crud.spec.ts:162-202` is the only workout-flow e2e. No spec asserts exercise removal. Tester will need to add an assertion to either that spec or a new one (e.g., add an ad-hoc exercise → log a set → remove the exercise → assert block gone + picker re-exposes it).
13. **Animation / undo banner** — Strong-app's analog has an undo snackbar after removal. None of ada11's destructive flows have undo today; matching the existing convention means no undo, just `confirmDelete`. *(Out-of-scope per Conductor.)*

## Out-of-scope flags

- Reordering exercises mid-session — already implemented via the chevron buttons, not changing.
- Bulk-removing multiple exercises at once.
- Undo / snackbar after removal — no undo precedent in the codebase.
- Removing exercises from a *finished* session (history detail flow) — though the same component is involved, Conductor scoped this as a separate concern; design may choose to enable the prop in both screens but the testable scope is the live screen.
- Soft-deleted exercise visibility in past history (separate open feature, line 7 of `features.md`).
- Adding a `session_exercises` schema table — even if needed for unknown #4 option (ii), a schema migration is a larger scope decision the Designer should surface back, not silently include.
- Realtime cross-device sync.
- Optimistic UI patterns generally.
