# Review v1 — 2026-05-21_1308_set-check-button

Reviewing: the diff for the implementation against `design-v2.md` and `validation-v2.md`.

## Diff scope
- Diff command: `git diff 66b2784f...HEAD` (baseline recorded in `state.md`). All in-scope changes are uncommitted on `main`.
- Files changed (in-scope): 11
  - NEW: `supabase/migrations/0007_set_completed_at_nullable.sql`, `src/components/choose-action-modal.tsx`
  - EDITED: `src/db/schema.ts`, `src/db/types.ts`, `src/api/sets.ts`, `src/api/progress.ts`, `src/hooks/use-sets.ts`, `src/components/set-input.tsx`, `src/components/exercise-block.tsx`, `src/lib/query-client.ts`, `app/(app)/workout/[sessionId].tsx`, `tests/e2e/soft-deleted-exercises-in-history.spec.ts`
- Net lines: +335 / -23 (in scope only — excludes unrelated docs/screenshot churn in working tree).
- `npm run typecheck`: clean (only `tsc --noEmit` invocation echoed, no diagnostics).

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| Migration 0007 is one ALTER, no backfill | yes | `supabase/migrations/0007_set_completed_at_nullable.sql:13` — single `alter table ... drop not null`. Header comment documents semantics. |
| `completedAt` no longer `.notNull()` | yes | `src/db/schema.ts:151` — `timestamp("completed_at", { withTimezone: true })` (no `.notNull()`); comment block at 149–150 cites the migration. |
| `SetRow.completed_at: string \| null` | yes | `src/db/types.ts:124`. |
| `logSet` inserts `completed_at: null` | yes | `src/api/sets.ts:69`. |
| `listSetsForSession` secondary `set_number` sort + `nullsFirst: false` | yes | `src/api/sets.ts:31-32`. |
| `listSetsForExercise` secondary `set_number` sort | yes | `src/api/progress.ts:19-20`. Note: no `nullsFirst` here — defensible because the query is gated on finished sessions (`sessions.ended_at IS NOT NULL`) and the Finish-flow guarantees no `completed_at IS NULL` rows survive into finished sessions. |
| `checkSet(id)` filters `deleted_at IS NULL` | yes | `src/api/sets.ts:159-165`. |
| `uncheckSet(id)` filters `deleted_at IS NULL` | yes | `src/api/sets.ts:173-179`. |
| `bulkCheckAllInSession` filters `completed_at IS NULL` + `deleted_at IS NULL` | yes | `src/api/sets.ts:188-196`. Single PostgREST UPDATE. |
| `bulkSoftDeleteUncheckedInSession` two-step + cascade keeps checked children | yes | `src/api/sets.ts:210-246`. Cascade has `.is("completed_at", null)` filter at line 243 — checked dropset children survive (MAJ-2 resolution). Shared `nowIso`. Early returns when `uncheckedIds.length === 0`. |
| New hooks invalidate only `["sets", sessionId]`, NOT `["stats"]` | yes | `src/hooks/use-sets.ts:95-133`. Verified `useFinishSession` covers `["stats"]` + `["progress"]` at `use-sessions.ts:62-63`. |
| `<ChooseActionModal>` cross-platform RN `<Modal>` | yes | `src/components/choose-action-modal.tsx:56-61`. `accessibilityLabel === label` at line 92. Each button `min-h-11` at line 93 (MIN-2). `onRequestClose` wired for hardware back. |
| Modal button order top→bottom = Primary → Destructive → Cancel | yes | `app/(app)/workout/[sessionId].tsx:436-450` — exact labels: "Check all and finish" (primary), "Finish without saving unchecked" (destructive), "Cancel". |
| `<SetInput>` `showCheckable` default false; check icon `h-11 w-11` | yes | `src/components/set-input.tsx:65,119`. `accessibilityLabel` pair correct (116-118). Checked tint `bg-blue-50 dark:bg-blue-950/30` at 108. Inputs remain editable when checked (no `editable={false}`). |
| `<ExerciseBlock>` `showCheckable` default false; PREPENDED `w-11` spacer | yes | `src/components/exercise-block.tsx:48,159`. The `w-7` badge spacer at line 160 is preserved (MIN-3 — additive, not replacement). |
| History detail does NOT pass `showCheckable` | yes | `grep` of `showCheckable` shows only one call site in `app/(app)/workout/[sessionId].tsx:366`; `app/(app)/history/[id].tsx:240` `<ExerciseBlock>` invocation has no `showCheckable` prop → defaults to `false`. |
| Live finish flow: `uncheckedCount === 0` → `confirmDelete`; >0 → modal | yes | `app/(app)/workout/[sessionId].tsx:230-250`. The 3-button modal opens via `setFinishModalOpen(true)` only when `uncheckedCount > 0`. Failure path: `console.warn` + early-return without finishing (matches design Decisions 8/9). |
| Cache buster bumped to `"schema-2026-05-21-set-check"` | yes | `src/lib/query-client.ts:27`. |
| Only `soft-deleted-exercises-in-history.spec.ts:150-163` modified (MAJ-1) | yes | `git status` confirms only that one spec is modified in `tests/e2e/`. The 3 other specs are untouched. Edit uses `.first().click()` twice (MIN-4) — confirmed at spec lines 168-169. |
| No new `any`, no `// @ts-ignore`, no stray `console.log` | yes | Scan of added lines under `src/` and `app/` returns zero hits. `console.warn` is reused for error paths consistent with surrounding code. |

