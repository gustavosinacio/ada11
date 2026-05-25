# Implementation — 2026-05-24_2233_sessions-list-on-progress-chart

Based on: `design-v2.md` (final approved) and `validation-v2.md` (matching `go`).

## Files changed
- `src/utils/volume-target.ts` (edited) — change `function sumPastVolume` → `export function sumPastVolume`. Single-line visibility change; zero behavior delta. (line 68)
- `src/utils/exercise-session-row-format.ts` (new) — pure presenter `presentExerciseSessionRow({sets, unit}) → { count, volumeKg, volumeLabel }`. Delegates volume math to `sumPastVolume`; formats the label via `formatVolume`. JSDoc documents why the parts are returned alongside the formatted string.
- `src/components/exercise-session-row.tsx` (new) — `<ExerciseSessionRow>` row component. Renders date (line 1) + aggregate label (line 2, conditional on `volumeLabel !== ""`) + chevron. `accessibilityLabel` includes time-of-day via `formatDisplayDate(..., { includeTime: true })`. No `px-4` — host screen's ambient `px-6` governs indent.
- `app/(app)/exercises/[id]/progress.tsx` (edited) — added import for `ExerciseSessionRow` (line 14); new `sessionsDesc` `useMemo` (lines 111-114); new "Sessions" section inside the `e1rmData.length > 0` truthy branch wrapped in `<>` (lines 148-183). Section header uses the inline `SECTION_HEADER` literal with a code comment pointing at `history/week/[isoWeek].tsx:20-21`. Rows tap-through with `router.push('/(app)/history/{session_id}')`.
- `tests/unit/exercise-session-row-format.test.ts` (new) — 7 vitest cases covering: kg happy-path, warmup exclusion (both axes), all-warmup empty label, sloppy data (null weight / 0 reps still counted but excluded from volume), zero-volume label suppression with non-zero count, empty array, and explicit lbs conversion (`4 × 7,055 lbs`) including the pinned regex `^\d+ × [\d,]+ (kg|lbs)$`.
- `tests/e2e/exercise-session-row-list.spec.ts` (new) — 3 Playwright cases: (1) golden with 3 sessions DESC, cardinality via `page.getByLabel(/^Open session from /).toHaveCount(3)`, aggregate regex match, tap-through to `/history/{session_id}`; (2) lbs-mode label suffix; (3) warmup-only fixture preserves `/No working sets recorded yet/i` empty state AND keeps both the "Sessions" header and `Open session from` labels OUT of the DOM.

## Deviations from design
- **None on substance.** One small lint-driven choice: the new e2e file uses inline `T[]` notation (not `Array<T>`) for the `sets` array type because the project's `@typescript-eslint/array-type` rule disallows the generic form. Has no impact on the design intent.

## Soft callbacks made (during this implementation pass)
- None.

## Quality gates
- [x] `npm run typecheck` passed — `tsc --noEmit` clean exit, no diagnostics.
- [x] `npm run lint` passed — 1 pre-existing warning on `router.d.ts`; no new warnings on any file touched in this run.
- [x] Relevant unit tests pass — `npm run test:unit` reports `22 files / 354 tests passed`, including the new `exercise-session-row-format.test.ts` (7 tests).
- [x] No new `any` (verified via `grep`).
- [x] No new `// @ts-ignore` (verified).
- [x] No stray `console.log` (verified).
- [x] `npx playwright test tests/e2e/exercise-session-row-list.spec.ts --list` discovers the 3 specs successfully.

## Notes for Reviewer / Tester

### Reviewer
- The cache invalidation chain (`useFinishSession` → `["progress"]` → prefix-match → `["progress", exerciseId]`) is design-v2-verified at `src/hooks/use-sessions.ts:63` and `src/hooks/use-progress.ts:7`. No new mutation hook needed; the existing `exercise-progress-ia.spec.ts:152-203` ("cache: finishing a session does not break the progress screen on re-entry") already exercises that path.
- `sumPastVolume` is now reachable from a second call site. The kernel is unchanged; future refactors should keep `app/(app)/exercises/[id]/progress.tsx:78-86` (inline math) and `exercise-session-row-format.ts` aligned with the canonical predicate `set_type !== "warmup" && w > 0 && r > 0`.
- The new section is gated by `e1rmData.length > 0` — the same gate the empty-state copy uses — so the three pinned `/No working sets recorded yet/i` assertions in `tests/e2e/exercise-progress-ia.spec.ts:101,175,195` remain green.
- v2 design-doc note: `design-v2.md` line ~198 still describes the rejected `Pick<SessionRow>` alt as triggering the "In progress" badge because of `ended_at` null. Validator v2's NEW-MIN-1 corrected that (a synthesizer setting `ended_at: started_at` doesn't trigger the badge). The doc-level inaccuracy is acknowledged and ignored per validator hand-off; the rejection still holds on the `name` and `0m duration` failure modes alone.

### Tester
- Use Playwright `page.getByLabel(/^Open session from /)` + `.count()` (NOT RNTL `getAllByLabelText`) for cardinality.
- Aggregate regex on the rendered text is `^\d+ × [\d,]+ (kg|lbs)$` (unit-agnostic).
- Warmup-only sessions are covered by the negative-case spec — they fall under the empty-state branch (e1rmData.length === 0) and the new section never renders. The presenter's `volumeLabel === ""` suppression is dead code in production for that scenario, but the unit tests still lock it in case the gate is ever relaxed.
- Long-page screenshot (MIN-3 from design-v2): the Tester is asked to capture a deep-linked screenshot of `/(app)/exercises/{id}/progress` showing header → subline → both charts → "Sessions" header → ≥3 rows for visual regression coverage.
- The new e2e seeds via Supabase admin so the test is deterministic and bypasses the live-workout flow's UI variance. `setWeightUnit(userId, "lbs")` upserts `user_preferences` before sign-in so the lbs case mounts in lbs mode on first paint.
