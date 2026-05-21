# Discovery — 2026-05-21_1308_set-check-button

## Feature prompt

From `docs/features.md:3` and `state.md`:

> "Add a check button for each set during workout (live session). Helps the user track which set they're currently on. Unchecked sets are NOT saved when the workout is finished — only checked sets persist. If any sets are unchecked when Finish is pressed, show a warning dialog with two options: (a) finish without saving unchecked sets, or (b) auto-check all sets before saving."

Conductor context: emulating Strong's "checkmark" on each set row in the live workout. Tapping = "set was actually performed". On Finish, unchecked = discarded.

## Scope summary

Add per-set "checked / not yet" state to the live workout screen (`app/(app)/workout/[sessionId].tsx`) — surfaced as a check button on each `<SetInput>` row inside `<ExerciseBlock>`. State must persist across reloads (same set row must survive a closed-and-reopened app), which makes it a **data-model change** (column on `sets` or repurposing `completed_at`), not a pure UI state. On Finish, branch into a 3-option dialog when any sets are unchecked: Cancel / Discard unchecked / Auto-check all. Discard = bulk soft-delete unchecked sets in the session; Auto-check = bulk-update the "checked" flag on all unchecked sets, then call the existing `finishSession`. The live-workout flow is the only place this matters — history detail shares `<ExerciseBlock>` but its sets are all already persisted/finished and should appear pre-checked + non-toggleable.

## Affected files (verified)

- `app/(app)/workout/[sessionId].tsx:1-361` — live session screen. Renders `<SessionHeader>` (with Finish button) + N `<ExerciseBlock>` instances. `onFinish` (lines 204-219) uses `confirmDelete` (2-button) → `finish.mutateAsync(sessionId)`. The 3-option dialog branch and the bulk-delete-or-bulk-check side-effects land here.
- `src/components/exercise-block.tsx:1-228` — `<ExerciseBlock>`. Maps `sets` → `<SetInput>` (lines 161-170). Three callbacks: `onAddSet`, `onUpdateSet`, `onDeleteSet`. New callback needed: `onCheckSet(setId, nextChecked: boolean)` (or pair of `onCheckSet` / `onUncheckSet`).
- `src/components/set-input.tsx:1-173` — the set row. Today has weight/reps/RPE TextInputs + `MessageSquare` (notes toggle) + `Trash2` (delete). The check icon must slot into this row layout. Lines 92-156 are the action row; lines 49-53 hold the type-badge and "set_number" label. There is no existing check icon usage anywhere in the codebase (grep confirmed) — `lucide-react-native` exposes `Check`, `CheckCircle`, `CheckCircle2`, `CheckSquare`, `Square` for the picker decision.
- `src/db/schema.ts:129-173` — `sets` table. `completedAt` (line 149) is `timestamp(...notNull)`. **This is the central data-model choice** — see Unknowns #1: either drop the `NOT NULL` (making `completed_at IS NULL` = unchecked draft) or add a new column. Drizzle schema is source of truth; SQL migration in `supabase/migrations/0000_schema.sql:62` (`"completed_at" timestamp with time zone NOT NULL`).
- `src/api/sets.ts:1-148` — Supabase data layer.
  - `logSet` (lines 33-69) currently inserts with `completed_at: new Date().toISOString()` (line 63). To support unchecked drafts, this becomes `null` (option a) or stays as-is and a new `checked_at = null` column is introduced (option b).
  - `listSetsForSession` (lines 22-31) orders by `completed_at` ascending. If `completed_at` becomes nullable, Postgres `ORDER BY completed_at` puts `NULL`s **last** by default — which is wrong for an in-progress session (a newly added unchecked draft should appear *after* prior checked sets… actually the existing chronological insert order means each new one is appended, so NULLs-last works coincidentally). Worth verifying explicitly in Validation.
  - `updateSet` (lines 71-88) currently patches reps/weight/rpe/notes only. A `checkSet` / `uncheckSet` mutation is needed (or merge into `updateSet` payload).
  - `softDeleteSet` (lines 119-125) and `bulkSoftDeleteSetsForExerciseInSession` (lines 137-147) are precedents for the "discard unchecked" bulk operation.