## Issues

### Blockers
None.

### Majors
None.

### Minors

- **[MIN-1]** `src/api/progress.ts:19-20`: `listSetsForExercise` omits `nullsFirst` while `listSetsForSession` uses `nullsFirst: false`. The query is gated on `sessions.ended_at IS NOT NULL` so finished sessions should never carry `completed_at IS NULL` rows — but if a future code path lets a null slip through (e.g. a manual unckeck after a session is finished, or a direct DB import), this query would order nulls inconsistently across PostgREST versions. Asymmetry is a minor latent footgun. **Fix**: add `nullsFirst: false` for symmetry with `listSetsForSession`.

- **[MIN-2]** `src/components/choose-action-modal.tsx:69-73`: the inner card `<Pressable>` exists solely to absorb the backdrop tap (the comment on line 67-68 explains this). A `<Pressable>` with an empty `onPress` is fine functionally but flags as interactive to a11y trees — the card itself shouldn't be a button. **Fix**: either set `accessibilityElementsHidden`/`importantForAccessibility="no"` on the inner Pressable, or replace it with a `<View>` and use `event.stopPropagation()` on its `onTouchStart`/`onStartShouldSetResponder`. Low priority — the user-visible behavior is correct and the e2e selectors target the inner buttons by label.

- **[MIN-3]** `src/components/choose-action-modal.tsx:70-72`: the inner Pressable's `onPress` is a no-op with a comment explaining "just absorb the tap". The "why" is in the comment ("so the backdrop doesn't dismiss") — good — but the empty body is mildly confusing. **Fix**: move the rationale into a one-liner above the Pressable and drop the no-op handler, or wire `onPressIn` to a stop-propagation alternative. Cosmetic.

- **[MIN-4]** `src/api/sets.ts:223`: `(r) => r.id as string` cast on the `.select("id")` row. PostgREST returns `id` as `unknown` in supabase-js's inferred shape when no explicit row type is given. Narrow cast is acceptable but could be cleaner: `await supabase.from("sets").select<"id", { id: string }>("id")` or attach `<{ id: string }>` to the call. **Fix**: optional — pin the row shape for type-safety. The current cast is not a new `any` and the runtime behavior is correct.

## Security checklist

- [x] **RLS**: only modifications are to `public.sets`, which already has RLS policies (`auth.uid() = user_id`). Migration 0007 changes nullability only — does not touch policies. All new API calls (`checkSet`, `uncheckSet`, `bulkCheckAllInSession`, `bulkSoftDeleteUncheckedInSession`) are PostgREST updates and reads on `sets`, gated by RLS row-by-row. The two-step `bulkSoftDeleteUncheckedInSession` reads `uncheckedIds` under RLS so the subsequent `.in("id", uncheckedIds)` cannot be spoofed across users.
- [x] **No service-role key** in client code. None of the new/edited files under `src/`, `app/` reference `SUPABASE_SERVICE_ROLE_KEY`. The only reference is in `tests/e2e/soft-deleted-exercises-in-history.spec.ts:30` (test admin client, pre-existing).
- [x] **No raw SQL via rpc** introduced. All new mutations are typed PostgREST builder calls.
- [x] **`EXPO_PUBLIC_*` env vars** unchanged; no secrets added.

## Style / convention checklist

- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] Comments narrate *why*, not *what* (e.g., `sets.ts:233-238` cascade-discard rationale, `set-input.tsx:11-22` prop semantics, `choose-action-modal.tsx:39-47` button-order convention). The few `// no-op` comments in the modal absorbent-Pressable are flagged in MIN-2/3 but are explanatory.
- [x] Imports follow project style: relative-via-`~/...` aliases for `src/`, package imports first, then internal.
- [x] New files placed in conventional folders: `src/components/choose-action-modal.tsx` matches the existing modal precedents (`exercise-picker.tsx`, `plate-calculator.tsx`); migration in `supabase/migrations/`.

## Documented deviations from design (acceptable)

- **Modal host location**: design said "mount `<ChooseActionModalHost />` at `app/_layout.tsx`"; implementation uses a screen-local `<ChooseActionModal>` in `app/(app)/workout/[sessionId].tsx`. The implementer prompt §11 explicitly delegated this to the implementer. Rationale documented in `implementation.md` (avoid singleton-resolver pattern for a single call site; matches `<ExercisePicker>`/`<PlateCalculator>` precedents already used on this same screen). No e2e-observable surface difference. Not a major.
- **Modal API shape**: design sketched a Promise-based `chooseAction(opts): Promise<string>`; implementation is props-based (`visible`, `buttons[]`, `onClose`) with per-button `onPress`. Direct consequence of the deviation above. Accessibility-label-as-selector contract preserved.

Both deviations are documented in `implementation.md:51-52` with rationale and explicitly cite the implementer-discretion language in the design's file plan. Pipeline rule: "Implementation deviating from design without a justification in `implementation.md` is a **major**." With justification → not a major.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 4 minors.
- All v2 validator items resolved (MAJ-1 test-edit scope, MAJ-2 cascade filter, MAJ-3 secondary sort, MIN-1 button order, MIN-2 `min-h-11`, MIN-3 irreversibility warning, MIN-4 finish invalidations).
- All v1 + v2 design contracts verified at the file:line level.
- Both documented deviations have explicit design-time discretion language; do not count as majors.
- Recommendation: invoke Tester. Minors are quality-of-life suggestions and can be carried as debt or addressed in a follow-up; none affect correctness or security.
