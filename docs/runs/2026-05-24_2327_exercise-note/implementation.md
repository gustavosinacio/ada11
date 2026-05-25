# Implementation — 2026-05-24_2327_exercise-note

Based on: `design-v2.md` (approved) and `validation-v2.md` (`go` with 5 non-negotiable hand-off notes).

## Files changed

### New files
- `supabase/migrations/0010_exercise_notes.sql` (new) — `exercise_notes` table: UUID `id`, FK `user_id` cascade, FK `exercise_id` RESTRICT, `body text NOT NULL` with **named** CHECK `exercise_notes_body_length_check check (char_length(body) <= 2000)` (MIN-v2-6), composite index `(user_id, exercise_id)`, partial UNIQUE index `(user_id, exercise_id) WHERE deleted_at IS NULL`, RLS enabled with 4 inlined policies, `touch_updated_at` trigger. Mirrors `0005_measurements.sql` shape.
- `src/api/exercise-notes.ts` (new) — `getMyExerciseNote(exerciseId)` (auth-gated, soft-delete-filtered, `.maybeSingle()`, returns `null` when unauth or no row) + `upsertMyExerciseNote(exerciseId, body)` implemented as read-then-write with **iterative retry** (`for (let attempt = 0; attempt < 2; attempt++)`, MIN-v2-3) on 23505 race.
- `src/hooks/use-exercise-note.ts` (new) — `useMyExerciseNote(exerciseId)` reader (`enabled: !!exerciseId`, parameterized cache key `["exercise_note", exerciseId, "me"]`) + `useUpsertMyExerciseNote(exerciseId)` mutation (`onSuccess: (row) => qc.setQueryData(KEY, row)`).
- `src/components/exercise-note-slot.tsx` (new) — self-wired presenter. Owns the empty-body display rule, the 2-state editable affordance (collapsed `+ Add note` ↔ expanded `<Textarea>`), the 2000-char zod guard, the `isLoading → null` rule, and the **draft-divergence resync guard** (MIN-v2-1).
- `tests/unit/exercise-notes-api.test.ts` (new) — 10 tests for the API: auth gating, null-on-no-row, soft-delete filter, INSERT path, UPDATE-by-id path, 23505 race → loop-once → UPDATE, non-23505 surfaces immediately, SELECT error surfaces.
- `tests/e2e/exercise-note.spec.ts` (new) — 6 Playwright tests covering: golden (progress edit → live workout displays → history read-only), `+ Add note` collapsed-tap-blur-empty (no mutate, MIN-v2-2 contract), history read-only with no note renders nothing, 2000-char `maxLength` truncation, soft-deleted exercise still surfaces note on progress, lbs preference is note-agnostic.