- `src/hooks/use-sets.ts:1-86` — TanStack Query hooks. New mutations needed: `useCheckSet`, `useUncheckSet`, `useBulkCheckSetsForSession`, `useBulkDiscardUncheckedForSession`. Cache invalidation precedent at lines 42-46: invalidate `["sets", sessionId]` + `["stats"]`.
- `src/hooks/use-sessions.ts:54-66` — `useFinishSession` only sets `ended_at` (`src/api/sessions.ts:62-71`). The pre-finish "auto-check OR discard" step happens **before** `finishSession`, in the screen — `finishSession` itself doesn't need to know about checked state.
- `src/components/confirm-delete.tsx:1-40` — current cross-platform confirm. **Two buttons only** (Cancel + Confirm). The new feature needs **three buttons** (Cancel + Finish without saving + Auto-check all). Web branch uses `window.confirm` which only supports 2 options; native uses `Alert.alert` which supports 3+. A new helper (`chooseAction` / `confirmThreeWay`) is required, or the dialog goes inline as a custom modal — see Unknowns #10.
- `src/components/session-header.tsx:1-50` — the Finish button source. Receives `onFinish` callback. No change here; the screen's `onFinish` handler grows the dialog logic.
- `src/api/stats.ts:18-33` — `listWeeklyVolumeRows` filters `.gte("completed_at", opts.sinceUtc)`. If `completed_at IS NULL` (option a), the row is implicitly excluded — but it's also already filtered by `.not("sessions.ended_at", "is", null)`, so unfinished sessions can't even enter the query. Either way, unchecked sets are never counted in weekly volume. Safe.
- `src/api/progress.ts:10-36` — `listSetsForExercise` filters `.not("sessions.ended_at", "is", null)` + `.is("deleted_at", null)` and orders by `completed_at`. Same safety: only finished sessions reach this query; only persisted (= checked + not-discarded) sets exist for finished sessions after the new finish-flow. The `ORDER BY completed_at ASC` requires `completed_at` to be non-null for every row that reaches it. With option (a) this **is** guaranteed by the finish-flow (any session that has been finished went through the "auto-check OR discard" branch). With option (b) `completed_at` stays `NOT NULL` and there's no ordering concern.
- `src/api/sets.ts:96-117` — `getLastWorkingSetForExercise` filters `.not("sessions.ended_at", "is", null)` and orders by `completed_at DESC`. Same reasoning: only finished sessions, so `completed_at` non-null is guaranteed under option (a) by finish-flow.
- `src/components/weekly-volume-strip.tsx:38-51` — uses `row.completed_at` for week bucketing. **Semantic note** under option (a): the bucketing timestamp is when the user *tapped check*, not when they tapped "+ Working set". This shifts a few seconds, sometimes minutes if the user checks at end of exercise. Within-week, irrelevant. Across week boundaries (a set logged at 23:59 Sun and checked at 00:02 Mon) — edge case, low risk for a personal tracker. Same observation applies to `src/api/progress.ts` charting.
- `src/utils/session-times-form.ts:112-132` — `countSetsOutsideRange` already explicitly handles `setsCompletedAt: readonly (string | null)[]` and ignores nulls. This is the only place the codebase already anticipates a nullable `completed_at`. Mild precedent for option (a).
- `app/(app)/history/[id].tsx:204` — passes `setsQ.data.map(s => s.completed_at)` as `setsCompletedAt`. Type is `string` (non-null) today; would become `string | null` under option (a). The consuming util already accepts the nullable type. Minor type widening only.
- `app/(app)/history/[id].tsx:239-273` — history detail renders `<ExerciseBlock>` for finished sessions. **The check icon must be hidden or read-only here** (no point un-checking a persisted past set; persisted = checked by definition).
- `src/components/active-session-banner.tsx:1-34` — banner shown across the app when a session is in progress. No changes needed, but a future enhancement could surface "N checked of M sets" — explicit out-of-scope.
- `src/lib/query-client.ts:27` — `queryCacheBuster = "schema-2026-05-19-muscles"`. **Must be bumped** in the same commit as any migration that adds/renames/changes a column read by a persisted query (`docs/decisions.md` Decision 9, lines 173-194). New value pattern: `schema-2026-05-21-set-check`.
- `supabase/migrations/0006_add_source_flag.sql:1-37` — most recent hand-written migration. Precedent for the next migration number (`0007_*.sql`), file structure (header comment + `alter table` statements + CHECK constraint pattern + RLS-policy non-impact note).
- `scripts/import-strong.ts:543` — strong importer sets `completed_at: startedAt` for every imported set. Imported sets stay "checked" under option (a). No code change needed; behavior already correct.
- `tests/e2e/crud.spec.ts:162-202` — only e2e covering quick-start → finish round-trip today. Currently taps "+ Working set" then "Finish" with no intermediate check. **Will hit the new 3-option dialog after this feature lands.** Needs an update: either add a "check the set" step before Finish, or expect & dispatch the auto-check branch of the new dialog.
- `tests/e2e/remove-exercise.spec.ts:122-171` — same pattern. Logs 1 working set, taps Finish. Needs the same update.
- `tests/e2e/soft-deleted-exercises-in-history.spec.ts:150-163` — same pattern: log 2 working sets → Finish. Needs same update.
- `tests/e2e/exercise-progress-ia.spec.ts:186` — taps Finish. Needs same update.

