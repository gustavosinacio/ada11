# Final summary — 2026-06-04_1700_routine-preview-start

## Outcome
- **Feature**: Strong-style routine preview-then-start. Tapping a routine on the Workout page now opens a NEW read-only preview screen (`app/(app)/routines/[id]/preview.tsx`) showing the routine's exercises + per-set target reps/weight, with a "Start workout" button + an "Edit this routine" header jump. One-tap direct-start from the row is removed; the row's Edit pill is removed (preview is the hub); row a11y label → "View routine: {name}". UI/navigation only.
- **Pipeline result**: **shipped** — code pending commit + deploy + push at close. NO migration / NO new query / start flow reused unchanged.
- **Branch / baseline**: `main`; baseline `592dd51` (clean).

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | **yes** (Tester live: tap→preview renders targets; Start→`/workout/{id}`; Edit→builder; row no-longer-direct-starts; Guard-A routes to existing session) |
| Human interventions during run | 1 (the 3-decision design batch: screen approach / preview-only / Edit-in-preview) |
| Total round-trips | 1 re-loop (Design↔Validate went to round 2 after a v1 NO-GO) |
| Design ↔ Validate rounds | 2 (v1 NO-GO → v2 GO) |
| Implement ↔ Review rounds | 1 (PASS) |
| Implement ↔ Test rounds | 1 (PASS, after a Tester socket-drop + Conductor recovery) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | multi-day (started 2026-06-04; finished 2026-06-08 after the Tester reconnect) |
| Token cost | n/a |

## Quality gates (final)
- `npm run typecheck`: 0 errors. `npm run lint`: 0 errors / 1 pre-existing `router.d.ts` warning.
- `npx vitest run`: **515 / 515** (UI/nav feature — no new unit tests; suite unchanged-green).
- e2e (3 touched specs): **24 pass / 1 fail / 0 flaky**. The 1 fail (`crud › exercises: create custom exercise`) is a PROVEN pre-existing, feature-independent broken test (Exercises-form drift from commit `0f68164`); this run's diff never touched that test block (diff confined to the routines test) — out of scope, left failing with evidence.
- **Guard-A teeth proven RED→GREEN**: flipping out the `active.data` early-return reddened the "Start-while-active routes to the existing session" test; reverted byte-for-byte → green. Production code ends unchanged.

## Key decisions (human-locked)
- New read-only route `routines/[id]/preview.tsx` (not reuse-editor, not modal).
- Preview-only: tap → preview; one-tap direct-start removed; ad-hoc "Quick start workout" unchanged.
- "Edit this routine" button in the preview header; the row's Edit pill removed.

## Design / engineering shape
- New `<ReadOnlyRoutineExerciseCard>` (mirrors the History read-only triad; `<RoutineExerciseCard>` is edit-only). Preview reuses the editor's data hooks + grouping (preview ≡ what-gets-seeded). The Start handler MOVED from `workout/index.tsx:60-83` into the preview keeping all 3 guards (A active-route, B in-flight, C seed-fail) + `router.replace` success. `<RoutineListItem>` collapsed to a single Pressable (keeps `disabled={hasActive}`/opacity-60/no-op-tap).
- NO change to `useStartSessionFromRoutine`/seed/editor/`<RoutineExerciseCard>`/migrations.

## Validator/Reviewer/Tester findings resolved
- v1 NO-GO (2 majors): the close-the-set was done on the `<RoutineListItem>` COMPONENT but not its a11y LABELS — `crud.spec.ts` + `probe-strong-unify.spec.ts` query "Edit routine:"/"Start workout:". v2 added an exhaustive 9-site label close-set + re-routed/re-pinned all 3 specs; preview Edit label renamed "Edit this routine" to avoid a substring collision.
- Tester test-side fixes (production untouched): the `\/preview$` waitForURL regex didn't match expo-router's `?id=` query suffix → `\/preview(\?|$)/` (12 sites); `getByLabel("Start workout")` returned 0 on RN-Web (content-derived button name) → `getByRole("button",{name})` (7 sites, the Reviewer's T-2); 2 flakes (networkidle→expect.poll, double-tap→noWaitAfter); 2 proven-pre-existing setup tests fixed.

## Recovery note (process)
The first Tester invocation dropped its socket mid-run (verdict lost). The Conductor verified tree integrity (no unreverted teeth-flip; all 3 guards intact), re-ran static gates, then briefly mis-diagnosed a self-inflicted failure (killed the dev server the crashed Tester had started → 24 `ERR_CONNECTION_REFUSED`, since `playwright.config` expects a server already on :8081), restarted the server, root-caused the genuine 12 failures as the `\/preview$`-vs-`?id=` regex, and re-invoked a fresh Tester with that diagnosis — which fixed it test-side and passed. **Lesson**: the e2e harness depends on an externally-running dev server on :8081 (`webServer: null`); don't kill it, and a readiness curl to :8081 ≠ the web bundle being compiled (cold-start nav timeouts).

## Notes / follow-ups
- **Pre-existing, out of scope**: `crud › exercises: create custom exercise` has been broken since `0f68164` (equipment-selector form drift) — a candidate for a quick standalone fix later.
- iOS/Android not exercised (web-only e2e); pure UI/nav change, Risk LOW.

## Artifacts
- [`state.md`](./state.md) · [`discovery.md`](./discovery.md) · [`design-v1.md`](./design-v1.md) · [`validation-v1.md`](./validation-v1.md) · [`design-v2.md`](./design-v2.md) · [`validation-v2.md`](./validation-v2.md) · [`implementation.md`](./implementation.md) · [`review-v1.md`](./review-v1.md) · [`test-report-v1.md`](./test-report-v1.md) · [`transcript.md`](./transcript.md) · `retro.md` (owner)

## Bugs found post-merge (backfill within 7 days)
- (none yet)

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-06-04_1700_routine-preview-start/` on 2026-06-08.
