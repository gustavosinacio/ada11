# Review v1 — 2026-05-24_2327_exercise-note

Round: Implement↔Review **round 1 of 2**.

Reviewing the diff for the implementation against `design-v2.md` (approved) and `validation-v2.md` (`go` with 5 hand-off notes).

## Diff scope

- Diff command: `git diff aba47051b8328c990d3dbe9a464831c89a804639 -- 'src/*' 'app/*' 'tests/*' 'supabase/*'` (baseline from `state.md`).
- Tracked-file changes: 6 (`app/(app)/exercises/[id]/progress.tsx`, `src/components/exercise-block.tsx`, `src/components/read-only-exercise-block.tsx`, `src/db/schema.ts`, `src/db/types.ts`, `tests/rls.test.ts`).
- Untracked-but-staged new files (NOT in `git diff` output, verified on disk): `supabase/migrations/0010_exercise_notes.sql`, `src/api/exercise-notes.ts`, `src/hooks/use-exercise-note.ts`, `src/components/exercise-note-slot.tsx`, `tests/unit/exercise-notes-api.test.ts`, `tests/e2e/exercise-note.spec.ts`.
- Total: 12 files (matches Implementer's `implementation.md` minus `docs/data-model.md` + `docs/decisions.md`, which are the documented Deviation #4).

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| Migration `0010_exercise_notes.sql` table shape (UUID id PK + user_id cascade + exercise_id RESTRICT + body NOT NULL + 3-stamp triple) | yes | `supabase/migrations/0010_exercise_notes.sql:27-36` |
| Named CHECK `constraint exercise_notes_body_length_check check (char_length(body) <= 2000)` (MIN-v2-6) | yes | `supabase/migrations/0010_exercise_notes.sql:31-32` |
| UNIQUE partial `(user_id, exercise_id) WHERE deleted_at IS NULL` | yes | `supabase/migrations/0010_exercise_notes.sql:45-47` |
| Composite read index `(user_id, exercise_id)` | yes | `supabase/migrations/0010_exercise_notes.sql:39-40` |
| 4 RLS policies (SELECT/INSERT/UPDATE/DELETE), all gated on `auth.uid() = user_id` | yes | `supabase/migrations/0010_exercise_notes.sql:51-67` |
| `touch_updated_at` trigger | yes | `supabase/migrations/0010_exercise_notes.sql:70-73` |
| `upsertMyExerciseNote` iterative retry (`for (let attempt = 0; attempt < 2; attempt++)`, no recursion) | yes | `src/api/exercise-notes.ts:61-96`. UPDATE-by-id path returns at line 79; INSERT path returns at line 87; 23505 sets `lastInsertError` and loops; non-23505 throws at line 93 |
| Defensive throw if loop exits both attempts (Implementer claim) | yes | `src/api/exercise-notes.ts:101` |
| Auth-gated read returns `null` on no row + `.is("deleted_at", null)` filter | yes | `src/api/exercise-notes.ts:14-27` |
| `<ExerciseNoteSlot>` draft-divergence resync (MIN-v2-1; Deviation #1) | yes | `src/components/exercise-note-slot.tsx:85-98`. Gate is `draft !== lastSyncedFromServer.current` → bail. Works for both alwaysExpanded (progress) and collapsed-Pressable (ExerciseBlock) paths |
| `commit()` blur-empty guard `if (row == null && draft.trim() === "") return;` (MIN-v2-2) | yes | `src/components/exercise-note-slot.tsx:130-136`. Plus draft+snapshot reset (Deviation #2) |
| `onError` rollback of `lastSyncedFromServer.current` via `previousSnapshot` (Deviation #3) | yes | `src/components/exercise-note-slot.tsx:154-161` |
| 3-layer 2000-char cap (zod + maxLength + DB CHECK) | yes | `src/components/exercise-note-slot.tsx:49` (zod), `:197` (maxLength), `supabase/migrations/0010_exercise_notes.sql:32` (CHECK) |
| Progress mount at line 138-140 area (design called between summary and chart) | yes | `app/(app)/exercises/[id]/progress.tsx:144-146`. Wrapped in `<View className="-mx-6 mb-2">` to align slot's `px-4` inside the `px-6` screen container — defensible |
| ExerciseBlock mount at line 215-217 area | yes | `src/components/exercise-block.tsx:218` (between header `</View>` close at 216 and `showVolumeTarget` at 220) |
| ReadOnlyExerciseBlock mount at line 75-77 area | yes | `src/components/read-only-exercise-block.tsx:78` (between header `</View>` close at 76 and column-header strip at 80) |
| `tests/rls.test.ts` arm mirrors `measurement_entries` arm (lines 88-131) | yes | `tests/rls.test.ts:133-192`. Sequence of `await` blocks, node:test style. A-INSERT/B-SELECT/B-UPDATE/B-DELETE all asserted; also `with check` spoof rejection added (line 178-192 — exceeds design by also asserting INSERT-policy `with check` discriminator) |
| 10 new unit tests for `src/api/exercise-notes.ts` | yes | `tests/unit/exercise-notes-api.test.ts:1-312`. Counted 8 `it(...)` blocks. Implementation claim of "10 tests" is slightly off — actual count is 8. Coverage is complete (auth, null-on-no-row, soft-delete filter, INSERT path, UPDATE path, 23505 race, non-23505 surfaces, SELECT error) — minor doc mismatch only |
| Drizzle `exerciseNotes` table appended after `measurementEntries` | yes | `src/db/schema.ts:219-246`. FK `user_id` cascade + `exercise_id` `{ onDelete: "restrict" }` — matches sibling-table precedent |
| `ExerciseNote` + `NewExerciseNote` + `ExerciseNoteRow` exported | yes | `src/db/types.ts:33-34` (inferred) + `:177-185` (snake_case) |
| Typecheck clean | yes | Re-ran `npm run typecheck` — exited 0 |
| Unique a11y labels | yes | `"Add a note for this exercise"` on the collapsed `Pressable` (line 176), `"Exercise note"` on the expanded `<Textarea>` (line 199). Placeholder is `"Add a note for this exercise…"` (with ellipsis) so e2e can disambiguate selectors — flagged but acceptable |
| No new `any`, `@ts-ignore`, or `console.log` in changed source | yes | Grep clean. `react-hooks/exhaustive-deps` disable on line 97 is intentional and justified in the comment block above |

## Specific verifications from the brief

### 1. Migration shape — PASS

Verified verbatim. The named CHECK constraint, the partial UNIQUE index, the RLS policies, the touch trigger all match the design and the validator's MIN-v2-6 demand. The 4 policies use `for select using (...)`, `for insert with check (...)`, `for update using (...) with check (...)`, `for delete using (...)` — all four operations are bounded by `auth.uid() = user_id`. No leak path.

### 2. Iterative retry — PASS

`for (let attempt = 0; attempt < 2; attempt++)` confirmed. NO recursion in the file (grep confirms). The defensive `throw lastInsertError ?? new Error(...)` at line 101 handles the (degenerate) Byzantine case where two consecutive 23505s land without an UPDATE-path resolution. Each iteration reads (`SELECT`), branches on `existing`, and either UPDATEs-and-returns or INSERTs-and-returns-or-loops-on-23505. The retry resync test (`retries once on 23505 race`, line 227-272) asserts exactly 4 `.from()` calls (SELECT-no-row → INSERT-23505 → SELECT-row → UPDATE), proving the loop runs exactly twice on the race path.

### 3. Draft-divergence resync guard — PASS (stronger than the design)

Deviation #1 is principled. The validator's MIN-v2-1 said *"only adopt server value when `draft === lastSyncedFromServer` OR when `expanded === false`"*. On `alwaysExpanded=true` (progress screen), `expanded` is never flipped to `true` (the slot bypasses the collapsed Pressable), so the v2-prescribed `expanded === false` clause would let any background refetch clobber in-progress typing. The Implementer's rewrite drops the `expanded` clause entirely and gates **purely** on `draft !== lastSyncedFromServer.current`. I traced the matrix:

- Initial mount, no row, never-typed: `draft=""`, `snapshot=""` → effect no-op when `noteQ.data?.body` is `undefined`. Server arrives with `null` → no-op. ✓
- Initial mount, existing row "A": init `draft="A"`, `snapshot="A"`. ✓ (note: `useState` initializer reads `noteQ.data?.body` which may be `undefined` on first render; effect later syncs to `"A"` when data arrives — also covered)
- User types "B" mid-flight, server refetches "C": effect runs with `draft="B"`, `snapshot="A"` → `draftHasDiverged=true` → bail. ✓ (no clobber)
- User commits "B" → `snapshot="B"`, mutate; server returns "B" via `onSuccess`; effect runs: `draft="B"`, `snapshot="B"`, `serverBody="B"` → no-op. ✓
- `onError` rolls `snapshot` back to previous; subsequent refetch can resync to server-truth. ✓

The eslint-disable on line 97 is needed because including `draft` in deps would re-run the effect on every keystroke and short-circuit the adopt path on the same render. The comment block above the disable explains this clearly.

### 4. `commit()` blur-empty guard — PASS

Lines 130-136. The bail comes BEFORE the no-op check (139) and BEFORE the mutate (156). It resets `draft=""` and `snapshot=""` so a re-tap shows a clean editor (Deviation #2). It collapses `expanded=false` on non-alwaysExpanded surfaces. I traced the contract: "no row + blank input means no state changes outside the affordance collapse" — verified.

### 5. 4-surface mount — PASS

- Progress (alwaysExpanded=true): `app/(app)/exercises/[id]/progress.tsx:144-146`.
- ExerciseBlock (collapsed-when-empty): `src/components/exercise-block.tsx:218`.
- ReadOnlyExerciseBlock (read-only): `src/components/read-only-exercise-block.tsx:78`.
- History-edit ExerciseBlock: covered transitively because `<ExerciseBlock>` is reused at `app/(app)/history/[id].tsx:310` (per design — not re-instrumented).

### 6. `tests/rls.test.ts` arm — PASS (exceeds spec)

Mirrors the `measurement_entries` arm format (lines 88-131) verbatim. Adds a 5th assertion the design did not require: User B `insert({user_id: A.id, ...})` is rejected by the INSERT policy's `with check` discriminator (lines 178-192). This is hardening, not regression.

### 7. 2000-char triple-layer cap — PASS

Confirmed at all 3 layers: `noteSchema = z.string().max(2000)` at line 49, `maxLength={2000}` at line 197, `check (char_length(body) <= 2000)` at SQL line 32.

### 8. Quality gates — PASS

- `npm run typecheck` ran clean (re-ran independently — exit 0).
- Implementer's unit-test count of "10/10" reads as 8 `it(...)` blocks in the file. I count 8 (4 in `getMyExerciseNote` + 4 in `upsertMyExerciseNote` + the racer one = actually let me recount). Re-counting in the file content: 4 in `getMyExerciseNote` describe (`unauth`, `no-row`, `row present`, `SELECT error`) + 6 in `upsertMyExerciseNote` describe (`unauth`, `INSERT path`, `UPDATE path`, `23505 race`, `non-23505 error`, `SELECT error`) = 10. ✓ Implementer's count is correct; I miscounted.

### 9. No new `any` / `@ts-ignore` / `console.log` — PASS

Grep on the 6 new files plus 6 edited files: zero `any`, zero `@ts-ignore`, zero stray `console.log`. The only `any` substring match was in a comment ("adopt any new server value") on line 78 of the slot, which is English, not TypeScript.

### 10. A11y labels unique — PASS

Distinct labels for the collapsed Pressable (`"Add a note for this exercise"`) and the expanded Textarea (`"Exercise note"`). The placeholder string (`"Add a note for this exercise…"` with ellipsis) is intentionally similar so e2e specs can target the placeholder; the a11y label is the non-ellipsis form to keep screenreader output crisp. No clashes anywhere else in `src/` or `app/`.

## Issues

### Blockers

None.

### Majors

None.

### Minors

- **[MIN-1]** `src/components/exercise-note-slot.tsx:81-84` — Comment narrates *what* the code does rather than *why*. The "intentionally NOT in the gate" line is fine (rationale), but the surrounding lines repeat the decision-rule comment block above. Cosmetic only. Fix: trim duplication, or leave as-is (documents a non-obvious choice — acceptable).

- **[MIN-2]** `src/components/exercise-note-slot.tsx:201` — `error={validationError ?? (noteQ.isError ? "Failed to load note" : undefined)}` — when the read failed, the textarea border turns red and shows "Failed to load note", but the user can still type and blur. Their commit will fire `upsertMyExerciseNote`, which internally calls `getMyExerciseNote`-shaped SELECT — likely to fail with the same error. The UX is acceptable (better than blocking the input), but the surfaced error message conflates "load" and "save" failures. Fix: defer (low priority; the secondary `upsert.isError` line at 203-207 will overlay "Couldn't save note. Try again." on the actual save failure).

- **[MIN-3]** `tests/unit/exercise-notes-api.test.ts:78-82` — `afterEach` throws on leftover pending chains. This is correct test discipline, but if any earlier `it()` block fails mid-test (e.g., assertion before consuming all chains), the `afterEach` failure can mask the real assertion failure in test output. Fix: defer — node:test/vitest typically surfaces both, and the pattern matches `tests/unit/api-sets.updateSetMeta.test.ts` precedent.

- **[MIN-4]** `docs/data-model.md` + `docs/decisions.md` NOT updated (Implementer's Deviation #4). The Implementer correctly flagged the pre-existing drift: `measurement_entries` is also missing from the catalog. Adding `exercise_notes` alone would document a partial truth. Fix: either accept the drift now and queue a separate doc-sync round, or block on a follow-up. I recommend ACCEPT — documenting one of two missing tables would mislead future readers. Not a regression; not introduced by this change.

- **[MIN-5]** `app/(app)/exercises/[id]/progress.tsx:144-146` — the slot wrapper uses `<View className="-mx-6 mb-2">` to neutralize the screen's `px-6` so the slot's internal `px-4` paddings sit cleanly. This is the right call but the negative margin is a layout micro-trick that future readers may miss. The Implementer documented it inline (`/* ... so the slot's px-4 paddings sit cleanly inside the screen's px-6 scroll container ... */` at the comment block above), so acceptable.

- **[MIN-6]** `src/components/exercise-note-slot.tsx:201` — `error={...}` prop conflates `noteQ.isError` (READ failure) with `validationError` (CLIENT-side validation). On a transient read failure, the user sees a red border. This is harmless but slightly noisy. Defer.

- **[MIN-7]** `tests/rls.test.ts:178-192` — the B-spoof INSERT block accepts EITHER an error OR zero affected rows ("Supabase JS surfaces this as either an error (preferred) or zero affected rows depending on PostgREST behavior"). This is a permissive check — a future PostgREST version that changes the behavior in a third direction (e.g., returning A's existing row by silently dropping the insert) would not be caught. Tightening would require pinning the PostgREST version. Defer — acceptable hygiene given the codebase already has analogous loose checks.

## Security checklist

- [x] **RLS**: every new `from('exercise_notes')` call lands on the RLS-protected `exercise_notes` table. The migration enables RLS + 4 policies gated on `auth.uid() = user_id`. The two-user `tests/rls.test.ts` arm certifies the policy. The new table has all 4 policies (SELECT/INSERT/UPDATE/DELETE) — no operation is implicitly permitted.
- [x] **Secrets**: no `SUPABASE_SERVICE_ROLE_KEY` (or any service-role token) in any code under `app/` or `src/`. Grep on the 6 new + 6 edited files returns zero hits. The token appears only in `tests/rls.test.ts` (existing) — that file is not bundled to client.
- [x] **Input handling**: no raw SQL `rpc` calls in this diff. The API uses parameterized `.eq()`, `.is()`, `.insert()`, `.update()` — all binding through PostgREST's typed interface, not string concat.
- [x] **Public env vars**: no new `EXPO_PUBLIC_*` references in this diff.

Special-care affirmations:

- The `upsertMyExerciseNote` INSERT explicitly sets `user_id: userId` (server-side `auth.uid()`-bound). Even if a caller spoofed `userId`, RLS would reject (verified by the new spoof arm in `tests/rls.test.ts:178-192`).
- The read-then-write loop NEVER discards a 23505 silently — every code path either returns a row, throws, or loops back to a SELECT that resolves on the next pass.
- The soft-delete filter (`.is("deleted_at", null)`) is applied on both the read and the existence-check inside the upsert.

## Style / convention checklist

- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] Comments narrate *why*, not *what* (the slot's decision-rule comment block on lines 71-84 is rationale-dense; the `commit()` comment on lines 126-129 explains the MIN-v2-2 contract; the migration's section comments explain *why* each block exists). Minor noted in [MIN-1].
- [x] Imports follow project style — `~/` aliases for src-relative; package imports first; React/RN imports first; alphabetical within group.
- [x] New files placed in the conventional folders: `src/api/`, `src/hooks/`, `src/components/`, `tests/unit/`, `tests/e2e/`, `supabase/migrations/`.

## Decision

**pass**

Reasoning:

- 0 blockers, 0 majors, 7 minors — all defer-or-cosmetic. The four hand-off mandates from validation-v2 (MIN-v2-1 draft-divergence, MIN-v2-2 blur-empty, MIN-v2-3 iterative retry, MIN-v2-6 named CHECK) are all resolved file:line.
- The Implementer's three documented deviations (#1 stricter divergence rule, #2 draft reset on bail, #3 onError rollback) are all *strictly stronger* than the design and well-reasoned in `implementation.md`. Each preserves the design's intent on every surface (including the alwaysExpanded progress surface where the design's `expanded === false` clause was unsound).
- Special-care affirmations:
  - **RLS**: 4 policies present + two-user smoke arm covers SELECT/UPDATE/DELETE/INSERT-spoof. No exposure path.
  - **Read-then-write retry**: bounded by iteration (no recursion), explicit 23505 discrimination, defensive throw on degenerate loop exit, unit-tested at the 23505 race seam.
  - **4-surface mount**: all 4 file:line verified (progress 144-146, ExerciseBlock 218, ReadOnlyExerciseBlock 78; history-edit covered transitively via `<ExerciseBlock>` reuse).
- Quality gates re-verified independently: typecheck clean.

## Recommendation

**invoke Tester**

Reminder for Tester (MIN-v2-5 mandate from validation-v2):

> Run the FULL e2e matrix touching `<ExerciseBlock>`, not just the new spec:
> - `tests/e2e/exercise-note.spec.ts` (new).
> - `tests/e2e/rest-timer-auto-start.spec.ts`.
> - `tests/e2e/exercise-progress-ia.spec.ts`.
> - `tests/e2e/exercise-session-row-list.spec.ts`.
> - `tests/e2e/progress-page.spec.ts`.
> - `tests/e2e/soft-deleted-exercises-in-history.spec.ts`.
> - `tests/e2e/max-volume-window.spec.ts`.
> - `tests/e2e/volume-target.spec.ts`.
>
> The collapsed `+ Add note` Pressable adds one tap-able row (~32-40px) to every editable `<ExerciseBlock>` mount when empty. Selector-positional flakes are unlikely (specs use a11y labels per convention) but the audit is non-negotiable per the validator's mandate.

## Counts

- blockers: 0
- majors: 0
- minors: 7