## Relevant conventions (verified by reading code)

- **Soft delete everywhere.** All API list reads filter `.is("deleted_at", null)`. The "discard unchecked sets" action is a bulk soft-delete, not a hard delete. Precedent: `bulkSoftDeleteSetsForExerciseInSession` (`src/api/sets.ts:137-147`) — single `update().eq().eq().is()` over `(session_id, exercise_id, deleted_at null)` returns in one round-trip and is RLS-safe (every row's `user_id` matches the JWT user). The new bulk-discard-unchecked is structurally identical (single .update with three .eq filters).
- **TanStack Query keys.** `["sets", sessionId]` (per-session sets), `["stats"]` (weekly volume), `["progress"]` (per-exercise). Mutations invalidate by prefix. New check/uncheck/bulk hooks must mirror this exactly (`src/hooks/use-sets.ts:42-46`).
- **NativeWind only, dark-mode variants always paired.** `bg-white dark:bg-black`, `text-black dark:text-white`. Verified across `set-input.tsx`, `exercise-block.tsx`. The new check icon must respect both themes; precedent for icon colors uses hex values directly (`#ef4444` red trash, `#9ca3af` muted, `#3b82f6` blue active in `set-input.tsx:145`).
- **Accessibility labels on every Pressable.** `accessibilityRole="button"` + `accessibilityLabel` matching the verb. The new check button needs both (e.g., `accessibilityLabel="Mark set as completed"` when unchecked, `"Mark set as not completed"` when checked).
- **`set_number` is computed from non-deleted rows only.** `logSet` at `src/api/sets.ts:38-48` does `select("set_number").eq(session_id).eq(exercise_id).is(deleted_at, null).order(desc).limit(1)`. Soft-deleting unchecked sets correctly frees their numbers; a subsequent add resumes at `max(remaining)+1`. No surprise here.
- **Set ordering in the list is `completed_at ASC` (`src/api/sets.ts:28`).** Under option (a), `NULL`s sort LAST by Postgres default — which matches the visual reality: existing checked sets first, then new unchecked drafts at the bottom. Worth pinning explicitly with `NULLS LAST` in the query for clarity; PostgREST supports `nullsFirst: false` via `.order("completed_at", { ascending: true, nullsFirst: false })`. Today the call doesn't specify; relies on Postgres default. **Validation should pin this.**
- **Cache buster bump on schema change.** Decision 9 (`docs/decisions.md:173-194`). New buster string: `schema-2026-05-21-set-check`. Forces a single refetch for users with a persisted cache from before the migration.
- **Migration naming.** Hand-written or drizzle-generated SQL under `supabase/migrations/00XX_<slug>.sql`. Next slot: `0007_set_check.sql` (hand-written; pattern from `0006_add_source_flag.sql`).
- **Cross-platform dialog.** Today only 2-button (`confirmDelete`). Web uses `window.confirm`. A 3-way choice needs either `window.prompt`-style hack on web (rejected — UX trash) or a real in-app modal component. The native side can use `Alert.alert(title, msg, [3 buttons])` but for cross-platform parity, a custom `<Modal>` is the more honest route. See Unknowns #10.
- **Strong app is the UX baseline.** `docs/iphone-shakedown.md:3` ("Every place Ada11 makes you work harder than Strong is a candidate for the next sprint"). Strong's check button is on the right side of each set row, large tap target, fills the row in a tint color when checked. This is the implicit reference the feature is chasing.

## Constraints

- **Data**:
  - RLS on `sets` table: `auth.uid() = user_id` on all four CRUD verbs (`docs/data-model.md:108-115`). Both the check-toggle and bulk-discard operate under RLS without special handling because `user_id` is denormalized on every row.
  - Existing CHECK constraints on `sets` (`schema.ts:163-171`): `set_type IN ('warmup','working','dropset')` and the parent invariant. Neither interacts with the new column/semantics.
  - `parent_set_id` (`schema.ts:147,158-162`) with `ON DELETE SET NULL`: under soft-delete-of-parent, the FK still points at the (soft-deleted) parent. `listSetsForSession` filters soft-deleted rows out, so the orphan never surfaces. Bulk-discarding unchecked sets that include a working set with checked dropset children is a real edge case — see Unknowns #12.
  - `completed_at` is currently `NOT NULL` (`schema.ts:149`, `0000_schema.sql:62`). Option (a) requires `ALTER COLUMN ... DROP NOT NULL`. Option (b) requires `ADD COLUMN checked_at timestamptz`. Either way, **all existing rows must end up as "checked" after migration** (they were already persisted as completed sets).
  - Indexes: `sets_exercise_completed_idx` on `(exercise_id, completed_at)` (`schema.ts:154-157`). Nullable column is fine for btree (Postgres indexes nulls). Index continues to serve the same queries.
  - **Active-session invariant**: there's at most one in-progress session per user (enforced loosely by `getActiveSession` returning the most recent `ended_at IS NULL` row, `src/api/sessions.ts:26-36`). Unchecked sets only exist within an active session. After Finish, all sets in the session are either checked-and-saved or soft-deleted. This is the invariant the finish-flow must enforce.
- **UI**:
  - `<SetInput>` row is already dense (badge + set# + 3 inputs + 2 icons). Adding a 3rd icon (Check) means either rearranging the row or shrinking inputs. The check button is the primary frequent action (every set, every time) — it should be the most prominent affordance, not crammed at the end. Strong puts it on the right side, full-row-height, in a separate cluster. We can mirror: collapse `MessageSquare` + `Trash2` into a kebab/overflow OR widen the row vertically. See Unknowns #2.
  - Visual state: unchecked = outline, neutral; checked = filled, color tint (green is the Strong convention; matches "completed" semantics). The whole row could shift background subtly when checked to reinforce. Today no row in the codebase has a "checked" tint precedent.
  - History detail (`app/(app)/history/[id].tsx`) shares `<ExerciseBlock>` → shares `<SetInput>`. The check icon must be either hidden or shown as a static "✓ done" indicator there (no toggle, no callback). Cleanest: pass `readOnlyCheck?: boolean` to `<ExerciseBlock>` and onward, or branch on `session.ended_at != null`.
- **Platform**:
  - `Alert.alert` (native) supports 3+ buttons; `window.confirm` (web) supports only OK/Cancel. A real 3-option dialog **requires an in-app custom modal** for parity. The codebase currently has no such modal component — would be a new component, likely `src/components/three-option-modal.tsx` or generalized to `src/components/choose-action-modal.tsx`. The `ExercisePicker` (`src/components/exercise-picker.tsx`) and `PlateCalculator` (`src/components/plate-calculator.tsx`) are precedents for in-app modal sheets — review their `<Modal>` usage when designing.
  - iOS shakedown (`docs/iphone-shakedown.md`) is the primary device — the tap target for "Check" must be thumb-reachable and big (>= 44pt per Apple HIG).
- **Auth**: standard JWT-authed Supabase calls. RLS handles authorization. No service role.
- **Performance**:
  - Bulk-discard / bulk-check: at most ~50 sets per typical session (5 exercises × 8 sets). One PostgREST round-trip via `.update().eq(session_id, X).is(checked_at, null)` (or equivalent). Sub-100ms.
  - Per-set check toggle: single `update().eq(id, X)`. Same path as `useUpdateSet`. No perf concern.
  - Live screen re-renders on every `setsQ` invalidation. Today already does this on add/update/delete. New check toggle adds one more invalidation per check tap — owner might tap 30-50 checks per session — well within `staleTime: 30s` (`src/lib/query-client.ts:8`) and `gcTime: 24h`. No perf concern; consider optimistic update for snappier UX (precedent: none today — every set mutation is round-tripped before UI updates).

## Existing precedents

- **Bulk soft-delete by filter (PostgREST)**: `bulkSoftDeleteSetsForExerciseInSession` (`src/api/sets.ts:137-147`). Direct template for "bulk soft-delete unchecked sets for session". Same shape:
  ```ts
  supabase.from("sets").update({ deleted_at: now() })
    .eq("session_id", sessionId)
    .is("completed_at", null)  // or .is("checked_at", null)
    .is("deleted_at", null);
  ```
- **Bulk update by filter (analogous, doesn't exist yet)**: for "auto-check all unchecked", same shape but updating `completed_at`/`checked_at` to `now()` instead of `deleted_at`. No prior usage in api/*.ts but PostgREST supports identically.
- **Soft-delete + cache invalidation pattern**: `useDeleteSet` (`src/hooks/use-sets.ts:61-70`) invalidates `["sets", sessionId]` + `["stats"]`. New bulk-check/bulk-discard mutations follow same shape.
- **Pre-action confirmation flow**: `handleRemoveExercise` (`app/(app)/workout/[sessionId].tsx:176-202`) shows `confirmDelete` then dispatches the bulk mutation. The new finish-flow follows the same control structure but with three branches instead of two.
- **State that lives across reloads**: every relevant flag is a DB column on `sets` or `sessions`. There is **no LocalStorage / AsyncStorage state** for workout-internal flags today (TanStack Query persistence is for query cache only). The check-state being a DB column is the only durable option — confirms why this is a schema change, not pure React state.
- **Migration shape**: `0006_add_source_flag.sql:14-37` — adds a nullable column + CHECK constraint + RLS-policy non-impact note + index-skipped justification. Direct template for `0007_set_check.sql` under either option.
- **`Alert.alert` 2-button**: `src/components/confirm-delete.tsx:30-39`. The 3-button extension is mostly a "add a third button object to the array" on native; the web branch is the real work.
- **In-app modal component**: `src/components/exercise-picker.tsx` and `src/components/plate-calculator.tsx` — both implement full-screen modal sheets using React Native's `<Modal>`. These are the visual templates for the new finish-flow choose-action modal.
- **Optimistic mutation (NOT present)**: no current mutation in the codebase uses TanStack's `onMutate` for optimistic updates. The new check-toggle is the strongest candidate (felt latency matters when tapping during a workout) but introducing optimism is a Design call.
- **`completedAt` is the only timestamp that means "user-action moment, not row-creation"**: `created_at` is automatic via Drizzle default; `completed_at` is set explicitly by `logSet` (`src/api/sets.ts:63`). This is the semantically loaded field — and the one the new feature centers on.
- **Repurposing vs adding columns**: Decision 8 (`docs/decisions.md:151-169`) — schema migrations are explicitly called "cheap". Recent precedent of `0004_exercise_muscles_array.sql` (renamed + reshaped `primary_muscle` → `muscles[]`) and `0006_add_source_flag.sql` (additive) both happened without controversy. Either option is consistent with the project's posture toward schema change.

## Unknowns (require Designer judgment or human decision)

1. **Data model — repurpose `completed_at` (option a) vs add `checked_at` (option b).** Tradeoffs:
   - **Option (a) — repurpose `completed_at`**: drop `NOT NULL`. `completed_at IS NULL` = unchecked draft; `completed_at IS NOT NULL` = checked. Migration: `ALTER COLUMN ... DROP NOT NULL`. Existing rows untouched (all already have `completed_at`). Pros: one column, no new concept. Cons: subtle semantic shift — the field name now means "checked at" not "completed at"; readers of historical SQL/dashboards may misinterpret. Stats queries (`stats.ts`, `progress.ts`) already filter `.gte("completed_at", ...)` so nulls naturally drop out — no query change. `order("completed_at")` needs explicit `nullsFirst: false` for clarity.
   - **Option (b) — new column `checked_at` (or `checked: boolean`)**: keeps `completed_at` as "row insertion / set creation" timestamp. Migration: `ADD COLUMN checked_at timestamptz` (nullable). Migration backfill: `UPDATE sets SET checked_at = completed_at` so all existing rows are "checked" by default. Pros: clean semantics, two separate concepts (logged vs verified). Cons: one more column, every read/write needs to be aware of which to filter on; queries that today use `completed_at` for time-based stats may now subtly mean "logged time, even for unverified sets" (unless we also filter by `checked_at IS NOT NULL`). Stats consumers must be audited.
   - **My assessment (HIGH confidence)**: option (a) is the cheaper change and aligns with how `completed_at` is *currently* used (`logSet` sets it to `now()` on insert today, meaning "I added this set just now," which is closer to "I just performed it" than to "I created an empty row"). The shift to nullable changes "now" → "after I tap check" — that's the only behavioral delta. Option (b) is more honest semantically but introduces a second field for marginal benefit. **Default for Design: option (a).** Flagging because the call has long-term semantic implications for stats interpretation, and Designer/owner may have a different read.

2. **Set-row UI position for the check icon.** Three candidates, each with tradeoffs:
   - **(a) Replace/relegate the trash icon** to a long-press or kebab; promote Check to the right edge. Highest discoverability, but loses one-tap delete.
   - **(b) Add Check as a 3rd trailing icon** (after MessageSquare, Trash2). Easy to slot in; row becomes very dense.
   - **(c) Left side**, before the type-badge — "tap to check" as the first thing visually. Different mental model: status before content.
   - **Strong's pattern**: large tappable area on the right, fills the row in a tint when checked. Worth mirroring loosely (option a or b with row-bg color change on check).
   - Default for Design: **(b) but with row-background tint when checked** so the visual hierarchy still calls out "this set is done" without requiring the icon to be huge.

3. **Visual state of checked vs unchecked rows.**
   - Unchecked: today's neutral look (white/black row, default input borders).
   - Checked: row gets a subtle background tint (green-50 / green-950), border-color shift, or the inputs become read-only-styled. Strong dims the inputs after check — option worth considering for "set is locked, you've confirmed it" feel. But the owner sometimes edits a logged set after finishing; locking on check would block in-session edits. Designer call.

4. **Order semantics on check.** Does tapping check on set N auto-focus/highlight set N+1 (the "next set" the user should perform)? Pure visual nicety; might be overkill for v1. Default: no auto-advance, leave as design follow-up.

5. **Auto-check on save (commit of input).** When the user fills weight + reps and blurs the input (`set-input.tsx:79-86`, `commit()`), should the set auto-check? Two readings:
   - **Tight coupling**: filling means done; auto-check after commit. Removes one tap.
   - **Decouple**: filling and confirming are distinct moments; the user might fill, then decide to redo, then check. Matches Strong.
   - Default for Design: **decouple** (matches Strong, lets the user backfill numbers from memory after the fact). The user explicitly opts in by tapping check.

6. **Default state of a newly-added set.**
   - **Unchecked** (default) — user fills numbers, taps check when actually done. Matches Strong.
   - **Checked** — fastest path; user only unchecks if they don't actually do the set.
   - Default for Design: **unchecked**. The whole feature exists because the user wants to track "where am I in the workout".

7. **Removing an exercise with unchecked sets (F7 interaction).** `handleRemoveExercise` (`app/(app)/workout/[sessionId].tsx:176-202`) already soft-deletes all sets for that exercise via `bulkSoftDeleteSetsForExerciseInSession`. Filter `.eq("session_id").eq("exercise_id").is("deleted_at", null)` already catches checked + unchecked alike. **No special case needed** — confirm in Validation that removing an exercise with mixed checked/unchecked sets discards both, which is the correct behavior.

8. **"Finish without saving unchecked" UX details.**
   - The bulk-soft-delete must run **before** `finishSession` (so finished sessions never contain unchecked rows). On failure of the bulk-soft-delete, do NOT call `finishSession` (leave session in-progress, surface the error).
   - Optional: show a count in the dialog ("You have 3 unchecked sets — finish without saving them?"). Best practice.
   - Confirmation copy needs to be unambiguous about destructive-ness. Soft-deleted sets are gone from history forever for this user — same finality as the existing `useDeleteSet`.

9. **"Auto-check all" UX details.**
   - Sets `completed_at = now()` (option a) or `checked_at = now()` (option b) for all unchecked sets in the session.
   - All checked sets get the same timestamp — same instant. For weekly-volume bucketing, this is fine (within-second clustering). For per-exercise progress charts, this means the auto-checked sets all appear at the same time within the session, instead of distributed across the actual time when each set was performed. Mildly worse for chart "shape" but irrelevant to weight progression.
   - One round-trip via `.update().eq(session_id).is(...checked-flag..., null)`. Then `finishSession`. Failure handling: same as above.

10. **3-button dialog — `Alert.alert` (native) vs custom modal (web).** Current `confirmDelete` does NOT support 3 buttons on web (`window.confirm` returns boolean only). Options:
    - **Build a real cross-platform `<ChooseActionModal>` component** with three labeled buttons. Visual template: `exercise-picker.tsx`, `plate-calculator.tsx`. Most work, best UX, scales to future dialogs.
    - **`Alert.alert` on native only; on web use two sequential confirms** ("Save unchecked sets? OK = auto-check, Cancel = discard"). Ugly, error-prone, two-decision-points confusing.
    - **`Alert.alert` on native; on web use the existing `confirmDelete` flow with the wording "auto-check unchecked? Cancel = discard"** — collapses 3 options to 2 on web. Pragmatic but inconsistent UX across platforms.
    - Default for Design: **build the custom modal**. The Conductor's prompt explicitly calls for a 3-option dialog, and there's no clean 3-way `window.confirm`.

11. **Test impact across the e2e suite.** Four e2e specs currently tap "+ Working set" then "Finish" without checking sets:
    - `tests/e2e/crud.spec.ts:162-202` (workout: start ad-hoc, finish, see in history)
    - `tests/e2e/remove-exercise.spec.ts:122-171` and `:189-217`
    - `tests/e2e/soft-deleted-exercises-in-history.spec.ts:150-163`
    - `tests/e2e/exercise-progress-ia.spec.ts:186`
    - After the feature lands, each of these will hit the new 3-option dialog and need to either (a) tap the new check button before Finish, or (b) auto-dismiss the dialog choosing "Auto-check all". Tester needs to update them. **The first of those is the cleaner long-term test pattern** — represents the real user behavior (the user IS checking sets) — but more work upfront.

12. **Dropset chain edge case: unchecked working set with checked dropset children.** If a user logs a working set (unchecked), then a dropset chained to it (checked), then taps Finish → discards unchecked → the working set vanishes but the checked dropset stays with a dangling `parent_set_id` pointing to a soft-deleted row. Today's read filter (`is("deleted_at", null)`) hides the soft-deleted parent, but the dropset's `parent_set_id` still references it. `parent_set_id` FK is `ON DELETE SET NULL` but soft-delete doesn't trigger the FK action. The orphaned dropset stays in the session with a parent that "exists" but is invisible. **No immediate user-visible bug** (the existing parent-invariant CHECK constraint only enforces `set_type='dropset' → parent_set_id IS NOT NULL`, which is still satisfied), but the data is semantically inconsistent. Design decision: forbid the auto-discard of an unchecked working set if any non-deleted dropset still references it (cascade-check the parent + its children, or block discard with an error), OR also discard children, OR leave alone (children get orphaned but app still works). Probably rare; flag for Validation.

13. **Active-session-banner / resume flow.** If the user closes the app mid-session with unchecked sets, then reopens, then resumes — the unchecked sets must still be present and still unchecked. Persistence via DB column makes this automatic. No code change needed; flag explicitly in test plan.

## Out-of-scope flags

- **Auto-advance to next set on check** (Unknowns #4). Pure UX nicety; deferred.
- **Per-exercise checked-set counter in `<ExerciseBlock>` header** (e.g., "3 of 5 checked"). Useful but separate feature; deferred.
- **Rest timer auto-start moved from "+ Working set" to "Check"** (`src/components/exercise-block.tsx:175,210` → `app/(app)/workout/[sessionId].tsx:282-285`). The current behavior is "start rest timer when set is added," which under the new semantics is arguably wrong — the user logs the set after performing it, so the rest period is between performances, which equals between checks, not between adds. **Strong starts the timer on check.** Worth doing the right thing here, but explicitly out-of-scope unless Designer pulls it in. If included, it's a one-line move from `onAddSet` to `onCheckSet` handler in `[sessionId].tsx`.
- **Locking inputs of a checked set** (Unknowns #3). Bigger UX call; deferred to a follow-up unless Designer scopes it in.
- **Optimistic check toggle** (no precedent in codebase). Snappier UX, more code. Deferred unless Designer pulls in.
- **Active-session-banner showing N/M checked** (Unknowns #13 related). Future polish.
- **"Skip set" semantically distinct from "uncheck"** (Strong has a skip concept). Out of scope — unchecked + Finish-discard already covers it.
- **Migrating away from `completed_at` naming if option (a) is chosen.** The semantic shift makes the column name slightly misleading. A future migration could rename to `checked_at`. **Don't do this in v1** — rename migrations have backwards-compat costs (PostgREST clients, persisted cache, etc.). Live with the naming.