### Edited files
- `src/db/schema.ts` (edited) — appended `exerciseNotes` Drizzle table after `measurementEntries`. FK `user_id` cascade, FK `exercise_id` `{ onDelete: "restrict" }` (matches `routine_exercises.exercise_id` + `sets.exercise_id` precedent). Composite index in Drizzle; the partial UNIQUE index + CHECK live in SQL (Drizzle has no first-class support — matches `measurement_entries_user_day_idx` precedent at `schema.ts:211-216`).
- `src/db/types.ts` (edited) — imported `exerciseNotes`, exported `ExerciseNote` / `NewExerciseNote` / `ExerciseNoteRow`.
- `app/(app)/exercises/[id]/progress.tsx` (edited) — mounted `<ExerciseNoteSlot exerciseId={id} editable={true} alwaysExpanded={true} />` between the summary line and the chart-or-empty branch. Wrapped in `<View className="-mx-6 mb-2">` so the slot's `px-4` paddings sit cleanly inside the screen's `px-6` scroll container (the slot's internal padding is its own contract).
- `src/components/exercise-block.tsx` (edited) — mounted `<ExerciseNoteSlot exerciseId={exercise.id} editable={true} />` between the header `</View>` (originally line 215) and the `showVolumeTarget` slot. No `alwaysExpanded` → collapsed `+ Add note` for empty notes (vertical density preserved on the live workout).
- `src/components/read-only-exercise-block.tsx` (edited) — mounted `<ExerciseNoteSlot exerciseId={exercise.id} editable={false} />` between the header `</View>` and the column-header strip. Read-only path: renders italic `text-sm text-gray-600 dark:text-gray-400` text when non-empty, `null` when empty.
- `tests/rls.test.ts` (edited) — appended an `exercise_notes` arm after the `measurement_entries` arm. node:test style (sequence of `await` blocks, no describe/it). Verifies: A INSERT works; B SELECT/UPDATE/DELETE return 0 rows; B INSERT with `user_id: A.id` is rejected (the INSERT policy's `with check` discriminator).

## Deviations from design

1. **`<ExerciseNoteSlot>` resync guard rewritten to a "draft-divergence" rule instead of `expanded`-gated.** Design v2 (and validator hand-off MIN-v2-1) prescribed: "only adopt `row?.body` when `draft === lastSyncedFromServer` (user hasn't started typing) OR when `expanded === false`". On reading the alwaysExpanded surface (progress screen), the `expanded` local state is never flipped — the editor is always rendered and the user never taps "+ Add note" to set the flag. The `OR expanded === false` clause would therefore let any background refetch clobber in-progress typing on the progress screen.

   **Resolution**: gate purely on draft-divergence from `lastSyncedFromServer.current`. If `draft === lastSyncedFromServer.current`, draft hasn't diverged → safe to adopt the server value. If `draft !== lastSyncedFromServer.current`, the user owns the draft → never clobber, regardless of `expanded`. The intent of MIN-v2-1 ("don't clobber typing") is preserved on every editable surface, including alwaysExpanded. Rationale documented in the component's `useEffect` comment block.

   Implementation detail: `commit()` updates `lastSyncedFromServer.current = next` *before* calling `mutate()`, so when the server's `onSuccess` flushes the row back into the cache the guard re-runs and finds `draft === lastSyncedFromServer.current` → safe to adopt the canonical server value (no-op since they're equal).

2. **`commit()` also normalizes local `draft` to `""` and resets `lastSyncedFromServer.current` to `""` when bailing on the never-existed empty case (MIN-v2-2).** Design v2 only specified the early-return. Without resetting the draft, a user could type whitespace, blur (slot collapses back to "+ Add note"), then re-tap and see the stale whitespace draft. The reset is internally consistent with the contract "no row + blank input means no state changes outside the affordance collapse".

3. **`<ExerciseNoteSlot>` records `previousSnapshot` before swapping `lastSyncedFromServer.current` so a mutate `onError` rolls the snapshot back.** Design v2 specified rollback-on-error implicitly via "subsequent server refetch can resync the draft to the persisted value", but did not name the variable. The implementation captures the pre-mutate snapshot, so a failed write doesn't permanently desync the guard from the server.

4. **`docs/data-model.md` + `docs/decisions.md` NOT updated.** Design v2 listed these. `docs/data-model.md` is significantly out of sync with reality (`measurement_entries` is not documented there either; the catalog cuts off at `sets`). Documenting only `exercise_notes` would create a misleading partial update. Flagging to Conductor / Reviewer for routing — either a separate doc-sync round or accept the drift.

## Soft callbacks made (during this implementation pass)

None.

## Quality gates

- [x] `npm run typecheck` passed — clean.
- [x] `npm run lint` passed — only the pre-existing 1 warning in `.expo/types/router.d.ts` (generated file, unrelated to this change).
- [x] Relevant unit tests pass — `npm run test:unit`: 364/364 green, including the new `tests/unit/exercise-notes-api.test.ts` (10/10).
- [x] `npx playwright test --list tests/e2e/exercise-note.spec.ts` enumerates all 6 specs cleanly.
- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log`.

## Validator hand-off note resolution

| # | Note | Status |
|---|---|---|
| MIN-v2-1 | Resync guard against in-progress typing clobber | Resolved with a **draft-divergence** rule — strictly stronger than the prescribed gate (see Deviation #1). `lastSyncedFromServer` ref tracks the last server-truth snapshot; mid-edit drafts are never overwritten by background refetch on either editable surface (collapsed `<ExerciseBlock>` flow OR alwaysExpanded progress screen). |
| MIN-v2-2 | `commit()` skips mutate when `row == null && draft.trim() === ""` | Resolved. Early-return at the top of `commit()` (and resets local draft to `""` for clean re-tap UX). |
| MIN-v2-3 | Iterative retry loop instead of recursion | Resolved. `for (let attempt = 0; attempt < 2; attempt++)` in `upsertMyExerciseNote`. Verified by the "retries once on 23505 race" unit test (4 `.from()` calls observed; no recursion). |
| MIN-v2-6 | Named CHECK constraint | Resolved. SQL uses `constraint exercise_notes_body_length_check check (char_length(body) <= 2000)`. |
| MIN-v2-5 | Tester full-matrix mandate | Forwarded — Tester to run full e2e matrix touching `<ExerciseBlock>` (`rest-timer-auto-start.spec.ts`, `exercise-progress-ia.spec.ts`, `exercise-session-row-list.spec.ts`, `progress-page.spec.ts`, `soft-deleted-exercises-in-history.spec.ts`, `max-volume-window.spec.ts`, `volume-target.spec.ts`) and confirm no positional-selector regressions. Selectors in those specs use accessibility labels; risk is bounded but must be verified, not assumed. |

## Notes for Reviewer / Tester

- **Reviewer**: see Deviation #1 (resync guard) for the strict-stronger rewrite of MIN-v2-1. The intent of "never clobber typing" is preserved on every surface, including alwaysExpanded (the progress screen) where the v2-prescribed `expanded === false` clause would have failed. The new `lastSyncedFromServer` invariant is documented in the component's `useEffect` comment.
- **Reviewer**: the slot's `commit()` records `previousSnapshot` before swapping `lastSyncedFromServer.current` so an `onError` from the mutation rolls the snapshot back to the pre-mutate value. A subsequent server refetch then re-syncs the draft to the persisted value. Verify this is acceptable error-recovery semantics for a low-frequency action.
- **Reviewer**: the e2e spec uses the placeholder `Add a note for this exercise…` and the accessibility label `Exercise note` as the two main selectors for the slot's `<Textarea>`. The `+ Add note` collapsed affordance carries `accessibilityLabel="Add a note for this exercise"` (without the trailing ellipsis, to avoid confusion with the placeholder). If you'd prefer alignment, flag for follow-up — not in scope for this round.
- **Tester (MIN-v2-5)**: please run the full e2e matrix touching `<ExerciseBlock>` listed above plus the new `tests/e2e/exercise-note.spec.ts`. The `+ Add note` collapsed Pressable adds one tap-able row (≈ 32-40px) to every editable `<ExerciseBlock>` mount when the note is empty. Selector-positional flakes are unlikely (specs use accessibility labels) but the audit is the mandate.
- **DB migration**: `supabase/migrations/0010_exercise_notes.sql` is staged for the user to run `npm run db:push` separately. Did NOT push as part of this round per instruction.
- **Cache buster (`src/lib/query-client.ts`)**: not bumped. The change is additive (new query key `["exercise_note", id, "me"]`); no existing persisted query shape is modified. Bump only if a future migration alters a persisted query's row shape. Verified against `docs/decisions.md` Decision 9.
- **`docs/data-model.md` + `docs/decisions.md`**: NOT updated in this round (see Deviation #4).

## File:line summary of code changes

- `supabase/migrations/0010_exercise_notes.sql:1-71` — new migration.
- `src/db/schema.ts:219-247` — appended `exerciseNotes` table definition.
- `src/db/types.ts:4` — added `exerciseNotes` to imports.
- `src/db/types.ts:32-33` — added `ExerciseNote` + `NewExerciseNote` inferred types.
- `src/db/types.ts:174-182` — added `ExerciseNoteRow` snake-case row type.
- `src/api/exercise-notes.ts:1-95` — new API.
- `src/hooks/use-exercise-note.ts:1-40` — new hook pair.
- `src/components/exercise-note-slot.tsx:1-185` — new presenter component.
- `app/(app)/exercises/[id]/progress.tsx:14` — added `ExerciseNoteSlot` import.
- `app/(app)/exercises/[id]/progress.tsx:140-145` — mounted slot between summary and chart branch.
- `src/components/exercise-block.tsx:6` — added `ExerciseNoteSlot` import.
- `src/components/exercise-block.tsx:217` — mounted slot below header.
- `src/components/read-only-exercise-block.tsx:3` — added `ExerciseNoteSlot` import.
- `src/components/read-only-exercise-block.tsx:77` — mounted slot below header (read-only).
- `tests/rls.test.ts:131-186` — appended `exercise_notes` arm.
- `tests/unit/exercise-notes-api.test.ts:1-272` — new unit tests.
- `tests/e2e/exercise-note.spec.ts:1-345` — new e2e spec.

---

## Round 2 — test-only fixes (2026-05-25)

Test report `test-report-v1.md` flagged 2/6 specs in `tests/e2e/exercise-note.spec.ts` as failing on spec defects (feature itself verified correct via diagnostic + 4 screenshots + 4/6 passing specs). This round applies only the 3 hand-off fixes to the test file. No source changes.

### Scope
- Files touched: `tests/e2e/exercise-note.spec.ts` (1 file, test-only).
- Source code: **untouched**.
- Migrations: **untouched**.

### Fixes applied

1. **Golden test #1 blur sequence (`:137-176`)** — Replaced the fragile "click exercise-name heading + `document.activeElement.blur()`" pair with a DOM-targeted self-contained blur sequence:
   - Explicit `el.focus()` first (so React's focus delegation has a registered handler to fire blur against).
   - `dispatchEvent(new FocusEvent("focusout", { bubbles: true }))` (React 17+ uses focusout under the modern delegation).
   - `dispatchEvent(new Event("blur", { bubbles: true }))` + native `el.blur()` for cross-runtime parity.
   - **Critically**, wrapped the dispatch with `page.waitForResponse((res) => res.url().includes("/rest/v1/exercise_notes") && res.request().method() === "POST")` registered BEFORE the blur and awaited AFTER. This guarantees the server round-trip lands before navigation, removing the race where the local Textarea value-assertion (`toHaveValue`) would pass on local-draft state even when the POST never fired.

2. **Golden test #1 post-Finish navigation (`:236-244`) and test #3 (replaced wholesale)** — Adopted the verdict-screen-aware pattern from `tests/e2e/end-of-session-verdict.spec.ts:245-274`:
   ```ts
   page.once("dialog", (d) => void d.accept());
   await page.getByText("Finish", { exact: true }).last().click();
   await page.waitForURL(/\/workout\/verdict\//, { timeout: 15_000 });
   await page.getByText("Done", { exact: true }).last().click();
   await page.waitForURL(/\/workout$/, { timeout: 10_000 });
   ```
   The previous direct `waitForURL(/\/workout$/)` after Finish was based on a pre-verdict-feature reality.

3. **Golden test #1 history-detail set seeding (`:215-234`)** — Added an admin `sets` insert AFTER picking the exercise and BEFORE clicking Finish, so the finished session contains at least one row. The read-only history view enumerates exercises from the `sets` table (`app/(app)/history/[id].tsx:87-113`): zero sets ⇒ no `<ReadOnlyExerciseBlock>` mounts ⇒ nothing to assert against. Used `.select("id").single()` to make FK/constraint violations loud (the silent variant masked a real failure during round-2 iteration).

4. **Test #3 rewritten to admin-only seed (`:328-396`)** — Replaced the entire UI-driven flow (quick-start → picker → admin set insert → Finish → verdict → history) with a fully admin-seeded ended session + working set, then deep-link directly to `/history/<sessionId>`. Pattern mirrors `tests/e2e/read-only-history.spec.ts:82-151`. Rationale: the assertion is about the slot rendering nothing for a row-less note, NOT about the live-workout/Finish/verdict navigation — coupling them was the source of the round-1 spec defect plus a real flake observed during round-2 iteration (the UI-driven path had a race where the `sets` row didn't propagate to the read-only history's query). The admin-seeded path is deterministic.

### Quality gates (round 2)

- [x] `npm run typecheck` — clean.
- [x] `npm run lint` — clean (only the pre-existing 1 warning in `.expo/types/router.d.ts`).
- [x] `npx playwright test tests/e2e/exercise-note.spec.ts` — **6/6 PASS**. Verified across 3 consecutive runs.
- [x] No new `any`, no new `// @ts-ignore`, no stray `console.log`.

### Files touched (round 2)

- `tests/e2e/exercise-note.spec.ts` — 4 edits across 2 of the 6 specs (test #1 golden + test #3 history read-only).

### Deviations from the round-2 hand-off plan

1. **Fix #1 went beyond the prescribed minimum.** The hand-off said "use `page.keyboard.press('Tab')` OR `page.evaluate(() => document.activeElement.blur())`". A first iteration with just the explicit DOM-blur reproduced the round-1 failure (the textarea value-assertion at `:174` passes on local draft state regardless of whether the POST fired). I therefore upgraded to the explicit `el.focus() → focusout + blur + el.blur()` sequence AND added `page.waitForResponse` for the POST. Justification: the original "wait for `toHaveValue`" gate was insufficient because RN-web's `<Textarea>` reflects the local draft state regardless of the server commit, so the next step (live-workout `getByLabel("Exercise note").toHaveValue(noteBody)`) could only succeed if the row landed on the server before navigation. Confirmed by 3 consecutive 6/6 green runs.

2. **Fix #3 went beyond the prescribed minimum.** The hand-off said "add a working set log via UI or admin before tapping Finish". I started with admin-insert via UI flow; the first iteration leaked an FK-validation silent path and an intermittent race where the inserted set wasn't visible to the history query in subsequent runs. The deterministic fix was to skip the UI flow entirely and admin-seed the ended session + set + skip directly to /history/<id>. Justification: test #3's actual contract is "read-only block + empty note ⇒ slot renders nothing"; coupling it to the live-workout finish flow added zero coverage and introduced the round-1 + round-2 flake. The admin-only path mirrors precedent (`read-only-history.spec.ts`).

### Notes for Tester

- The new e2e suite is now stable: 6/6 pass across 3 consecutive runs in this round.
- The 8-spec adjacent matrix (regression check) was confirmed clean by round-1 Tester; this round only touched the new spec, so no regression re-run is required.
- The "Exercise note" feature itself is unchanged. Source verification (typecheck, lint, unit tests) remains as documented in the original Quality gates section above.
