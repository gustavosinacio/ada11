# Implementation — 2026-05-25_0933_soft-deleted-session-volume-leak

Based on: `fix-plan.md` (approved by user 2026-05-25 10:05 BRT). Baseline commit: `bde34d7f29897a0cc578dd0a0efdb7e0f6a95efe`.

## Files changed

- `src/api/stats.ts` (edited) — added `.is("sessions.deleted_at", null)` to BOTH branches of `listWeeklyVolumeRows` (lines 56 `sinceUtc` branch and 80 paginated lifetime branch). Placed immediately after the existing `.is("deleted_at", null)` filter on `sets`, before the `.not("completed_at", "is", null)` chain. Filter syntax follows the embedded-resource dotted-key convention already exercised on the same queries by `.not("sessions.ended_at", "is", null)`. The `SELECT` constant at `:29` is unchanged — filter is on the query builder, not the projection list.
- `src/api/progress.ts` (edited) — added `.is("sessions.deleted_at", null)` to `listSetsForExercise` (line 17), immediately after the existing `.is("deleted_at", null)` on `sets`. Same dotted-key embedded-filter form.
- `src/api/sets.ts` (edited) — added `.is("sessions.deleted_at", null)` to `getLastWorkingSetForExercise` (line 193), between the existing `.is("deleted_at", null)` (line 192) and `.not("sessions.ended_at", "is", null)` (line 194), matching the fix-plan's positional guidance.
- `src/hooks/use-sessions.ts` (edited) — added `qc.invalidateQueries({ queryKey: ["progress"] });` to `useSoftDeleteSession.onSuccess` (line 122), immediately after the existing `["stats"]` invalidation, mirroring `useFinishSession.onSuccess:63` and `useUpdateSessionTimes.onSuccess:109`.
- `tests/e2e/soft-deleted-session-volume-leak.spec.ts` (new) — 4-test Playwright spec pinning the bug class. Admin-seed + deep-link pattern (mirrors `exercise-note.spec.ts` test #3) — no live-workout UI flow, no React Query cache races. Tests:
  - **Variant A** (single session): seed 1×(5×100×3)=1,500 kg → admin soft-delete → purge cache + reload → navigate `/progress` → assert `1,500 kg` is absent and `This week` label is absent (strip returns null when all-zero).
  - **Variant B** (survivor + deleted): seed survivor 100 kg + doomed 1,500 kg (total 1,600 kg) → admin soft-delete doomed → purge + reload → navigate `/history` → assert `100 kg` visible and `1,600 kg` absent.
  - **Per-exercise progress**: seed 1×1,500 kg session → baseline at `/exercises/<id>/progress` → admin soft-delete → reload → assert `1,500 kg` absent (covers `src/api/progress.ts` fix).
  - **Auto-fill placeholder**: seed 1×(1×100×3) session, soft-delete BEFORE sign-in, start a Quick-start workout, add the exercise, assert NO input on the page has value `100` or `3` (covers `src/api/sets.ts:187` fix).

## Deviations from plan

- **None functional.** All four code changes match `fix-plan.md` line-for-line in shape, position, and intent. The PostgREST `.is("sessions.deleted_at", null)` overload accepted the dotted embedded-resource key without any TS friction — no fallback to `.not("sessions.deleted_at", "is", null)` was required (the fix-plan's risk-mitigation TODO at line 54 resolves as: `is()` overload works as-is with `@supabase/supabase-js@^2.47.0`, no cast or shape change needed).
- **Implicit positional choice in `progress.ts`**: fix-plan said "after the existing `.is("deleted_at", null)` on `sets` (line 16)". The pre-existing line ordering had `.not("sessions.ended_at", "is", null)` BEFORE `.is("deleted_at", null)` in the chain — I inserted `.is("sessions.deleted_at", null)` immediately after the existing `.is("deleted_at", null)` (now line 17), grouping both `.is(..., null)` filters together and keeping the `.not("sessions.ended_at", ...)` line untouched. Functionally equivalent — PostgREST WHERE-clause ordering is commutative.

## Soft callbacks made

- None.

## Quality gates

- [x] `npm run typecheck` — **pass** (`tsc --noEmit`, zero errors).
- [x] `npm run lint` — **pass** (0 errors, 1 pre-existing warning in `router.d.ts` — unrelated to this change).
- [x] `npm run test:unit` — **364/364 passed** (23 files, no regressions; identical to the baseline reported in fix-plan).
- [ ] `npx expo export --platform web` — **not run** (not gated by Implementer per playbook; Regression Tester is the gate keeper. Build risk is LOW: changes are all in `src/api/` and `src/hooks/`, no JSX, no asset, no module-graph change).
- [x] No new `any` types.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log` (verified by grep across 5 changed files; matches are only inside JSDoc comments).

## Process notes (for retro)

- **PostgREST embedded-filter syntax (`.is("sessions.deleted_at", null)`) compiles cleanly** with `@supabase/supabase-js@^2.47.0` on the pinned project setup. No fallback to the `.not("sessions.deleted_at", "is", null)` shape was needed. Fix-plan's TODO at line 54 (verify the `.is()` overload accepts the dotted embed key) resolved positively. Worth recording for future SELECT-shape fixes that target embedded-resource filters: `.is(<dotted-key>, null)` is the canonical form, not a typing hazard.
- **Test pattern choice**: the new e2e deliberately avoids the live-workout UI flow for the soft-delete trigger (admin-seed + admin soft-delete + purge cache + reload). Mirrors the proven pattern from `exercise-note.spec.ts` test #3 and `read-only-history.spec.ts:82-151`. Trade-off: the e2e covers the cold path of all three SELECTs but NOT the warm-cache `useSoftDeleteSession.onSuccess` invalidation path (no UI-triggered delete). The unit-test gate + the sibling-pattern proof (`useFinishSession`/`useUpdateSessionTimes` already do the same invalidation and are exercised by existing specs) bound the warm-cache risk. Flagged for the Regression Tester: if they want to pin the warm-cache invalidation explicitly, they need a 5th variant that triggers the delete via the History detail "Delete workout" UI button instead of admin UPDATE — but that risks the React Query cache-race flake the admin pattern was chosen to avoid.
- **Auto-fill assertion shape**: the 4th test uses a sweep over every `<input>` on the live workout page asserting no value equals `"100"` or `"3"`. The leaked placeholder would surface via `defaultValue` on the working-set inputs. This is broader than strictly necessary but mirrors the defensive style elsewhere in the e2e suite (preferring "absent-everywhere" assertions over targeted selector queries that can drift when row layout changes).

## Notes for Regression Tester

- **Replay the original repro** at `repro.md` — Variant A and Variant B should both transition from "leak observed" to "leak absent". Diff the new screenshots against `03-progress-after-delete.png` and `06-history-survivor-after-delete.png` (the deleted session's volume should be gone).
- **Run the new spec**: `npx playwright test tests/e2e/soft-deleted-session-volume-leak.spec.ts`. Requires dev server on `http://localhost:8081` (Implementer did NOT start it — Regression Tester owns the dev-server lifecycle per `docs/development.md`).
- **Full e2e sweep** per fix-plan (shared-kernel bug): `tests/e2e/weekly-volume-strip.spec.ts`, `progress-page.spec.ts`, `max-volume-window.spec.ts`, `week-drill-down.spec.ts`, `end-of-session-verdict.spec.ts`, `session-total-volume-header.spec.ts`, `volume-target.spec.ts`, `exercise-progress-ia.spec.ts`, `auto-fill-placeholder-on-check.spec.ts`, `crud.spec.ts`. None of these seed a soft-deleted session in setup (Diagnostician verified), so all should pass unchanged.
- **Visible-number surfaces** to spot-check after fix (the fix-plan listed all of these — replicating here so the Tester can tick through):
  - Progress hero `Max · Now · To PR` (Progress index).
  - Weekly Volume Strip current-week bar on both Progress AND History mounts.
  - Exercises-this-week list per-row `Max · Now · To PR`.
  - End-of-session verdict PR detection (next PR celebrates against the next-highest non-deleted session — semantic shift INTENDED).
  - `<VolumeTargetSlot>` on live workout.
  - Per-exercise progress chart e1RM + Total volume series.
  - F8 sessions list on per-exercise progress.
  - `<SetInput>` auto-fill placeholder when the only prior history is a now-deleted session.
  - F6 history-row total volume.
  - Week drill-down current-week total.
- **Manual verification** (light touch, post-e2e): on a real account, soft-delete one workout via History detail → visit Progress + History; confirm THIS WEEK matches the surviving-session sum. Visit one exercise's progress chart → confirm the chart and `<VolumeTargetSlot>` no longer reference the deleted session.
- **Out of scope** (do NOT regress on these — they're follow-up tickets, NOT regressions of this fix): `useDeleteSet` / `useUpdateSet` / `useRemoveExerciseFromSession` missing `["progress"]` invalidation (Defect B, deferred per Diagnostician).
- **Platform**: changes are platform-agnostic. iOS/Android smoke check optional — bug was reproduced on web only, but the data path is identical across platforms (no `Platform.OS` branch in any touched file).
