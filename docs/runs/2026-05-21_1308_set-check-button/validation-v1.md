# Validation v1 — 2026-05-21_1308_set-check-button

## Summary

Internally consistent, every cited file:line checks out. Data model choice (option a) is sound and the cache-buster bump follows established Decision 9 precedent. But three majors land — two cross-platform e2e behaviors and one product-semantics call Designer did not surface.

## Decision

**no-go** — 0 blockers, 3 majors, 4 minors.

## Majors

### MAJ-1 — E2E specs will deadlock waiting for `window.confirm` that never fires
4 e2e specs use `page.on("dialog", (d) => void d.accept())` because `confirmDelete` uses `window.confirm` on web. The new `<ChooseActionModal>` is a React Native `<Modal>`, **not** `window.confirm` — Playwright will never fire a `dialog` event.

Design "fix" of "tap check before finish, avoid the dialog" works in the happy path BUT doesn't specify:
- Playwright selectors for the new check icon (`accessibilityLabel="Mark set as completed"`).
- Test-id strategy for the modal buttons so Tester can exercise the discard/auto-check paths.

**Fix**: design must specify (a) accessibilityLabel selectors for new check icon + modal buttons, (b) e2e edits must use `page.getByLabel("Mark set as completed")` to tap check before Finish.

### MAJ-2 — Cascade-discard of checked dropset children is a destructive surprise
Scenario: user logs an unchecked working set, then checks a dropset child onto it. At Finish → "Discard unchecked" → unchecked working set discarded (correct), but the **checked** dropset child ALSO discarded by cascade. The user explicitly opted-in to keeping it.

The "3 unchecked sets" copy doesn't warn about cascade collateral. User silently loses a 4th they had checked.

**Fix** (pick one):
- (a) Filter cascade to only soft-delete **unchecked** children (`.is("completed_at", null)`). Leave checked children orphaned. Document that history reads filter `deleted_at` so the orphan is invisible.
- (b) Pre-flight: count checked children of unchecked parents → dialog copy mentions them.
- (c) Block discard if any unchecked working set has checked dropset children.

(a) is simplest. Designer's choice — but must be explicit.

### MAJ-3 — `bulkCheckAllInSession` writes same `now()` to every row, breaking intra-session order
`src/api/progress.ts:17` orders by `completed_at ASC`. After `bulkCheckAllInSession`, N sets in the same session share an identical timestamp → intra-session render order becomes non-deterministic (Postgres physical order). Set rows in history detail and exercise progress chart can reshuffle between renders.

**Fix** (pick one):
- (a) Stagger timestamps in `bulkCheckAllInSession` (`completed_at = now() + interval N seconds` per row in `set_number` order). Requires server-side UPDATE FROM SELECT or N round-trips.
- (b) Add `set_number` as secondary sort key in `listSetsForSession`/`listSetsForExercise`: `.order("completed_at", { ascending: true }).order("set_number", { ascending: true })`. One line per query.

(b) is the surgical fix.

## Minors

- **MIN-1** Dialog button order doesn't match canonical Cancel position (Strong / iOS HIG = Cancel last; design puts Cancel first). Pick a convention explicitly.
- **MIN-2** Header alignment spacer says `28w` but check button is `w-11` (44pt). Spacer should be `w-11`.
- **MIN-3** "Auto-check all is irreversible" not surfaced to user. Add a subtitle or one-line warning.
- **MIN-4** Design doesn't cite `useFinishSession`'s cache invalidation block (`src/hooks/use-sessions.ts:54-66`) to confirm `["stats"]` + `["progress"]` are invalidated. Important because design relies on this to skip per-mutation `["stats"]` invalidation. Confirm in design.

## Verified claims (no issue)
- `schema.ts:149` `completedAt` is `notNull()`. ✓
- `0000_schema.sql:62` `completed_at timestamptz NOT NULL`. ✓
- `src/api/sets.ts:63` `completed_at: new Date().toISOString()` (JS-side; one-line flip to `null`). ✓
- `<SetInput>` consumers — only `<ExerciseBlock>`. `<ExerciseBlock>` consumers — `workout/[sessionId].tsx:262` and `history/[id].tsx:240`. Default `showCheckable=false` is correctly opt-in. ✓
- `query-client.ts:27` cache-buster present + mounted at `app/_layout.tsx:46`. Bump pattern matches precedent. ✓
- `session-times-form.ts:121` already accepts `readonly (string | null)[]`. ✓
- `stats.ts:29` `.gte("completed_at", ...)` + `.not("sessions.ended_at", "is", null)` filters NULLs + in-progress out. ✓
- `progress.ts:15-17` finished sessions only, filtered. ✓ (Major 3 is the equal-timestamp concern.)
- `scripts/import-strong.ts:543` sets `completed_at: startedAt`. No code change. ✓
- RLS impact: `ALTER COLUMN DROP NOT NULL` no policy interaction. ✓
- CHECK constraints / partial indexes — none reference `completed_at IS NOT NULL`. ✓
- Cross-platform Modal — RN `<Modal>` works on web via RN Web (`exercise-picker.tsx:42` precedent). ✓
- Soft-delete `ON DELETE SET NULL` doesn't fire — application cascade is correct in principle. ✓

## Recommendation

**Invoke Designer for re-design (v2)**. Three localized majors:
1. Test-id / accessibilityLabel strategy for check icon + modal buttons.
2. Cascade-discard semantics for checked dropset children (recommend (a) filter to unchecked-only).
3. Equal-timestamp tie-breaker (recommend (b) `set_number` secondary sort).

Plus the 4 minors as polish.

Round 1 of 3.
