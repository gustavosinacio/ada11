# Validation v2 — 2026-05-21_1308_set-check-button

## Summary
All v1 majors (3) and minors (4) addressed substantively. One new major (MAJ-1) is a test-edit scope correction: 3 of the 4 specs in §Mudanças don't actually log any sets, so the prescribed `Mark set as completed` tap would time out. Those specs hit `uncheckedCount === 0` → existing `confirmDelete`/`window.confirm` path → existing `page.on("dialog", ...)` listener works unchanged.

## v1 issues re-verified

| ID | Addressed? | Notes |
|---|---|---|
| MAJ-1 (e2e selector strategy) | partial | Selectors pinned correctly (`"Mark set as completed"`/`"Unmark"` pair + modal labels). But spec-edit prescriptions target the wrong tests. See new MAJ-1. |
| MAJ-2 (cascade-discard semantics) | yes | Picked (a): `.is("completed_at", null)` filter on cascade. Orphan documented as consistent with pre-existing `useDeleteSet` behavior. |
| MAJ-3 (`set_number` secondary sort) | yes | Added to both `listSetsForSession` (`src/api/sets.ts:28`) and `listSetsForExercise` (`src/api/progress.ts:17`). |
| MIN-1 (dialog button order) | yes | iOS HIG vertical stack: Primary (Check all) → destructive (Finish without saving) → Cancel. |
| MIN-2 (header spacer `w-11`) | yes | Documented in §UI spec. See new MIN-3 for "additive vs replacement" clarification. |
| MIN-3 (irreversibility warning) | yes | "Unchecked sets won't be saved. This can't be undone." in modal body. |
| MIN-4 (`useFinishSession` invalidations) | yes | Verified `src/hooks/use-sessions.ts:62-63` invalidates `["stats"]` + `["progress"]`. |

## New issues

### Majors

- **MAJ-1** Three of four spec-edit prescriptions in §Mudanças target tests that log **zero sets**:
  - `tests/e2e/crud.spec.ts:162-202` — Quick start → immediately Finish (no sets).
  - `tests/e2e/remove-exercise.spec.ts:122-171` — 1 set logged then exercise removed (cascades soft-delete → zero non-deleted sets at Finish).
  - `tests/e2e/remove-exercise.spec.ts:189-217` — cancel-removal test, zero sets.
  - `tests/e2e/exercise-progress-ia.spec.ts:186` — Quick start → Finish (zero sets).

  With `uncheckedCount === 0`, the existing `confirmDelete`/`window.confirm` path fires → existing `page.on("dialog", d => d.accept())` listener works unchanged → no test edit needed. The prescribed `getByLabel("Mark set as completed").first().click()` would time out.

  **Fix**: revise §Mudanças so the ONLY spec edited is `soft-deleted-exercises-in-history.spec.ts:150-163` (which logs 2 sets and thus does trigger the new modal). The other 3 specs stay unmodified.

### Minors

- **MIN-1** `set_number` uniqueness per `(session_id, exercise_id)` is application-enforced only; double-tap +Working set could race. Add to Tester checklist; defer DB constraint.
- **MIN-2** Modal buttons need `min-h-11` (or `py-3`) for ≥44pt tap targets on web.
- **MIN-3** Header row needs ADDITIVE spacer — prepend `<View className="w-11" />` to the existing row at `exercise-block.tsx:148`, keep the existing `w-7` badge spacer.
- **MIN-4** Cosmetic: prefer `getByLabel("Mark set as completed").first().click()` twice (auto-relocates after each tap) over `.nth(0)`/`.nth(1)`.

## Verified claims
- `listSetsForSession` at `src/api/sets.ts:22-31`; `.order(...)` line 28. ✓
- `listSetsForExercise` at `src/api/progress.ts:10-36`; `.order` line 17. ✓
- `logSet` insert sets `completed_at` at `sets.ts:63`. ✓
- `useFinishSession.onSuccess` invalidates `["stats"]` and `["progress"]` at `use-sessions.ts:62-63`. ✓
- `schema.ts:149` `completedAt` is `notNull()`. ✓
- `query-client.ts:27` cache buster present. ✓
- Modal cross-platform (RN Web) — `exercise-picker.tsx:42-48` precedent. ✓
- `confirmDelete` web branch is `window.confirm` (`confirm-delete.tsx:22-28`). ✓
- Dropset CHECK constraint requires `parent_set_id IS NOT NULL` when `set_type='dropset'`. ✓
- `set_number` exists, `NOT NULL` (`schema.ts:142`, `0000_schema.sql:56`). ✓ (uniqueness app-enforced only)
- `.is("completed_at", null)` is correct PostgREST-supabase-js syntax. ✓

## Decision

**go** — 0 blockers, 1 major (test-edit scope), 4 minors. Under decision rule (0 blockers + ≤1 major).

Implementer must:
1. **MAJ-1**: edit ONLY `tests/e2e/soft-deleted-exercises-in-history.spec.ts:150-163`. Leave the other 3 specs untouched (they hit `confirmDelete` path, existing listener works).
2. **MIN-1**: add Tester checklist item for double-tap +Working set smoke; defer DB UNIQUE constraint.
3. **MIN-2**: modal buttons `min-h-11` or `py-3`.
4. **MIN-3**: PREPEND `w-11` spacer to header row at `exercise-block.tsx:148`, keep existing `w-7`.
5. **MIN-4**: cosmetic — use `.first()` twice over `.nth(0)`/`.nth(1)`.

Round 2 of 3.
