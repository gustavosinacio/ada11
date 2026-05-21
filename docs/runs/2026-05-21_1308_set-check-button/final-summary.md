# Final summary — 2026-05-21_1308_set-check-button

## Outcome
- **Feature**: Per-set check button on the live workout screen. New sets are unchecked drafts (`completed_at = null`). On Finish: if all checked → existing `confirmDelete` path; if any unchecked → new 3-option `<ChooseActionModal>` (Check all and finish / Finish without saving / Cancel).
- **Pipeline result**: **shipped** (typecheck/lint clean, 74/74 unit, e2e 5/5 stable under `--repeat-each=5`, 25 adjacent regression specs all green).
- **Baseline commit**: `66b2784`.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (web; Playwright stable + adjacent green) |
| Human interventions | 0 |
| Total round-trips | 2 (1 D↔V respin + 1 I↔T respin) |
| Design ↔ Validate rounds | 2 (v1 `no-go`, v2 `go`) |
| Implement ↔ Review rounds | 1 (`pass`) |
| Implement ↔ Test rounds | 2 (v1 `fail` on test spec, v2 `pass`) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~73 min (13:08 → 14:21 BRT) |

## What shipped (11 files + 1 migration + 1 test fix)

**Migration (1 new):**
- `supabase/migrations/0007_set_completed_at_nullable.sql` — `ALTER TABLE sets ALTER COLUMN completed_at DROP NOT NULL`. Applied to linked Supabase.

**Drizzle + types:**
- `src/db/schema.ts:149` — `completedAt` no longer `notNull()`.
- `src/db/types.ts:124` — `SetRow.completed_at: string | null`.

**API helpers:**
- `src/api/sets.ts`:
  - `logSet` inserts with `completed_at: null` (unchecked draft).
  - `listSetsForSession` gets `set_number ASC` secondary sort (MAJ-3).
  - New: `checkSet`, `uncheckSet`, `bulkCheckAllInSession`, `bulkSoftDeleteUncheckedInSession` (with `.is("completed_at", null)` filter on dropset cascade — checked children survive per MAJ-2).
- `src/api/progress.ts:17` — same `set_number` secondary sort.

**Hooks:**
- `src/hooks/use-sets.ts` — 4 new hooks (`useCheckSet`, `useUncheckSet`, `useBulkCheckAllInSession`, `useBulkSoftDeleteUncheckedInSession`). All invalidate `["sets", sessionId]` only.

**Components:**
- NEW `src/components/choose-action-modal.tsx` — cross-platform RN Modal, accessibility labels, `min-h-11` buttons.
- `src/components/set-input.tsx` — `showCheckable` prop, check icon with `accessibilityLabel="Mark set as completed"` / `"Unmark set as completed"`, `bg-blue-50 dark:bg-blue-950/30` tint on checked.
- `src/components/exercise-block.tsx` — `showCheckable` prop, PREPENDED `w-11` header spacer (additive, keeps existing `w-7` per MIN-3).

**Live screen:**
- `app/(app)/workout/[sessionId].tsx` — modal integration, 3-option finish flow, passes `showCheckable={true}` to blocks.

**Cache buster:**
- `src/lib/query-client.ts:27` bumped to `"schema-2026-05-21-set-check"`.

**Tests:**
- `tests/e2e/soft-deleted-exercises-in-history.spec.ts:161-180` — added check-tap before Finish using `expect(...).toHaveCount(N)` gates between clicks (avoids React async re-render race).
- Other 3 e2e specs (`crud.spec.ts`, `remove-exercise.spec.ts`, `exercise-progress-ia.spec.ts`) intentionally untouched — they Finish with zero sets, so they hit the existing `confirmDelete` path unchanged.

## Decisions

1. **Data model** = option (a) repurpose `completed_at`. `NULL` = unchecked draft, `NOT NULL` = checked. Migration drops `NOT NULL`. Pre-feature data unaffected (all checked).
2. **Cascade-discard semantics** = filter to unchecked-only children (`.is("completed_at", null)`). Checked dropset children survive; orphan `parent_set_id` documented as consistent with pre-existing `useDeleteSet` behavior.
3. **Equal-timestamp tie-breaker** = `set_number ASC` as secondary sort in both list queries (instead of staggering timestamps in `bulkCheckAllInSession`).
4. **Modal button order** = iOS HIG vertical stack: Primary (Check all) → Destructive (Finish without saving) → Cancel.
5. **Default state for new sets** = unchecked (matches Strong; the whole point of the feature).
6. **History detail** = does NOT pass `showCheckable` → visually unchanged.
7. **Cache invalidation** = check/uncheck/bulk hooks invalidate `["sets", sessionId]` only. `useFinishSession.onSuccess` covers `["stats"]` + `["progress"]`.
8. **`{ exact: true }` + `toHaveCount` gates** in the e2e — substring match would un-toggle; React async re-render needs explicit synchronization.

## Bugs caught by the pipeline
- **v1 MAJ-1** Validator: e2e dialog selector strategy unspecified. Fixed in v2 with explicit accessibilityLabels.
- **v1 MAJ-2** Validator: cascade-discard would have silently deleted checked dropset children. Fixed in v2 with unchecked-only filter on cascade.
- **v1 MAJ-3** Validator: `bulkCheckAllInSession` collapses N sets to one timestamp → non-deterministic intra-session render order. Fixed in v2 with `set_number` secondary sort.
- **v2 MAJ-1** Validator: 3 of 4 prescribed test edits target tests that log zero sets. Fixed by editing only `soft-deleted-exercises-in-history.spec.ts`.
- **I↔T v1 fail** Tester: spec selector substring-match → labels collided. Fixed in I↔T v2 with `{ exact: true }` + `toHaveCount` gates.

## Known-debt (non-gating)
- 4 Reviewer advisory minors: `nullsFirst` symmetry, modal backdrop a11y nit, empty-body `onPress` comment, `r.id as string` cast.
- `set_number` uniqueness app-enforced only (no DB UNIQUE). Single-active-session makes this safe; double-tap +Working set race deferred as follow-up.
- Cascade orphan `parent_set_id` for checked dropset children — consistent with pre-existing `useDeleteSet` behavior; hidden by `deleted_at IS NULL` filters in history reads.
- Pre-existing unrelated `tests/e2e/crud.spec.ts:131` flake from b51dd01 muscles-picker refactor.

## Why we stopped
- Feature complete. All gates green under stress. 2 respins (D↔V + I↔T) — Validator caught the major design risks pre-implementation; Tester caught a real e2e selector bug post-implementation. Both fixed surgically.

## Artifacts
- discovery.md, design-v1.md, validation-v1.md, design-v2.md, validation-v2.md
- implementation.md, review-v1.md, test-report-v1.md
- implementation-v2.md (fix), test-report-v2.md
- state.md, transcript.md, final-summary.md
- retro.md (post-run, owner)

## Notes for the owner
- **Working tree uncommitted.** Suggested split: `feat(workout): per-set check button + finish-flow modal` + `docs(pipeline): archive set-check-button run`.
- **Migration `0007_set_completed_at_nullable.sql` applied** to the linked Supabase.
- **`completed_at` semantics shift**: pre-feature data unchanged (all checked, since they had `completed_at` set). New sets default to unchecked.
- **Backlog status**: this was the only open item.

## Archive
- To archive: `cp -r docs/runs/2026-05-21_1308_set-check-button "$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-21_1308_set-check-button"` + vault README entry.
